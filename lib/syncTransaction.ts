import { encoders, Transaction } from ".";
import { GeneralPurposeCache, UnresolvedValueError } from "./cache";
import { NativeTransaction } from "./native";
import { GetSubspace } from "./subspace";
import { ClearKey, TransactionKind } from "./transaction";
import { asBuf } from "./util";

export class ValueNeededError {
    constructor(public readonly hexKey: string) { }
}

enum OpType {
    set,
    clear
}

interface ClearOp {
    type: OpType.clear,
    bufKey: Buffer
}

interface SetOp {
    type: OpType.set,
    bufKey: Buffer,
    bufValue: Buffer
}

type SyncOperation = ClearOp | SetOp



//b it hacky, but works
export type Primitive = string | number | boolean | null | undefined | symbol | bigint | void;
export type NonPromiseType = NotAFunction & (Primitive |
    object & { then?: NotAFunction }
    | object & { catch?: NotAFunction }
    | object & { finally?: NotAFunction }
);

export type NotAFunction = Primitive | object & { call?: never } | object & { apply?: never } | object & { bind?: never };



export class SyncTransaction<KeyIn, KeyOut extends KeyIn, ValIn, ValOut> {
    readonly _tn: NativeTransaction;
    private _txn: Transaction<KeyIn, KeyOut, ValIn, ValOut>;
    private bufTxn;
    private readonly operations: Array<SyncOperation>;
    private cache;
    readonly kind = TransactionKind.Sync;
    constructor(txn: Transaction<KeyIn, KeyOut, ValIn, ValOut>, init?: {
        operations: Array<SyncOperation>,
        cache: GeneralPurposeCache
    }) {
        this._tn = txn._tn;
        this._txn = txn;
        this.bufTxn = txn.at(
            txn.subspace.withKeyEncoding(encoders.buf).withValueEncoding(encoders.buf)
        );
        this.cache = init?.cache ?? new GeneralPurposeCache(txn);
        this.operations = init?.operations ?? [];
    }
    get createdAt() {
        return this._txn.createdAt;
    }
    get asyncTxn() {
        return this._txn;
    }
    get subspace() {
        return this._txn.subspace;
    }
    get(key: KeyIn): ValOut | undefined {
        const packedKey = asBuf(this._txn.subspace.packKey(key));
        const hexKey = packedKey.toString('hex');
        //now we may have a relevant set/clear in this.operations
        //this is ryow
        const lastSetOrClear = this.operations.findLast(op => op.bufKey.toString('hex') === hexKey);
        if (lastSetOrClear) {
            switch (lastSetOrClear.type) {
                case OpType.clear:
                    return undefined;
                case OpType.set:
                    return this._txn.subspace.unpackValue(lastSetOrClear.bufValue);
            }
        }
        const packedValue = this.cache.getGetCacheEntry(hexKey, packedKey, async () => {
            return this.bufTxn.get(packedKey);
        }).contents.resolved.value
        if (packedValue === undefined)
            return undefined;
        return this._txn.subspace.unpackValue(packedValue);
    }
    getRangeAllStartsWith(prefix: KeyIn): Array<[KeyOut, ValOut]> {
        const packedKey = asBuf(this._txn.subspace.packKey(prefix));
        const hexKey = packedKey.toString('hex');
        const packedValue = this.cache.getRangeAllStartsWithCacheEntry(hexKey, packedKey, async () => {
            return this.bufTxn.getRangeAllStartsWith(packedKey);
        });
        const unpackedValue = packedValue.contents.resolved.map(([k, v]): [KeyOut, ValOut] => {
            return [
                this._txn.subspace.unpackKey(k),
                this._txn.subspace.unpackValue(v)
            ];
        });
        return unpackedValue.map(([k]): [KeyOut, ValOut] | undefined => {
            //leverage sync get as it will check local operations
            const val = this.get(k);
            //if val is undefined then it means we have a local clear and so should omit it
            if (val === undefined)
                return undefined
            return [k, val]; //we know its defined as it came from getRangeAllStartsWith
        })
            .filter(e => !!e);
    }

