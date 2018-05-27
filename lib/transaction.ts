import assert = require('assert')
import {
  NativeTransaction,
  Callback,
  NativeValue,
  Version,
} from './native'
import {strInc, strNext, packVersionstampedValue, unpackVersionstampedValue, asBuf} from './util'
import keySelector, {KeySelector} from './keySelector'
import {eachOption} from './opts'
import {
  TransactionOptions,
  TransactionOptionCode,
  transactionOptionData,
  StreamingMode,
  MutationType
} from './opts.g'
import Database from './database'

const byteZero = Buffer.alloc(1)
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

export type Transformer<T> = {
  pack(k: T): Buffer | string,
  unpack(k: Buffer): T,
}

export type KVList<Key, Value> = {
  results: [Key, Value][], // [key, value] pair.
  more: boolean,
}

// Polyfill for node < 10.0 to make asyncIterators work (getRange / getRangeBatch).
if ((<any>Symbol).asyncIterator == null) (<any>Symbol).asyncIterator = Symbol.for("Symbol.asyncIterator")

// export default class Transaction<Key = string | Buffer, Value = Buffer> {
export default class Transaction<Key = NativeValue, Value = NativeValue> {
  _tn: NativeTransaction
  isSnapshot: boolean
  _keyEncoding: Transformer<Key>
  _valueEncoding: Transformer<Value>

  constructor(tn: NativeTransaction, snapshot: boolean,
      keyEncoding: Transformer<Key>, valueEncoding: Transformer<Value>,
      opts?: TransactionOptions) {
    this._tn = tn
    this._keyEncoding = keyEncoding
    this._valueEncoding = valueEncoding
    if (opts) eachOption(transactionOptionData, opts, (code, val) => tn.setOption(code, val))
    this.isSnapshot = snapshot
  }

  // This is needed for the binding tester, but users should usually pass
  // options when the transaction is constructed.
  rawSetOption(opt: TransactionOptionCode, value?: number | string | Buffer) {
    // TODO: Check type of passed option is valid.
    this._tn.setOption(opt, (value == null) ? null : value)
  }

  // Returns a mirror transaction which does snapshot reads.
  snapshot(): Transaction<Key, Value> {
    return new Transaction(this._tn, true, this._keyEncoding, this._valueEncoding)
  }

