import {
  NativeTransaction,
  Callback,
  Value,
  Version
} from './native'
import {strInc, strNext} from './util'
import keySelector, {KeySelector} from './keySelector'
import {eachOption} from './opts'
import {TransactionOptions, transactionOptionData, StreamingMode, MutationType} from './opts.g'

const byteZero = new Buffer(1)
byteZero.writeUInt8(0, 0)

export interface RangeOptions {
  streamingMode?: StreamingMode, // defaults to 'iterator'
  limit?: number,
  reverse?: boolean,
}

// Polyfill for node 8 and 9 to make asyncIterators work (getRange / getRangeBatch).
if ((<any>Symbol).asyncIterator == null) (<any>Symbol).asyncIterator = Symbol.for("Symbol.asyncIterator")

export default class Transaction {
  _tn: NativeTransaction
  isSnapshot: boolean

  constructor(tn: NativeTransaction, snapshot: boolean, opts?: TransactionOptions) {
    this._tn = tn
    if (opts) eachOption(transactionOptionData, opts, (code, val) => tn.setOption(code, val))
    this.isSnapshot = snapshot
  }

  // Returns a mirror transaction which does snapshot reads.
  snapshot(): Transaction {
    return new Transaction(this._tn, true)
  }

  // You probably don't want to call any of these functions directly. Instead call db.transact(async tn => {...}).
  rawCommit(): Promise<void>
  rawCommit(cb: Callback<void>): void
  rawCommit(cb?: Callback<void>) {
    // TODO: And maybe mark the tn as committed.
    return cb ? this._tn.commit(cb) : this._tn.commit()
  }

  rawReset() { this._tn.reset() }
  rawCancel() { this._tn.cancel() }

  rawOnError(code: number, cb: Callback<void>): void
  rawOnError(code: number): Promise<void>
  rawOnError(code: number, cb?: Callback<void>) {
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

  // getRangeRaw(start: KeySelector, end: KeySelector, opts: RangeOptions, iter: number = 0) {
  getRangeRaw(start: KeySelector, end: KeySelector,
      limit: number, targetBytes: number, streamingMode: StreamingMode, iter: number, reverse: boolean) {
    return this._tn.getRange(
      start.key, start.orEqual, start.offset,
      end.key, end.orEqual, end.offset,
      limit, targetBytes, streamingMode,
      iter, this.isSnapshot, reverse)
  }

  getRangeAll(
      _start: string | Buffer | KeySelector,
      _end: string | Buffer | KeySelector,
      opts?: {
        limit?: number,
        targetBytes?: number,
        reverse?: boolean
      }) {
    const start = keySelector.from(_start)
    const end = keySelector.from(_end)

    return this.getRangeRaw(start, end,
      (opts && opts.limit) || 0,
      (opts && opts.targetBytes) || 0,
      StreamingMode.WantAll, 0,
      opts && opts.reverse || false
    ).then(result => result.results)
  }

  async *getRangeBatch(
      _start: string | Buffer | KeySelector, // Consider also supporting string / buffers for these.
      _end: string | Buffer | KeySelector | undefined, // If not specified, start is used as a prefix.
      opts: RangeOptions = {}) {
    let start = keySelector.from(_start)
    let end = _end == null ? keySelector.firstGreaterOrEqual(strInc(start.key)) : keySelector.from(_end)
    let limit = opts.limit || 0

    let iter = 0
    while (1) {
      const {results, more} = await this.getRangeRaw(start, end,
        limit, 0, opts.streamingMode || StreamingMode.Iterator, ++iter, opts.reverse || false)

      yield results
      if (!more) break

      if (results.length) {
        if (!opts.reverse) start = keySelector.firstGreaterThan(results[results.length-1][0])
        else end = keySelector.firstGreaterOrEqual(results[results.length-1][0])
      }

      if (limit) {
        limit -= results.length
        if (limit <= 0) break
      }
    }
  }

  async *getRange(
      start: string | Buffer | KeySelector, // Consider also supporting string / buffers for these.
      end?: string | Buffer | KeySelector,
      opts?: RangeOptions) {
    for await (const batch of this.getRangeBatch(start, end, opts)) {
      for (const pair of batch) yield pair
    }
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

  add(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.Add) }
  bitAnd(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.BitAnd) }
  bitOr(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.BitOr) }
  bitXor(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.BitXor) }
  max(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.Max) }
  min(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.Min) }
  setVersionstampedKey(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.SetVersionstampedKey) }
  setVersionstampedValue(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.SetVersionstampedValue) }
  byteMin(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.ByteMin) }
  byteMax(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.ByteMax) }
}
