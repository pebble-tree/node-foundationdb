import path = require('path')

import FDBError from './error'
import {MutationType, StreamingMode} from './opts.g'

export type NativeValue = string | Buffer

export type Callback<T> = (err: FDBError | null, results?: T) => void

// type VoidCb = (err?: FDBError) => void

export type KVList = {
  results: [Buffer, Buffer][], // [key, value] pair.
  more: boolean,
}

export type Watch = {
  cancel(): void
  // Resolves to true if the watch resolved normally. false if the watch it was aborted.
  promise: Promise<boolean>
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

  get(key: NativeValue, isSnapshot: boolean): Promise<Buffer | null>
  get(key: NativeValue, isSnapshot: boolean, cb: Callback<Buffer | null>): void
  getKey(key: NativeValue, orEqual: boolean, offset: number, isSnapshot: boolean): Promise<Buffer | null>
  getKey(key: NativeValue, orEqual: boolean, offset: number, isSnapshot: boolean, cb: Callback<Buffer | null>): void
  set(key: NativeValue, val: NativeValue): void
  clear(key: NativeValue): void

  atomicOp(opType: MutationType, key: NativeValue, operand: NativeValue): void

  getRange(
    start: NativeValue, beginOrEq: boolean, beginOffset: number,
    end: NativeValue, endOrEq: boolean, endOffset: number,
    limit: number, target_bytes: number,
    mode: StreamingMode, iter: number, isSnapshot: boolean, reverse: boolean
  ): Promise<KVList>

  getRange(
    start: NativeValue, beginOrEq: boolean, beginOffset: number,
    end: NativeValue, endOrEq: boolean, endOffset: number,
    limit: number, target_bytes: number,
    mode: StreamingMode, iter: number, isSnapshot: boolean, reverse: boolean, cb: Callback<KVList>
  ): void

  clearRange(start: NativeValue, end: NativeValue): void

  watch(key: NativeValue, ignoreStandardErrs: boolean): Watch

  addReadConflictRange(start: NativeValue, end: NativeValue): void
  addWriteConflictRange(start: NativeValue, end: NativeValue): void

  setReadVersion(v: Version): void
  getReadVersion(): Promise<Version>
  getReadVersion(cb: Callback<Version>): void
  getCommittedVersion(): Version

  getVersionstamp(): Promise<Buffer>
  getVersionstamp(cb: Callback<Buffer>): void

  getAddressesForKey(key: NativeValue): string[]
}

export interface NativeDatabase {
  createTransaction(): NativeTransaction // invalid after the database has closed
  setOption(code: number, param: string | number | Buffer | null): void
  close(): void
}

export interface NativeCluster {
  openDatabase(dbName: 'DB'): Promise<NativeDatabase>
  openDatabaseSync(dbName: 'DB'): NativeDatabase
  close(): void
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
  ? path.resolve(`${__dirname}/../..`)
  : path.resolve(`${__dirname}/..`)

let mod
try {
  mod = require('node-gyp-build')(rootDir)
} catch (e) {
  console.error('Could not load native module. Make sure the foundationdb client is installed and')
  console.error('(on windows) in your PATH. https://www.foundationdb.org/download/')
  throw e
}

mod.FDBError = FDBError
export default mod as NativeModule