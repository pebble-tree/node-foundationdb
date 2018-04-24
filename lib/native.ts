import bindings = require('bindings')
import FDBError from './error'

export type Value = string | Buffer

export type Callback<T> = (err: FDBError | null, results?: T) => void

// type VoidCb = (err?: FDBError) => void

export type AtomicOp = number
export type StreamingMode = number

export type KVList = {
  results: [Buffer, Buffer][], // [key, value] pair.
  more: boolean,
}

export type Watch = {
  clear(): void
}

export type Version = number

export interface NativeTransaction {
  setOption(code: number, param: string | number | Buffer | null): void

  commit(): Promise<void>
  commit(cb: Callback<void>): void
  reset(): void
  cancel(): void
  onError(code: number, cb: Callback<void>): void
  onError(code: number): Promise<void>

  get(key: Value, isSnapshot: boolean): Promise<Buffer | null>
  get(key: Value, isSnapshot: boolean, cb: Callback<Buffer | null>): void
  getKey(key: Value, orEqual: boolean, offset: number, isSnapshot: boolean): Promise<Value>
  getKey(key: Value, orEqual: boolean, offset: number, isSnapshot: boolean, cb: Callback<Value>): void
  set(key: Value, val: Value): void
  clear(key: Value): void

  atomicOp(key: Value, operand: Value, atomicOp: AtomicOp): void

  getRange(
    start: Value, beginOrEq: boolean, beginOffset: number,
    end: Value, endOrEq: boolean, endOffset: number,
    limit: number, target_bytes: number,
    mode: StreamingMode, iter: number, isSnapshot: boolean, reverse: boolean
  ): Promise<KVList>

  getRange(
    start: Value, beginOrEq: boolean, beginOffset: number,
    end: Value, endOrEq: boolean, endOffset: number,
    limit: number, target_bytes: number,
    mode: StreamingMode, iter: number, isSnapshot: boolean, reverse: boolean, cb: Callback<KVList>
  ): void

  clearRange(start: Value, end: Value): void

  watch(key: Value, listener: Callback<void>): Watch

  addReadConflictRange(start: Value, end: Value): void
  addWriteConflictRange(start: Value, end: Value): void

  setReadVersion(v: Version): void
  getReadVersion(): Promise<Version>
  getReadVersion(cb: Callback<Version>): void
  getCommittedVersion(): number

  getVersionStamp(): Promise<Value>
  getVersionStamp(cb: Callback<Value>): void

  getAddressesForKey(key: Value): string[]
}

export interface NativeDatabase {
  createTransaction(): NativeTransaction
  setOption(code: number, param: string | number | Buffer | null): void
}

export interface NativeCluster {
  openDatabase(dbName: 'DB'): Promise<NativeDatabase>
  openDatabaseSync(dbName: 'DB'): NativeDatabase
}

export enum ErrorPredicate {
  Retryable = 50000,
  MaybeCommitted = 50001,
  RetryableNotCommitted = 50002,
}

export interface NativeModule {
  apiVersion(v: number): void

  startNetwork(): void
  stopNetwork(): void

  createCluster(filename?: string): Promise<NativeCluster>
  createClusterSync(filename?: string): NativeCluster

  setNetworkOption(code: number, param: string | number | Buffer | null): void

  errorPredicate(test: ErrorPredicate, code: number): boolean
}

const mod = bindings('fdblib.node')
mod.FDBError = FDBError
export default mod as NativeModule
// export nativeMod
