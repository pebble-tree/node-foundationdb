import { encoders, Transaction } from ".";
import { GeneralPurposeCache, UnresolvedValueError } from "./generalPurposeCache";
import { NativeTransaction } from "./native";
import Subspace, { GetSubspace } from "./subspace";
import { RangeOptions, TransactionKind } from "./transaction";
import { asBuf } from "./util";

export class ValueNeededError {
    constructor(public readonly hexKey: string) { }
}

enum OpType {
    set,
    clear
}

interface ClearOp<KeyIn> {
    type: OpType.clear,
    bufKey: Buffer,
    txn: Transaction<KeyIn, unknown, unknown, unknown>,
    key: KeyIn
}

interface SetOp<KeyIn, ValIn> {
    type: OpType.set,
    bufKey: Buffer,
    bufValue: Buffer,
    txn: Transaction<KeyIn, unknown, ValIn, unknown>,
    key: KeyIn,
    value: ValIn
}

type SyncOperation<KeyIn, ValIn> = ClearOp<KeyIn> | SetOp<KeyIn, ValIn>;



//b it hacky, but works
export type Primitive = string | number | boolean | null | undefined | symbol | bigint | void;
export type NonPromiseType = NotAFunction & (Primitive |
    object & { then?: NotAFunction }
    | object & { catch?: NotAFunction }
    | object & { finally?: NotAFunction }
);

export type NotAFunction = Primitive | object & { call?: never } | object & { apply?: never } | object & { bind?: never };


class OperationsStore {
    private readonly operations: Array<SyncOperation<unknown, unknown>> = [];
    private readonly opMap: Map<string, SyncOperation<unknown, unknown>> = new Map();
    constructor() {

    }
    addOperation(hexKey: string, op: SyncOperation<unknown, unknown>) {
        this.operations.push(op);
        this.opMap.set(hexKey, op);
    }
    getOperation(hexKey: string): SyncOperation<unknown, unknown> | undefined {
        return this.opMap.get(hexKey);
    }
    reset() {
        this.operations.splice(0, this.operations.length);
        this.opMap.clear();
    }
    all() {
        return this.operations;
    }
}
export class SyncTransaction<KeyIn, KeyOut extends KeyIn, ValIn, ValOut> {
    readonly _tn: NativeTransaction;
    private _txn: Transaction<KeyIn, KeyOut, ValIn, ValOut>;
    private bufTxn;
    private readonly operations;

    private cache;
    readonly kind = TransactionKind.Sync;
    constructor(txn: Transaction<KeyIn, KeyOut, ValIn, ValOut>, init?: {
        operations: OperationsStore,
        cache: GeneralPurposeCache
    }) {
        this._tn = txn._tn;
        this._txn = txn;
        const rootSubspace = new Subspace(Buffer.from([]), encoders.buf, encoders.buf);
        this.bufTxn = txn.at(
            rootSubspace
        );
        this.cache = init?.cache ?? new GeneralPurposeCache(txn);
        this.operations = init?.operations ?? new OperationsStore();
    }

    get createdAt() {
        return this._txn.createdAt;
    }
    get subspace() {
        return this._txn.subspace;
    }
    private cacheKeyGenGet(hexKey: string) {
        return `get-${hexKey}`;
    }
    private getFromOperations(hexKey: string): { value: ValOut | undefined } | undefined {
        const op = this.operations.getOperation(hexKey);
        if (op) {
            switch (op.type) {
                case OpType.clear:
                    return { value: undefined };
                case OpType.set:
                    return { value: this._txn.subspace.unpackValue(op.bufValue) as ValOut };
            }
        }
        return undefined;
    }
    get(key: KeyIn): ValOut | undefined {
        const packedKey = asBuf(this._txn.subspace.packKey(key));
        const hexKey = packedKey.toString('hex');
        //now we may have a relevant set/clear in this.operations
        //this is ryow
        const fromOperations = this.getFromOperations(hexKey);
        if (fromOperations) {
            return fromOperations.value;
        }
        const packedValue = this.cache.get(this.cacheKeyGenGet(hexKey), async () => {
            return this.bufTxn.get(packedKey);
        })

        if (packedValue === undefined)
            return undefined;
        return this._txn.subspace.unpackValue(packedValue);
    }
    getRangeAllStartsWith(prefix: KeyIn, opts?: RangeOptions): Array<[KeyOut, ValOut]> {
        const packedKey = asBuf(this._txn.subspace.packKey(prefix));
        const hexKey = packedKey.toString('hex');
        const cacheKey = `getRangeAllStartsWith-${hexKey}-${JSON.stringify(opts ?? {})}`;
        const packedValue = this.cache.get(cacheKey, async () => {
            return this.bufTxn.getRangeAllStartsWith(packedKey, opts);
        });
        const unpackedValue = packedValue.map(([k, v]): [KeyOut, ValOut] => {
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
    set(key: KeyIn, value: ValIn): void {
        const bufKey = asBuf(this._txn.subspace.packKey(key));
        const hexKey = bufKey.toString('hex');
        this.operations.addOperation(hexKey, {
            type: OpType.set,
            bufKey: bufKey,
            bufValue: asBuf(this._txn.subspace.packValue(value)),
            txn: this._txn,
            key,
            value
        })
    }
    clear(key: KeyIn): void {
        const bufKey = asBuf(this._txn.subspace.packKey(key));
        const hexKey = bufKey.toString('hex');
        //this is a clear
        this.operations.addOperation(hexKey, {
            type: OpType.clear,
            bufKey: bufKey,
            txn: this._txn,
            key,
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
    create(key: KeyIn, value: ValIn) {
        const hexKey = asBuf(this._txn.subspace.packKey(key)).toString('hex');
        //for create we assume that the prior value is undefined
        const existing = this.getFromOperations(hexKey);
        if (existing?.value !== undefined) {
            throw new Error("Key already present in transaction operations");
        }
        this.cache.setIfNotEqualTo(this.cacheKeyGenGet(hexKey), undefined, async () => {
            return this.bufTxn.get(asBuf(this._txn.subspace.packKey(key)));
        });
        this.set(key, value);
        return value;
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
    static async doTn<KeyIn, KeyOut extends KeyIn, ValIn, ValOut, T extends NonPromiseType>(
        txn: Transaction<KeyIn, KeyOut, ValIn, ValOut>,
        fn: (stxn: SyncTransaction<KeyIn, KeyOut, ValIn, ValOut>) => T,
        opts?: { maxAttempts?: number }
    ): Promise<T> {
        const stxn = new SyncTransaction(txn);
        let maxAttempts = opts?.maxAttempts ?? 250;
        while (maxAttempts-- > 0) {
            try {
                stxn.operations.reset();
                const res = fn(stxn);
                //are the values we based out decision on still valid
                await stxn.cache.validateCache(() => {
                    for (const op of stxn.operations.all()) {

                        switch (op.type) {
                            case OpType.clear:
                                op.txn.clear(op.key);
                                break;
                            case OpType.set:
                                op.txn.set(op.key, op.value);
                                break;
                        }
                    }
                })
                return res;
            } catch (e) {
                if (e instanceof UnresolvedValueError) {
                    await e.promise;
                }
                else
                    throw e;
            }
        }
        throw new Error("Max attempts reached in SyncTransaction.doTn");
    }
}


