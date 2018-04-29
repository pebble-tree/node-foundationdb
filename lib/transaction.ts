import assert = require('assert')
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
import {
  TransactionOptions,
  TransactionOptionCode,
  transactionOptionData,
  StreamingMode,
  MutationType
} from './opts.g'

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
  _prefix: Buffer | null

  constructor(tn: NativeTransaction, snapshot: boolean, prefix: Buffer | null, opts?: TransactionOptions) {
    this._tn = tn
    this._prefix = prefix
    if (opts) eachOption(transactionOptionData, opts, (code, val) => tn.setOption(code, val))
    this.isSnapshot = snapshot
  }

  // This is needed for the binding tester, but users should usually pass
  // options when the transaction is constructed.
  setOption(opt: TransactionOptionCode, value?: number | string | Buffer) {
    // TODO: Check type of passed option is valid.
    this._tn.setOption(opt, (value == null) ? null : value)
  }

  // Returns a mirror transaction which does snapshot reads.
  snapshot(): Transaction {
    return new Transaction(this._tn, true, this._prefix)
  }

  wrapKey(key: Buffer | string): Buffer {
    const keyBuf = typeof key === 'string' ? Buffer.from(key) : key
    return this._prefix
      ? Buffer.concat([this._prefix, keyBuf])
      : keyBuf
  }

  unwrapKey(keyPrefixed: Buffer): Buffer {
    // Note using slice doesn't reallocate the underlying byte array.
    return this._prefix ? keyPrefixed.slice(this._prefix.length) : keyPrefixed
  }

  // You probably don't want to call any of these functions directly. Instead call db.transact(async tn => {...}).
  rawCommit(): Promise<void>
  rawCommit(cb: Callback<void>): void
  rawCommit(cb?: Callback<void>) {
    return cb
      ? this._tn.commit(cb)
      : this._tn.commit()
  }

  rawReset() { this._tn.reset() }
  rawCancel() { this._tn.cancel() }

  rawOnError(code: number, cb: Callback<void>): void
  rawOnError(code: number): Promise<void>
  rawOnError(code: number, cb?: Callback<void>) {
    return cb
      ? this._tn.onError(code, cb)
      : this._tn.onError(code)
  }

  get(key: Value): Promise<Buffer | null>
  get(key: Value, cb: Callback<Buffer | null>): void
  get(key: Value, cb?: Callback<Buffer | null>) {
    const keyWrapped = this.wrapKey(key)
    return cb
      ? this._tn.get(keyWrapped, this.isSnapshot, cb)
      : this._tn.get(keyWrapped, this.isSnapshot)
  }
  // TODO: Add something like this.
  // getStr(key: Value): Promise<string | null> {
  //   return this.get(key).then(val => val ? val.toString() : null)
  // }

  getKey(_sel: string | Buffer | KeySelector): Promise<Buffer | null> {
    const sel = keySelector.from(_sel)
    return this._tn.getKey(this.wrapKey(sel.key), sel.orEqual, sel.offset, this.isSnapshot)
    .then(keyOrNull => (
      keyOrNull != null ? this.unwrapKey(keyOrNull) : null
    ))
  }

  set(key: Value, val: Value) { this._tn.set(this.wrapKey(key), val) }
  clear(key: Value) { this._tn.clear(this.wrapKey(key)) }

  getRangeRaw(start: KeySelector, end: KeySelector,
      limit: number, targetBytes: number, streamingMode: StreamingMode,
      iter: number, reverse: boolean): Promise<KVList> {
    return this._tn.getRange(
      this.wrapKey(start.key), start.orEqual, start.offset,
      this.wrapKey(end.key), end.orEqual, end.offset,
      limit, targetBytes, streamingMode,
      iter, this.isSnapshot, reverse)
    .then(result => {
      for (let i = 0; i < result.results.length; i++) {
        result.results[i][0] = this.unwrapKey(result.results[i][0])
      }
      return result
    })
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

  getRangeAllStartsWith(prefix: string | Buffer | KeySelector, opts?: RangeOptions) {
    return this.getRangeAll(prefix, undefined, opts)
  }
  
  clearRange(start: Value, end: Value) {
    this._tn.clearRange(this.wrapKey(start), this.wrapKey(end))
  }
  clearRangeStartsWith(prefix: Value) {
    this.clearRange(prefix, strInc(prefix))
  }

  watch(key: Value, listener: Callback<void>) {
    // This API is probably fine... I could return a Promise for the watch but
    // its weird to cancel promises in JS, and adding a .cancel() method to
    // the primise feels weird.
    return this._tn.watch(this.wrapKey(key), listener)
  }

  addReadConflictRange(start: Value, end: Value) {
    this._tn.addReadConflictRange(this.wrapKey(start), this.wrapKey(end))
  }
  addReadConflictKey(key: Value) {
    const keyBuf = Buffer.from(key)
    this.addReadConflictRange(keyBuf, strNext(keyBuf))
  }

  addWriteConflictRange(start: Value, end: Value) {
    this._tn.addWriteConflictRange(this.wrapKey(start), this.wrapKey(end))
  }
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
    return this._tn.getAddressesForKey(this.wrapKey(key))
  }

  atomicOp(opType: MutationType, key: Value, oper: Value) {
    if (this._prefix) {
      key = this.wrapKey(key)
      if (opType === MutationType.SetVersionstampedKey) {
        // If the original key length is less than 10 bytes, atomicOp will throw
        // an error. We should preemptively do that before reading the length
        // field.
        const pos = key.readUInt16LE(key.length - 2)
        key.writeUInt16LE(pos + this._prefix.length, key.length - 2)
      } else if (opType === MutationType.SetVersionstampedValue) {
        // No transformation of oper.
      } else {
        // For all other atomic operations oper is another key.
        oper = this.wrapKey(oper)
      }
    }
    this._tn.atomicOp(opType, key, oper)
  }

  // I wish I could autogenerate this... Easy with JS but not sure how with TS.
  add(key: Value, oper: Value) { this.atomicOp(MutationType.Add, key, oper) }
  bitAnd(key: Value, oper: Value) { this.atomicOp(MutationType.BitAnd, key, oper) }
  bitOr(key: Value, oper: Value) { this.atomicOp(MutationType.BitOr, key, oper) }
  bitXor(key: Value, oper: Value) { this.atomicOp(MutationType.BitXor, key, oper) }
  max(key: Value, oper: Value) { this.atomicOp(MutationType.Max, key, oper) }
  min(key: Value, oper: Value) { this.atomicOp(MutationType.Min, key, oper) }
  setVersionstampedKey(key: Value, oper: Value) { this.atomicOp(MutationType.SetVersionstampedKey, key, oper) }
  setVersionstampedValue(key: Value, oper: Value) { this.atomicOp(MutationType.SetVersionstampedValue, key, oper) }
  byteMin(key: Value, oper: Value) { this.atomicOp(MutationType.ByteMin, key, oper) }
  byteMax(key: Value, oper: Value) { this.atomicOp(MutationType.ByteMax, key, oper) }
}
