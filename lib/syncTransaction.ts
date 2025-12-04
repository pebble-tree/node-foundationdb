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

interface ClearOp<KeyIn, ValIn, KeyOut, ValOut> {
    type: OpType.clear,
    bufKey: Buffer,
    txn: Transaction<KeyIn, KeyOut, ValIn, ValOut>,
    key: KeyIn
}

interface SetOp<KeyIn, ValIn, KeyOut, ValOut> {
    type: OpType.set,
    bufKey: Buffer,
    bufValue: Buffer,
    txn: Transaction<KeyIn, KeyOut, ValIn, ValOut>,
    key: KeyIn,
    value: ValIn
}

type SyncOperation<KeyIn = unknown, ValIn = unknown, KeyOut = unknown, ValOut = unknown> = ClearOp<KeyIn, ValIn, KeyOut, ValOut> | SetOp<KeyIn, ValIn, KeyOut, ValOut>;



//b it hacky, but works
export type Primitive = string | number | boolean | null | undefined | symbol | bigint | void;
export type NonPromiseType = NotAFunction & (Primitive |
    object & { then?: NotAFunction }
    | object & { catch?: NotAFunction }
    | object & { finally?: NotAFunction }
);

export type NotAFunction = Primitive | object & { call?: never } | object & { apply?: never } | object & { bind?: never };