    static get<TXN extends Pick<SyncTransaction<any, any, any, any>, "at" | "kind"> | Pick<Transaction<any, any, any, any>, "at" | "kind">, KI, KO, VI, VO>(
        txn: TXN,
        subspace: GetSubspace<KI, KO, VI, VO>,
        key: KI
    ) {
        return txn.at(subspace).get(key) as TXN["kind"] extends TransactionKind.Sync ?
            KO extends KI ? VO | undefined : never
            : Promise<VO | undefined>;
    }
    private set(key: KeyIn, value: ValIn): void {
        const bufKey = asBuf(this._txn.subspace.packKey(key));
        this.operations.push({
            type: OpType.set,
            bufKey: bufKey,
            bufValue: asBuf(this._txn.subspace.packValue(value)),
        })
    }
    private clear(key: KeyIn): void {
        const bufKey = asBuf(this._txn.subspace.packKey(key));
        //this is a clear
        this.operations.push({
            type: OpType.clear,
            bufKey: bufKey,
        })
    }
    setDispatch<T extends NonPromiseType, const V extends ValIn = ValIn>(key: KeyIn, dispatch:
        (
            value: ValOut | undefined,
            set: (val: V | undefined) => void
        ) => T
    ): T {
        const currentValue = this.get(key);
        return dispatch(currentValue, newValue => {
            if (newValue === undefined) {
                this.clear(key);

            } else {
                //this is a set
                this.set(key, newValue);

            }
        });
    }

    at<KI, KO, VI, VO>(subspace: GetSubspace<KI, KO, VI, VO>): KO extends KI ? SyncTransaction<KI, KO, VI, VO> : never {
        const newTxn = this._txn.at(subspace as GetSubspace<KI, KO & KI, VI, VO>);
        const ret = new SyncTransaction(newTxn, {
            operations: this.operations,
            cache: this.cache
        });
        return ret as KO extends KI ? SyncTransaction<KI, KO, VI, VO> : never;
    }
    map<U extends NonPromiseType>(keys: KeyIn[], fn: (val: ValOut | undefined, set: (val: ValIn | undefined) => void) => U): U[] {
        const allKeys = keys.map(key => {
            try {
                const mapped = this.setDispatch(key, fn)
                return { mapped, missing: false } as const;
            } catch (e) {
                if (e instanceof UnresolvedValueError)
                    return { missing: true, promise: e.promise } as const;
                throw e
            }
        })
            .filter(e => !!e);
        const unresolved = allKeys.map(e => e.missing ? e.promise : undefined)
            .filter(e => !!e);
        if (unresolved.length > 0)
            throw new UnresolvedValueError(Promise.all(unresolved));
        return allKeys.filter(e => !e.missing).map(e => e.mapped) as U[];
    }
    static test<F extends () => any>(fn: F extends () => Promise<any> ? never : F): void {

    }
    static async doTn<KeyIn, KeyOut extends KeyIn, ValIn, ValOut, T extends NonPromiseType>(
        txn: Transaction<KeyIn, KeyOut, ValIn, ValOut>,
        fn: (stxn: SyncTransaction<KeyIn, KeyOut, ValIn, ValOut>) => T,
        opts?: { maxAttempts?: number }
    ): Promise<T> {
        const stxn = new SyncTransaction(txn);
        this.test(() => { })
        let maxAttempts = opts?.maxAttempts ?? 250;
        while (maxAttempts-- > 0) {
            try {
                stxn.operations.splice(0, stxn.operations.length);
                const res = fn(stxn);
                //are the values we based out decision on still valid
                if (!stxn.cache.validateCache()) {
                    throw new UnresolvedValueError(
                        Promise.resolve() //dummy promise to retry, cache should have been cleared of the invalid entries
                    );
                }
                for (const op of stxn.operations) {
                    switch (op.type) {
                        case OpType.clear:
                            stxn.bufTxn.clear(op.bufKey);
                            break;
                        case OpType.set:
                            stxn.bufTxn.set(op.bufKey, op.bufValue);
                            break;
                    }
                }
                return res;
            } catch (e) {
                if (e instanceof UnresolvedValueError) {
                    await e.promise;
                    //our operations are invalid now
                    stxn.operations.splice(0, stxn.operations.length);
                    //may as well clear the cache of any invalid entries too as we awaited
                    stxn.cache.validateCache();
                    continue;
                }
                throw e;
            }
        }
        throw new Error("Max attempts reached in SyncTransaction.doTn");
    }
}


