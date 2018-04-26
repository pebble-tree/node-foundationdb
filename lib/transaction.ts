import {
  NativeTransaction,
  Callback,
  Value,
  Version,
  KVList
} from './native'
import {strInc, strNext} from './util'
import keySelector, {KeySelector} from './keySelector'
import {eachOption} from './opts'
import {TransactionOptions, TransactionOption, transactionOptionData, StreamingMode, MutationType} from './opts.g'

const byteZero = new Buffer(1)
byteZero.writeUInt8(0, 0)

export interface RangeOptionsBatch {
  // defaults to Iterator for batch mode, WantAll for getRangeAll.
  streamingMode?: StreamingMode,
  limit?: number,
  reverse?: boolean,
}

export interface RangeOptions extends RangeOptionsBatch {
  targetBytes?: number,
}


// Polyfill for node < 10.0 to make asyncIterators work (getRange / getRangeBatch).
if ((<any>Symbol).asyncIterator == null) (<any>Symbol).asyncIterator = Symbol.for("Symbol.asyncIterator")

export default class Transaction {
  _tn: NativeTransaction
  isSnapshot: boolean

  constructor(tn: NativeTransaction, snapshot: boolean, opts?: TransactionOptions) {
    this._tn = tn
    if (opts) eachOption(transactionOptionData, opts, (code, val) => tn.setOption(code, val))
    this.isSnapshot = snapshot
  }

  setOption(opt: TransactionOption, value?: number | string | Buffer) {
    // TODO: Check type of passed option is valid.
    this._tn.setOption(opt, (value == null) ? null : value)
  }

  // Returns a mirror transaction which does snapshot reads.
  snapshot(): Transaction {
    return new Transaction(this._tn, true)
  }

  // You probably don't want to call any of these functions directly. Instead call db.transact(async tn => {...}).
  rawCommit(): Promise<void>
  rawCommit(cb: Callback<void>): void
  rawCommit(cb?: Callback<void>) {
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

  getKey(sel: KeySelector): Promise<Buffer | null>
  getKey(sel: KeySelector, cb: Callback<Buffer | null>): void
  getKey(sel: KeySelector, cb?: Callback<Buffer | null>) {
    return cb
      ? this._tn.getKey(sel.key, sel.orEqual, sel.offset, this.isSnapshot, cb)
      : this._tn.getKey(sel.key, sel.orEqual, sel.offset, this.isSnapshot)
  }

  set(key: Value, val: Value) { this._tn.set(key, val) }
  clear(key: Value) { this._tn.clear(key) }

  getRangeRaw(start: KeySelector, end: KeySelector,
      limit: number, targetBytes: number, streamingMode: StreamingMode,
      iter: number, reverse: boolean): Promise<KVList> {
    return this._tn.getRange(
      start.key, start.orEqual, start.offset,
      end.key, end.orEqual, end.offset,
      limit, targetBytes, streamingMode,
      iter, this.isSnapshot, reverse)
  }

  getRangeAllStartsWith(prefix: string | Buffer | KeySelector, opts?: RangeOptions) {
    return this.getRangeAll(prefix, undefined, opts)
  }

  async *getRangeBatch(
      _start: string | Buffer | KeySelector, // Consider also supporting string / buffers for these.
      _end: string | Buffer | KeySelector | undefined, // If not specified, start is used as a prefix.
      opts: RangeOptions = {}) {
    let start = keySelector.from(_start)
    let end = _end == null ? keySelector.firstGreaterOrEqual(strInc(start.key)) : keySelector.from(_end)
    let limit = opts.limit || 0
    const streamingMode = opts.streamingMode == null ? StreamingMode.Iterator : opts.streamingMode

    let iter = 0
    while (1) {
      const {results, more} = await this.getRangeRaw(start, end,
        limit, 0, streamingMode, ++iter, opts.reverse || false)

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

  async getRangeAll(
      start: string | Buffer | KeySelector,
      end: string | Buffer | KeySelector | undefined, // if undefined, start is used as a prefix.
      opts: RangeOptions = {}) {
    const childOpts: RangeOptions = {...opts}
    if (childOpts.streamingMode == null) childOpts.streamingMode = StreamingMode.WantAll

    const result: [Buffer, Buffer][] = []
    for await (const batch of this.getRangeBatch(start, end, childOpts)) {
      result.push.apply(result, batch)
    }
    return result
  }

  // TODO: getRangeBatchStartsWith

  async *getRange(
      start: string | Buffer | KeySelector, // Consider also supporting string / buffers for these.
      end?: string | Buffer | KeySelector,
      opts?: RangeOptions) {
    for await (const batch of this.getRangeBatch(start, end, opts)) {
      for (const pair of batch) yield pair
    }
  }

  // TODO: getRangeStartsWtih

  clearRange(start: Value, end: Value) { this._tn.clearRange(start, end) }
  clearRangeStartsWith(prefix: Value) {
    this.clearRange(prefix, strInc(prefix))
  }

  watch(key: Value, listener: Callback<void>) {
    // This API is probably fine... I could return a Promise for the watch but
    // its weird to cancel promises in JS, and adding a .cancel() method to
    // the primise feels weird.
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

  getVersionStamp(): Promise<Buffer>
  getVersionStamp(cb: Callback<Buffer>): void
  getVersionStamp(cb?: Callback<Buffer>) {
    return cb ? this._tn.getVersionStamp(cb) : this._tn.getVersionStamp()
  }

  getAddressesForKey(key: Value): string[] {
    return this._tn.getAddressesForKey(key)
  }

  atomicOp(opType: MutationType, key: Value, oper: Value) {this._tn.atomicOp(opType, key, oper)}

  // I wish I could easily autogenerate this... Easy with JS but not sure how with TS.
  add(key: Value, oper: Value) { this._tn.atomicOp(MutationType.Add, key, oper) }
  bitAnd(key: Value, oper: Value) { this._tn.atomicOp(MutationType.BitAnd, key, oper) }
  bitOr(key: Value, oper: Value) { this._tn.atomicOp(MutationType.BitOr, key, oper) }
  bitXor(key: Value, oper: Value) { this._tn.atomicOp(MutationType.BitXor, key, oper) }
  max(key: Value, oper: Value) { this._tn.atomicOp(MutationType.Max, key, oper) }
  min(key: Value, oper: Value) { this._tn.atomicOp(MutationType.Min, key, oper) }
  setVersionstampedKey(key: Value, oper: Value) { this._tn.atomicOp(MutationType.SetVersionstampedKey, key, oper) }
  setVersionstampedValue(key: Value, oper: Value) { this._tn.atomicOp(MutationType.SetVersionstampedValue, key, oper) }
  byteMin(key: Value, oper: Value) { this._tn.atomicOp(MutationType.ByteMin, key, oper) }
  byteMax(key: Value, oper: Value) { this._tn.atomicOp(MutationType.ByteMax, key, oper) }
}
