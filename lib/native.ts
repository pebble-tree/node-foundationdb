import path = require('path')

import FDBError from './error'
import {MutationType, StreamingMode} from './opts.g'

export type Value = string | Buffer

export type Callback<T> = (err: FDBError | null, results?: T) => void

// type VoidCb = (err?: FDBError) => void

export type KVList = {
  results: [Buffer, Buffer][], // [key, value] pair.
  more: boolean,
}

export type Watch = {
  clear(): void
}

export type Version = Buffer

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
  getKey(key: Value, orEqual: boolean, offset: number, isSnapshot: boolean): Promise<Buffer | null>
  getKey(key: Value, orEqual: boolean, offset: number, isSnapshot: boolean, cb: Callback<Buffer | null>): void
  set(key: Value, val: Value): void
  clear(key: Value): void

  atomicOp(opType: MutationType, key: Value, operand: Value): void

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
  getCommittedVersion(): Version

  getVersionStamp(): Promise<Buffer>
  getVersionStamp(cb: Callback<Buffer>): void

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
  setAPIVersion(v: number): void

  startNetwork(): void
  stopNetwork(): void

  createCluster(filename?: string): Promise<NativeCluster>
  createClusterSync(filename?: string): NativeCluster

  setNetworkOption(code: number, param: string | number | Buffer | null): void

  errorPredicate(test: ErrorPredicate, code: number): boolean
}

// Will load a compiled build if present or a prebuild.
// If no build if found it will throw an exception
const rootDir = __dirname.endsWith(`dist${path.sep}lib`) // gross.
  ? `${__dirname}/../..`
  : `${__dirname}/..`

const mod = require('node-gyp-build')(rootDir)
mod.FDBError = FDBError

export default mod as NativeModule
