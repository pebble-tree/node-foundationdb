import {
  NativeTransaction,
  Callback,
  Value,
  Version
} from './native'
import {eachOption, strInc, strNext} from './util'
import {
  KeySelector, toKeySelector,
  firstGreaterThan, firstGreaterOrEqual
} from './keySelector'
import {StreamingMode, MutationType} from './opts.g'

const byteZero = new Buffer(1)
byteZero.writeUInt8(0, 0)

export interface RangeOptions {
  streamingMode?: StreamingMode, // defaults to 'iterator'
  limit?: number,
  reverse?: boolean,
}

// Polyfill for node 8 and 9 to make asyncIterators work (getRange / getRangeBatch).
;(<any>Symbol).asyncIterator = (<any>Symbol).asyncIterator || Symbol.for("Symbol.asyncIterator")

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
    const start = toKeySelector(_start)
    const end = toKeySelector(_end)

    return this.getRangeRaw(start, end,
      (opts && opts.limit) || 0,
      (opts && opts.targetBytes) || 0,
      StreamingMode.wantAll, 0,
      opts && opts.reverse || false
    ).then(result => result.results)
  }

  async *getRangeBatch(
      _start: string | Buffer | KeySelector, // Consider also supporting string / buffers for these.
      _end: string | Buffer | KeySelector,
      opts: RangeOptions = {}) {
    let start = toKeySelector(_start)
    let end = toKeySelector(_end)
    let limit = opts.limit || 0

    let iter = 0
    while (1) {
      const {results, more} = await this.getRangeRaw(start, end,
        limit, 0, opts.streamingMode || StreamingMode.iterator, ++iter, opts.reverse || false)

      yield results
      if (!more) break

      if (results.length) {
        if (!opts.reverse) start = firstGreaterThan(results[results.length-1][0])
        else end = firstGreaterOrEqual(results[results.length-1][0])
      }

      if (limit) {
        limit -= results.length
        if (limit <= 0) break
      }
    }
  }

  async *getRange(
      start: string | Buffer | KeySelector, // Consider also supporting string / buffers for these.
      end: string | Buffer | KeySelector,
      opts: RangeOptions = {}) {
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

  add(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.add) }
  bitAnd(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.bitAnd) }
  bitOr(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.bitOr) }
  bitXor(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.bitXor) }
  max(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.max) }
  min(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.min) }
  setVersionstampedKey(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.setVersionstampedKey) }
  setVersionstampedValue(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.setVersionstampedValue) }
  byteMin(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.byteMin) }
  byteMax(key: Value, oper: Value) { this._tn.atomicOp(key, oper, MutationType.byteMax) }
}