class OperationsStore {
    private readonly operations: Array<SyncOperation> = [];
    private readonly opMap: Map<string, SyncOperation> = new Map();
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

export type SyncTransactionPreCommitOperation<KeyIn, ValIn, ValOut> = {
    key: KeyIn,
    oldValue: ValOut | undefined,
    newValue: ValIn | undefined,
}
export type SyncTransactionPreCommitFunction<KeyIn, ValIn, ValOut> = (
    operations: SyncTransactionPreCommitOperation<KeyIn, ValIn, ValOut>[],
    txn: SyncTransaction<KeyIn, KeyIn, ValIn, ValOut>
) => void;
export class SyncTransaction<KeyIn = unknown, KeyOut extends KeyIn = KeyIn, ValIn = unknown, ValOut = unknown> {
    readonly _tn: NativeTransaction;
    private _txn: Transaction<KeyIn, KeyOut, ValIn, ValOut>;
    private bufTxn;
    private readonly operations;
    private depth;
    private allTransactions: SyncTransaction[] = [];
    private static wrapper: (<T>(callback: () => Promise<T>) => Promise<T>) = (callback) => {
        return callback()
    };
    private cache;
    readonly kind = TransactionKind.Sync;
    private onPreCommit: SyncTransactionPreCommitFunction<KeyIn, ValIn, ValOut> | undefined;
    constructor(txn: Transaction<KeyIn, KeyOut, ValIn, ValOut>, init: {
        allTransactions: SyncTransaction[]
        operations: OperationsStore,
        cache: GeneralPurposeCache,
        onPreCommit: SyncTransactionPreCommitFunction<KeyIn, ValIn, ValOut> | undefined,
        depth: number
    }) {
        this._tn = txn._tn;
        this._txn = txn;
        this.depth = init.depth;
        const rootSubspace = new Subspace(Buffer.from([]), encoders.buf, encoders.buf);
        this.bufTxn = txn.at(
            rootSubspace
        );
        this.cache = init.cache;
        this.operations = init.operations;
        this.onPreCommit = init.onPreCommit;
        init.allTransactions.push(this as SyncTransaction);
        this.allTransactions = init.allTransactions;
    }
    private async preparePreCommit() {
        const hooks = await Promise.all(
            this.allTransactions.map(async txn => {
                if (txn.onPreCommit) {
                    const onPreCommit = txn.onPreCommit;
                    const operations = txn.operations.all().filter(op => {
                        return op.txn === txn._txn
                    }) as SyncOperation[];
                    if (operations.length) {
                        const ops = await Promise.all(operations.map(async (op): Promise<SyncTransactionPreCommitOperation<unknown, unknown, unknown>> => {
                            const oldValue = await op.txn.get(op.key);
                            return {
                                key: op.key,
                                oldValue: oldValue,
                                newValue: op.type === OpType.set ? op.value : undefined
                            };
                        }))
                        return (txn: SyncTransaction) => {
                            onPreCommit(ops, txn.at(txn.subspace))
                        }
                    }
                }
                return undefined;
            })
        );
        return hooks.filter(h => !!h);
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
        this.cache.addCreate(this.cacheKeyGenGet(hexKey), async () => {
            return this.bufTxn.get(asBuf(this._txn.subspace.packKey(key)));
        });
        this.set(key, value);
        return value;
    }
    at<KI, KO, VI, VO>(
        subspace: GetSubspace<KI, KO, VI, VO>,
        onPreCommit?: SyncTransactionPreCommitFunction<KI, VI, VO>
    ): KO extends KI ? SyncTransaction<KI, KO, VI, VO> : never {
        const newTxn = this._txn.at(subspace as GetSubspace<KI, KO & KI, VI, VO>);
        const ret = new SyncTransaction(newTxn, {
            operations: this.operations,
            cache: this.cache,
            onPreCommit: onPreCommit || undefined,
            allTransactions: this.allTransactions,
            depth: this.depth
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
    static setTransactionBodyWrapper(fn: <T>(callback: () => Promise<T>) => Promise<T>) {
        if (this.wrapper) {
            const existing = this.wrapper;
            this.wrapper = (callback) => {
                return existing(() => {
                    return fn(callback);
                });
            }
        } else {
            this.wrapper = fn;
        }
    }
    static async doTn<KeyIn, KeyOut extends KeyIn, ValIn, ValOut, T extends NonPromiseType>(
        txn: Transaction<KeyIn, KeyOut, ValIn, ValOut>,
        fn: (stxn: SyncTransaction<KeyIn, KeyOut, ValIn, ValOut>) => T,
        opts?: { maxAttempts?: number, onPreCommit?: SyncTransactionPreCommitFunction<KeyIn, ValIn, ValOut>, depth?: number }
    ): Promise<T> {
        const stxn = new SyncTransaction(txn, {
            onPreCommit: opts?.onPreCommit || undefined,
            cache: new GeneralPurposeCache(txn),
            operations: new OperationsStore(),
            allTransactions: [],
            depth: opts?.depth || 1
        });
        let maxAttempts = opts?.maxAttempts ?? 250;
        while (maxAttempts-- > 0) {
            try {
                const res = await this.wrapper(async () => {
                    stxn.operations.reset();
                    stxn.allTransactions.splice(0, stxn.allTransactions.length);
                    stxn.allTransactions.push(stxn as SyncTransaction);
                    const res = fn(stxn);
                    const lastMutationIndex = txn._tn.allOperations?.length || 0;
                    let maxIter = 1000;
                    while (maxIter-- > 0) {
                        //are the values we based out decision on still valid
                        //it is assumed that any values used in the preCommit hooks are also cached values
                        //this may not be the case when set or clear are used directly

                        const [cacheValid, hooks] = await Promise.all([stxn.cache.validateCache(), await stxn.preparePreCommit()]);
                        if (cacheValid && (txn._tn.allOperations?.length || 0) === lastMutationIndex) {
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
                            stxn.operations.reset();
                            //we have now commited to the main transaction, we process hooks in a new sync transaction loop
                            //this gives us isolation for any sets etc.
                            if (hooks.length) {
                                await SyncTransaction.doTn(txn, (stxnInner) => {
                                    for (const hook of hooks) {
                                        hook(stxnInner as SyncTransaction)
                                    }
                                }, {
                                    ...opts,
                                    depth: stxn.depth + 1
                                })
                            }
                            return res;
                        }
                    }
                    throw new Error("Max iterations reached in SyncTransaction.doTn");
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


