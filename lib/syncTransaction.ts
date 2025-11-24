import { encoders, Operations, Transaction } from ".";
import { NativeTransaction, NativeValue } from "./native";
import Subspace, { GetSubspace } from "./subspace";
import { UnresolvedValueError } from "./transaction";
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

export class SyncTransaction<KeyIn, KeyOut, ValIn, ValOut> {
    readonly _tn: NativeTransaction;
    private _txn: Transaction<KeyIn, KeyOut, ValIn, ValOut>;
    private bufTxn;
    private readonly operations: Array<SyncOperation>;
    constructor(txn: Transaction<KeyIn, KeyOut, ValIn, ValOut>, operations?: Array<SyncOperation>) {
        this._tn = txn._tn;
        this._txn = txn;
        this.bufTxn = txn.at(
            txn.subspace.withKeyEncoding(encoders.buf).withValueEncoding(encoders.buf)
        );
        this.operations = operations ?? [];
    }
    get createdAt() {
        return this._txn.createdAt;
    }
    get asyncTxn() {
        return this._txn;
    }
    get(key: KeyIn): ValOut | undefined {
        const packedKey = asBuf(this._txn.subspace.packKey(key));
        const hexKey = packedKey.toString('hex');
        const valueBuf = this._txn.getCurrentValueInTxn(hexKey, packedKey);
        if (valueBuf === undefined)
            return undefined
        return this._txn.subspace.unpackValue(valueBuf)
    }
    set<T>(key: KeyIn, dispatch: (value: ValOut | undefined, set: (val: ValIn | undefined) => void) => T): T {
        const currentValue = this.get(key);
        const bufKey = asBuf(this._txn.subspace.packKey(key));
        return dispatch(currentValue, newValue => {
            if (newValue === undefined) {
                //this is a clear
                this.operations.push({
                    type: OpType.clear,
                    bufKey: bufKey,
                })
            } else {
                //this is a set
                this.operations.push({
                    type: OpType.set,
                    bufKey: bufKey,
                    bufValue: asBuf(this._txn.subspace.packValue(newValue)),
                })
            }
        });
    }

    at<KI, KO, VI, VO>(subspace: GetSubspace<KI, KO, VI, VO>): SyncTransaction<KI, KO, VI, VO> {
        const newTxn = this._txn.at(subspace);
        const ret = new SyncTransaction(newTxn, this.operations);
        return ret;
    }
    static async doTn<KeyIn, KeyOut, ValIn, ValOut, T>(
        txn: Transaction<KeyIn, KeyOut, ValIn, ValOut>,
        fn: (stxn: SyncTransaction<KeyIn, KeyOut, ValIn, ValOut>) => T,
        opts?: { maxAttempts?: number }
    ): Promise<T> {
        const stxn = new SyncTransaction(txn);
        let maxAttempts = opts?.maxAttempts ?? 250;
        while (maxAttempts-- > 0) {
            try {
                stxn.operations.splice(0, stxn.operations.length);
                const res = fn(stxn);
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
                }
                throw e;
            }
        }
        throw new Error("Max attempts reached in SyncTransaction.doTn");
    }
}