  // Creates a shallow copy of the database in a different scope
  scopedTo<ChildKey, ChildVal>(db: Database<ChildKey, ChildVal>): Transaction<ChildKey, ChildVal> {
    return new Transaction(this._tn, this.isSnapshot, db._bakedKeyXf, db._valueXf)
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

  get(key: Key): Promise<Value | null>
  get(key: Key, cb: Callback<Value | null>): void
  get(key: Key, cb?: Callback<Value | null>) {
    const keyBuf = this._keyEncoding.pack(key)
    return cb
      ? this._tn.get(keyBuf, this.isSnapshot, (err, val) => {
        cb(err, val == null ? null : this._valueEncoding.unpack(val))
      })
      : this._tn.get(keyBuf, this.isSnapshot)
        .then(val => val == null ? null : this._valueEncoding.unpack(val))
  }

  getPackedVersionstampedValue(key: Key): Promise<{stamp: Buffer, val: Value} | null> {
    const keyBuf = this._keyEncoding.pack(key)
    return this._tn.get(keyBuf, this.isSnapshot).then(val => {
      if (val == null) return null
      const unpacked = unpackVersionstampedValue(val)
      return {stamp: unpacked.stamp, val: this._valueEncoding.unpack(unpacked.val) }
    })
  }

  getKey(_sel: Key | KeySelector<Key>): Promise<Key | null> {
    const sel = keySelector.from(_sel)
    return this._tn.getKey(this._keyEncoding.pack(sel.key), sel.orEqual, sel.offset, this.isSnapshot)
    .then(keyOrNull => (
      keyOrNull != null ? this._keyEncoding.unpack(keyOrNull) : null
    ))
  }

  set(key: Key, val: Value) {
    this._tn.set(this._keyEncoding.pack(key), this._valueEncoding.pack(val))
  }
  clear(key: Key) { this._tn.clear(this._keyEncoding.pack(key)) }

  // This just destructively edits the result in-place.
  _encodeRangeResult(r: [Buffer, Buffer][]): [Key, Value][] {
    // This is slightly faster but I have to throw away the TS checks in the process. :/
    for (let i = 0; i < r.length; i++) {
      ;(r as any)[i][0] = this._keyEncoding.unpack(r[i][0])
      ;(r as any)[i][1] = this._valueEncoding.unpack(r[i][1])
    }
    return r as any as [Key, Value][]
  }

  getRangeNative(start: KeySelector<NativeValue>,
      end: KeySelector<NativeValue> | null,  // If not specified, start is used as a prefix.
      limit: number, targetBytes: number, streamingMode: StreamingMode,
      iter: number, reverse: boolean): Promise<KVList<Buffer, Buffer>> {
    const _end = end != null ? end : keySelector.firstGreaterOrEqual(strInc(start.key))
    return this._tn.getRange(
      start.key, start.orEqual, start.offset,
      _end.key, _end.orEqual, _end.offset,
      limit, targetBytes, streamingMode,
      iter, this.isSnapshot, reverse)
  }

  getRangeRaw(start: KeySelector<Key>, end: KeySelector<Key> | null,
      limit: number, targetBytes: number, streamingMode: StreamingMode,
      iter: number, reverse: boolean): Promise<KVList<Key, Value>> {
    return this.getRangeNative(
      keySelector.toNative(start, this._keyEncoding.pack),
      end != null ? keySelector.toNative(end, this._keyEncoding.pack) : null,
      limit, targetBytes, streamingMode, iter, reverse)
    .then(r => ({more: r.more, results: this._encodeRangeResult(r.results)}))
  }

  async *getRangeBatch(
      _start: Key | KeySelector<Key>, // Consider also supporting string / buffers for these.
      _end?: Key | KeySelector<Key>, // If not specified, start is used as a prefix.
      opts: RangeOptions = {}) {
    let start = keySelector.toNative(keySelector.from(_start), this._keyEncoding.pack)
    let end = _end == null
      ? keySelector.firstGreaterOrEqual(strInc(start.key))
      : keySelector.toNative(keySelector.from(_end), this._keyEncoding.pack)
    let limit = opts.limit || 0
    const streamingMode = opts.streamingMode == null ? StreamingMode.Iterator : opts.streamingMode

    let iter = 0
    while (1) {
      const {results, more} = await this.getRangeNative(start, end,
        limit, 0, streamingMode, ++iter, opts.reverse || false)

      if (results.length) {
        if (!opts.reverse) start = keySelector.firstGreaterThan(results[results.length-1][0])
        else end = keySelector.firstGreaterOrEqual(results[results.length-1][0])
      }

      // This destructively consumes results.
      yield this._encodeRangeResult(results)
      if (!more) break

      if (limit) {
        limit -= results.length
        if (limit <= 0) break
      }
    }
  }

  // TODO: getRangeBatchStartsWith

  async *getRange(
      start: Key | KeySelector<Key>, // Consider also supporting string / buffers for these.
      end?: Key | KeySelector<Key>,
      opts?: RangeOptions) {
    for await (const batch of this.getRangeBatch(start, end, opts)) {
      for (const pair of batch) yield pair
    }
  }

  // TODO: getRangeStartsWtih

  async getRangeAll(
      start: Key | KeySelector<Key>,
      end?: Key | KeySelector<Key>, // if undefined, start is used as a prefix.
      opts: RangeOptions = {}) {
    const childOpts: RangeOptions = {...opts}
    if (childOpts.streamingMode == null) childOpts.streamingMode = StreamingMode.WantAll

    const result: [Buffer, Buffer][] = []
    for await (const batch of this.getRangeBatch(start, end, childOpts)) {
      result.push.apply(result, batch)
    }
    return result
  }

  getRangeAllStartsWith(prefix: Key | KeySelector<Key>, opts?: RangeOptions) {
    return this.getRangeAll(prefix, undefined, opts)
  }
  
  // If end is not specified, clears entire range starting with prefix.
  clearRange(start: Key, end?: Key) {
    const _start = this._keyEncoding.pack(start)
    const _end = end == null ? strInc(_start) : this._keyEncoding.pack(end)
    this._tn.clearRange(_start, _end)
  }
  // Just an alias for unary clearRange.
  clearRangeStartsWith(prefix: Key) {
    return this.clearRange(prefix)
  }

  watch(key: Key, listener: Callback<void>) {
    // This API is probably fine... I could return a Promise for the watch but
    // its weird to cancel promises in JS, and adding a .cancel() method to
    // the primise feels weird.
    return this._tn.watch(this._keyEncoding.pack(key), listener)
  }

  addReadConflictRange(start: Key, end: Key) {
    this._tn.addReadConflictRange(this._keyEncoding.pack(start), this._keyEncoding.pack(end))
  }
  addReadConflictKey(key: Key) {
    const keyBuf = this._keyEncoding.pack(key)
    this._tn.addReadConflictRange(keyBuf, strNext(keyBuf))
  }

  addWriteConflictRange(start: Key, end: Key) {
    this._tn.addWriteConflictRange(this._keyEncoding.pack(start), this._keyEncoding.pack(end))
  }
  addWriteConflictKey(key: Key) {
    const keyBuf = this._keyEncoding.pack(key)
    this._tn.addWriteConflictRange(keyBuf, strNext(keyBuf))
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

  getAddressesForKey(key: Key): string[] {
    return this._tn.getAddressesForKey(this._keyEncoding.pack(key))
  }

  // **** Atomic operations

  atomicOpNative(opType: MutationType, key: NativeValue, oper: NativeValue) {
    this._tn.atomicOp(opType, key, oper)
  }
  atomicOpKB(opType: MutationType, key: Key, oper: Buffer) {
    this._tn.atomicOp(opType, this._keyEncoding.pack(key), oper)
  }
  atomicOp(opType: MutationType, key: Key, oper: Value) {
    this._tn.atomicOp(opType, this._keyEncoding.pack(key), this._valueEncoding.pack(oper))
  }

  // Does little-endian addition on encoded values. Value transformer should encode to some
  // little endian type.
  add(key: Key, oper: Value) { this.atomicOp(MutationType.Add, key, oper) }
  max(key: Key, oper: Value) { this.atomicOp(MutationType.Max, key, oper) }
  min(key: Key, oper: Value) { this.atomicOp(MutationType.Min, key, oper) }

  // Raw buffer variants are provided here to support fancy bit packing semantics.
  bitAnd(key: Key, oper: Value) { this.atomicOp(MutationType.BitAnd, key, oper) }
  bitOr(key: Key, oper: Value) { this.atomicOp(MutationType.BitOr, key, oper) }
  bitXor(key: Key, oper: Value) { this.atomicOp(MutationType.BitXor, key, oper) }
  bitAndBuf(key: Key, oper: Buffer) { this.atomicOpKB(MutationType.BitAnd, key, oper) }
  bitOrBuf(key: Key, oper: Buffer) { this.atomicOpKB(MutationType.BitOr, key, oper) }
  bitXorBuf(key: Key, oper: Buffer) { this.atomicOpKB(MutationType.BitXor, key, oper) }

  // Performs lexicographic comparison of byte strings. Sets the value in the
  // database to the lexographical min / max of its current value and the
  // value supplied as a parameter. If the key does not exist in the database
  // this is the same as set().
  byteMin(key: Key, val: Value) { this.atomicOp(MutationType.ByteMin, key, val) }
  byteMax(key: Key, val: Value) { this.atomicOp(MutationType.ByteMax, key, val) }

  setVersionstampedKeyRaw(keyBytes: Buffer, value: Value) {
    this.atomicOpNative(MutationType.SetVersionstampedKey, keyBytes, this._valueEncoding.pack(value))
  }

  // This sets the key [prefix, 10 bytes versionstamp, suffix] to value.
  setVersionstampedKeyBuf(prefix: Buffer | null, suffix: Buffer | null, value: Value) {
    const stampPos = prefix ? prefix.length : 0
    // Last 2 bytes of key need to contain LE length.
    const len = stampPos + 10 + (suffix ? suffix.length : 0) + 2

    const key = Buffer.alloc(len)
    if (prefix) prefix.copy(key, 0)
    if (suffix) suffix.copy(key, stampPos + 10)
    key.writeUInt16LE(stampPos, key.length - 2)

    this.atomicOpNative(MutationType.SetVersionstampedKey, key, this._valueEncoding.pack(value))
  }
  setVersionstampedKey(prefix: Key, suffix: Buffer | null, value: Value) {
    const _prefix = asBuf(this._keyEncoding.pack(prefix))
    this.setVersionstampedKeyBuf(_prefix, suffix, value)
  }
  setVersionstampedKeyPrefix(prefix: Key, value: Value) {
    this.setVersionstampedKey(prefix, null, value)
  }

  // Set key = [10 byte versionstamp, remaining bytes of value]. Value must be
  // 10+ bytes. First 10 bytes are overwritten by the versionstamp.
  // This function leans on the value transformer to pack & unpack versionstamps.
  setVersionstampedValue(key: Key, value: Value) { this.atomicOp(MutationType.SetVersionstampedValue, key, value) }
  setVersionstampedValueBuf(key: Key, value: Buffer) { this.atomicOpKB(MutationType.SetVersionstampedValue, key, value) }

  // This packs the value by prefixing the version stamp to the
  // valueEncoding's packed version of the value.
  // This is intended for use with getPackedVersionstampedValue.
  setPackedVersionstampedValue(key: Key, value: Value) {
    const valPack = packVersionstampedValue(null, asBuf(this._valueEncoding.pack(value)))
    this.atomicOpKB(MutationType.SetVersionstampedValue, key, valPack)
  }
}
