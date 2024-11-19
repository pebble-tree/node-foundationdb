import { KeySelector } from "../keySelector"
import Transaction from "../transaction"

export namespace Operations {

    export interface Set<K, V> {
        op: "set"
        key: K,
        value: V,
        txn: Transaction<K, unknown, V, unknown>
    }
    export interface Clear<K> {
        op: "clear"
        key: K,
        txn: Transaction<K, unknown, unknown, unknown>
    }
    export interface ClearRange<K> {
        op: "clearRange"
        range: [K, K | undefined],
        txn: Transaction<K, unknown, unknown, unknown>
    }
    export type WriteOperation<K, V> = Set<K, V> | Clear<K> | ClearRange<K>
    export interface Get<K> {
        op: "get"
        key: K,
        txn: Transaction<K, unknown, unknown, unknown>
    }
    export interface GetKey<K> {
        op: "getKey"
        key: K | KeySelector<K>,
        txn: Transaction<K, unknown, unknown, unknown>
    }
    export interface GetRange<K> {
        op: "getRange"
        start: K | KeySelector<K>,
        end: undefined | K | KeySelector<K>,
        txn: Transaction<K, unknown, unknown, unknown>
    }
    export type ReadOperation<K> = Get<K> | GetRange<K> | GetKey<K>
}

export interface TransactionEventHandler {
    onAfterWriteOperation: ((operation: Operations.WriteOperation<any, any>) => void) | undefined
    onBeforeReadOperation: ((operation: Operations.ReadOperation<any>) => Promise<void>) | undefined
    onPreCommit: ((txn: Transaction<unknown, unknown, unknown, unknown>) => Promise<void>) | undefined
    onPostCommit: ((txn: Transaction<unknown, unknown, unknown, unknown>) => Promise<void>) | undefined
}

export const EmptyEventHandler: TransactionEventHandler = {
    onAfterWriteOperation: undefined,
    onBeforeReadOperation: undefined,
    onPostCommit: undefined,
    onPreCommit: undefined
}
