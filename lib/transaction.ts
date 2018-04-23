import {
  NativeTransaction,
  Callback,
  Value,
  Version
} from './native'
import {eachOption, strInc, strNext} from './util'
import {KeySelector, toKeySelector} from './keySelector'

const byteZero = new Buffer(1)
byteZero.writeUInt8(0, 0)


export enum StreamingMode {
  // TODO: Ideally this should be generated along with options.g.json.
  WantAll = -2,
  Iterator = -1, // default.
  Exact = 0,
  Small = 1,
  Medium = 2,
  Large = 3,
  Serial = 4,
}

export interface RangeOptions {
  limit: number,
  targetBytes: number,
  reverse: boolean,
  streamingMode: StreamingMode,
}

export default class Transaction {
  _tn: NativeTransaction
  isSnapshot: boolean

  constructor(tn: NativeTransaction, snapshot: boolean, opts?: any) {
    this._tn = tn
    if (opts) eachOption('TransactionOption', opts, (code, val) => tn.setOption(code, val))
    this.isSnapshot = snapshot
  }

  // Returns a mirror transaction which does snapshot reads.
  snapshot(): Transaction {
    return new Transaction(this._tn, true)
  }

  // You probably don't want to call any of these functions directly. Instead call db.transact(async tn => {...}).
  commit(): Promise<void>
  commit(cb: Callback<void>): void
  commit(cb?: Callback<void>) {
    // TODO: And maybe mark the tn as committed.
    return cb ? this._tn.commit(cb) : this._tn.commit()
  }

  reset() { this._tn.reset() }
  cancel() { this._tn.cancel() }

  onError(code: number, cb: Callback<void>): void
  onError(code: number): Promise<void>
  onError(code: number, cb?: Callback<void>) {
    return cb ? this._tn.onError(code, cb) : this._tn.onError(code)
  }

  get(key: Value): Promise<Buffer | null>
  get(key: Value, cb: Callback<Buffer | null>): void
  get(key: Value, cb?: Callback<Buffer | null>) {
    return cb ? this._tn.get(key, this.isSnapshot, cb) : this._tn.get(key, this.isSnapshot)
  }
  getStr(key: Value): Promise<string | null> {
    return this.get(key).then(val => val ? val.toString() : null)
  }

  getKey(sel: KeySelector): Promise<Value>
  getKey(sel: KeySelector, cb: Callback<Value>): void
  getKey(sel: KeySelector, cb?: Callback<Value>) {
    return cb
      ? this._tn.getKey(sel.key, sel.orEqual, sel.offset, this.isSnapshot, cb)
      : this._tn.getKey(sel.key, sel.orEqual, sel.offset, this.isSnapshot)
  }

  set(key: Value, val: Value) { this._tn.set(key, val) }
  clear(key: Value) { this._tn.clear(key) }

  getRangeRaw(
      _start: string | Buffer | KeySelector, // Consider also supporting string / buffers for these.
      _end: string | Buffer | KeySelector,
      opts: RangeOptions,
      iter: number = 0) {

    const start = toKeySelector(_start)
    const end = toKeySelector(_end)
    return this._tn.getRange(
      start.key, start.orEqual, start.offset,
      end.key, end.orEqual, end.offset,
      opts.limit, opts.targetBytes, opts.streamingMode as number,
      iter, this.isSnapshot, opts.reverse)
  }

  clearRange(start: Value, end: Value) { this._tn.clearRange(start, end) }
  clearRangeStartsWith(prefix: Value) {
    this.clearRange(prefix, strInc(prefix))
  }

  watch(key: Value, listener: Callback<void>) {
    // This API is probably fine... I could return a Promise for the watch but
    // its weird to cancel promises in JS.
    return this._tn.watch(key, listener)
  }

  addReadConflictRange(start: Value, end: Value) { this._tn.addReadConflictRange(start, end) }
  addReadConflictKey(key: Value) {
    const keyBuf = Buffer.from(key)
    this.addReadConflictRange(keyBuf, strNext(keyBuf))
  }

  addWriteConflictRange(start: Value, end: Value) { this._tn.addWriteConflictRange(start, end) }
  addWriteConflictKey(key: Value) {
    const keyBuf = Buffer.from(key)
    this.addWriteConflictRange(keyBuf, strNext(keyBuf))
  }

  setReadVersion(v: Version) { this._tn.setReadVersion(v) }

  getReadVersion(): Promise<Version>
  getReadVersion(cb: Callback<Version>): void
  getReadVersion(cb?: Callback<Version>) {
    return cb ? this._tn.getReadVersion(cb) : this._tn.getReadVersion()
  }

  getCommittedVersion() { return this._tn.getCommittedVersion() }

  getVersionStamp(): Promise<Value>
  getVersionStamp(cb: Callback<Value>): void
  getVersionStamp(cb?: Callback<Value>) {
    return cb ? this._tn.getVersionStamp(cb) : this._tn.getVersionStamp()
  }

  getAddressesForKey(key: Value): string[] {
    return this._tn.getAddressesForKey(key)
  }

  add(key: Value, oper: Value) { this._tn.atomicOp(key, oper, 2) }
  bitAnd(key: Value, oper: Value) { this._tn.atomicOp(key, oper, 6) }
  bitOr(key: Value, oper: Value) { this._tn.atomicOp(key, oper, 7) }
  bitXor(key: Value, oper: Value) { this._tn.atomicOp(key, oper, 8) }
  max(key: Value, oper: Value) { this._tn.atomicOp(key, oper, 12) }
  min(key: Value, oper: Value) { this._tn.atomicOp(key, oper, 13) }
  setVersionstampedKey(key: Value, oper: Value) { this._tn.atomicOp(key, oper, 14) }
  setVersionstampedValue(key: Value, oper: Value) { this._tn.atomicOp(key, oper, 15) }
  byteMin(key: Value, oper: Value) { this._tn.atomicOp(key, oper, 16) }
  byteMax(key: Value, oper: Value) { this._tn.atomicOp(key, oper, 17) }
}
