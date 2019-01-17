import assert = require('assert')
import {
  Watch,
  NativeTransaction,
  Callback,
  NativeValue,
  Version,
} from './native'
import {
  strInc,
  strNext,
  // packVersionstampedValue,
  // unpackVersionstampedValue,
  asBuf
} from './util'
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

import {
  Transformer,
} from './transformer'

import {
  UnboundStamp,
  packVersionStamp,
  packPrefixedVersionStamp,
  packVersionStampPrefixSuffix
} from './versionStamp'

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

export type KVList<Key, Value> = {
  results: [Key, Value][], // [key, value] pair.
  more: boolean,
}

export {Watch}

export type WatchOptions = {
  throwAllErrors?: boolean
}

// Polyfill for node < 10.0 to make asyncIterators work (getRange / getRangeBatch).
if ((<any>Symbol).asyncIterator == null) (<any>Symbol).asyncIterator = Symbol.for("Symbol.asyncIterator")

// NativeValue is string | Buffer because the C code accepts either format.
// But all values returned from methods will actually just be Buffer.
export default class Transaction<KeyIn = NativeValue, KeyOut = Buffer, ValIn = NativeValue, ValOut = Buffer> {
  _tn: NativeTransaction
  isSnapshot: boolean
  _keyEncoding: Transformer<KeyIn, KeyOut>
  _valueEncoding: Transformer<ValIn, ValOut>
  code: number = 0

  constructor(tn: NativeTransaction, snapshot: boolean,
      keyEncoding: Transformer<KeyIn, KeyOut>, valueEncoding: Transformer<ValIn, ValOut>,
      opts?: TransactionOptions) {
    this._tn = tn
    this._keyEncoding = keyEncoding
    this._valueEncoding = valueEncoding
    if (opts) eachOption(transactionOptionData, opts, (code, val) => tn.setOption(code, val))
    this.isSnapshot = snapshot
  }

  bakeCode(into: UnboundStamp) {
    if (this.isSnapshot) throw new Error('Cannot use this method in a snapshot transaction')
    if (into.codePos != null) {
      // We edit the buffer in-place but leave the codepos as is so if the txn
      // retries it'll overwrite the code.
      into.data.writeInt16BE(this.code++, into.codePos)
    }
  }

  resetCode() { this.code = 0 }

  // Usually you should pass options when the transaction is constructed.
  // Options are shared between a transaction object and any other aliases
  // (snapshots, transactions in other scopes)
  setOption(opt: TransactionOptionCode, value?: number | string | Buffer) {
    // TODO: Check type of passed option is valid.
    this._tn.setOption(opt, (value == null) ? null : value)
  }

  // Returns a mirror transaction which does snapshot reads.
  snapshot(): Transaction<KeyIn, KeyOut, ValIn, ValOut> {
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

  get(key: KeyIn): Promise<ValOut | null>
  get(key: KeyIn, cb: Callback<ValOut | null>): void
  get(key: KeyIn, cb?: Callback<ValOut | null>) {
    const keyBuf = this._keyEncoding.pack(key)
    return cb
      ? this._tn.get(keyBuf, this.isSnapshot, (err, val) => {
        cb(err, val == null ? null : this._valueEncoding.unpack(val))
      })
      : this._tn.get(keyBuf, this.isSnapshot)
        .then(val => val == null ? null : this._valueEncoding.unpack(val))
  }

  getKey(_sel: KeyIn | KeySelector<KeyIn>): Promise<KeyOut | null> {
    const sel = keySelector.from(_sel)
    return this._tn.getKey(this._keyEncoding.pack(sel.key), sel.orEqual, sel.offset, this.isSnapshot)
      .then(keyOrNull => (
        keyOrNull != null ? this._keyEncoding.unpack(keyOrNull) : null
      ))
  }


  set(key: KeyIn, val: ValIn) {
    this._tn.set(this._keyEncoding.pack(key), this._valueEncoding.pack(val))
  }

  clear(key: KeyIn) {
    const pack = this._keyEncoding.pack(key)
    this._tn.clear(pack)
  }

  // This just destructively edits the result in-place.
  _encodeRangeResult(r: [Buffer, Buffer][]): [KeyOut, ValOut][] {
    // This is slightly faster but I have to throw away the TS checks in the process. :/
    for (let i = 0; i < r.length; i++) {
      ;(r as any)[i][0] = this._keyEncoding.unpack(r[i][0])
      ;(r as any)[i][1] = this._valueEncoding.unpack(r[i][1])
    }
    return r as any as [KeyOut, ValOut][]
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

  getRangeRaw(start: KeySelector<KeyIn>, end: KeySelector<KeyIn> | null,
      limit: number, targetBytes: number, streamingMode: StreamingMode,
      iter: number, reverse: boolean): Promise<KVList<KeyOut, ValOut>> {
    return this.getRangeNative(
      keySelector.toNative(start, this._keyEncoding),
      end != null ? keySelector.toNative(end, this._keyEncoding) : null,
      limit, targetBytes, streamingMode, iter, reverse)
    .then(r => ({more: r.more, results: this._encodeRangeResult(r.results)}))
  }

  async *getRangeBatch(
      _start: KeyIn | KeySelector<KeyIn>, // Consider also supporting string / buffers for these.
      _end?: KeyIn | KeySelector<KeyIn>, // If not specified, start is used as a prefix.
      opts: RangeOptions = {}) {
    let start = keySelector.toNative(keySelector.from(_start), this._keyEncoding)
    let end = _end == null
      ? keySelector.firstGreaterOrEqual(strInc(start.key))
      : keySelector.toNative(keySelector.from(_end), this._keyEncoding)
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
      start: KeyIn | KeySelector<KeyIn>, // Consider also supporting string / buffers for these.
      end?: KeyIn | KeySelector<KeyIn>,
      opts?: RangeOptions) {
    for await (const batch of this.getRangeBatch(start, end, opts)) {
      for (const pair of batch) yield pair
    }
  }

  // TODO: getRangeStartsWtih

  async getRangeAll(
      start: KeyIn | KeySelector<KeyIn>,
      end?: KeyIn | KeySelector<KeyIn>, // if undefined, start is used as a prefix.
      opts: RangeOptions = {}) {
    const childOpts: RangeOptions = {...opts}
    if (childOpts.streamingMode == null) childOpts.streamingMode = StreamingMode.WantAll

    const result: [KeyOut, ValOut][] = []
    for await (const batch of this.getRangeBatch(start, end, childOpts)) {
      result.push.apply(result, batch)
    }
    return result
  }

  getRangeAllStartsWith(prefix: KeyIn | KeySelector<KeyIn>, opts?: RangeOptions) {
    return this.getRangeAll(prefix, undefined, opts)
  }
  
  // If end is not specified, clears entire range starting with prefix.
  clearRange(start: KeyIn, end?: KeyIn) {
    const _start = this._keyEncoding.pack(start)
    const _end = end == null ? strInc(_start) : this._keyEncoding.pack(end)
    this._tn.clearRange(_start, _end)
  }
  // Just an alias for unary clearRange.
  clearRangeStartsWith(prefix: KeyIn) {
    this.clearRange(prefix)
  }

  watch(key: KeyIn, opts?: WatchOptions): Watch {
    const throwAll = opts && opts.throwAllErrors
    return this._tn.watch(this._keyEncoding.pack(key), !throwAll)
  }

  addReadConflictRange(start: KeyIn, end: KeyIn) {
    this._tn.addReadConflictRange(this._keyEncoding.pack(start), this._keyEncoding.pack(end))
  }
  addReadConflictKey(key: KeyIn) {
    const keyBuf = this._keyEncoding.pack(key)
    this._tn.addReadConflictRange(keyBuf, strNext(keyBuf))
  }

  addWriteConflictRange(start: KeyIn, end: KeyIn) {
    this._tn.addWriteConflictRange(this._keyEncoding.pack(start), this._keyEncoding.pack(end))
  }
  addWriteConflictKey(key: KeyIn) {
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

  // We don't return a promise here because doing so makes the API basically impossible to use, just like watch.
  getVersionStamp(): {promise: Promise<Buffer>}
  getVersionStamp(cb: Callback<Buffer>): void
  getVersionStamp(cb?: Callback<Buffer>) {
    return cb ? this._tn.getVersionStamp(cb) : {promise: this._tn.getVersionStamp()}
  }

  getAddressesForKey(key: KeyIn): string[] {
    return this._tn.getAddressesForKey(this._keyEncoding.pack(key))
  }

  // **** Atomic operations

  atomicOpNative(opType: MutationType, key: NativeValue, oper: NativeValue) {
    this._tn.atomicOp(opType, key, oper)
  }
  atomicOpKB(opType: MutationType, key: KeyIn, oper: Buffer) {
    this._tn.atomicOp(opType, this._keyEncoding.pack(key), oper)
  }
  atomicOp(opType: MutationType, key: KeyIn, oper: ValIn) {
    this._tn.atomicOp(opType, this._keyEncoding.pack(key), this._valueEncoding.pack(oper))
  }

  // Does little-endian addition on encoded values. Value transformer should encode to some
  // little endian type.
  add(key: KeyIn, oper: ValIn) { this.atomicOp(MutationType.Add, key, oper) }
  max(key: KeyIn, oper: ValIn) { this.atomicOp(MutationType.Max, key, oper) }
  min(key: KeyIn, oper: ValIn) { this.atomicOp(MutationType.Min, key, oper) }

  // Raw buffer variants are provided here to support fancy bit packing semantics.
  bitAnd(key: KeyIn, oper: ValIn) { this.atomicOp(MutationType.BitAnd, key, oper) }
  bitOr(key: KeyIn, oper: ValIn) { this.atomicOp(MutationType.BitOr, key, oper) }
  bitXor(key: KeyIn, oper: ValIn) { this.atomicOp(MutationType.BitXor, key, oper) }
  bitAndBuf(key: KeyIn, oper: Buffer) { this.atomicOpKB(MutationType.BitAnd, key, oper) }
  bitOrBuf(key: KeyIn, oper: Buffer) { this.atomicOpKB(MutationType.BitOr, key, oper) }
  bitXorBuf(key: KeyIn, oper: Buffer) { this.atomicOpKB(MutationType.BitXor, key, oper) }

  // Performs lexicographic comparison of byte strings. Sets the value in the
  // database to the lexographical min / max of its current value and the
  // value supplied as a parameter. If the key does not exist in the database
  // this is the same as set().
  byteMin(key: KeyIn, val: ValIn) { this.atomicOp(MutationType.ByteMin, key, val) }
  byteMax(key: KeyIn, val: ValIn) { this.atomicOp(MutationType.ByteMax, key, val) }


  setVersionstampedKeyRaw(keyBytes: Buffer, value: ValIn) {
    this.atomicOpNative(MutationType.SetVersionstampedKey, keyBytes, this._valueEncoding.pack(value))
  }

  // This sets the key [prefix, 10 bytes versionstamp, suffix] to value.
  setVersionstampedKeyBuf(prefix: Buffer | undefined, suffix: Buffer | undefined, value: ValIn) {
    const key = packVersionStampPrefixSuffix(prefix, suffix, true)
    // console.log('key', key)
    this.atomicOpNative(MutationType.SetVersionstampedKey, key, this._valueEncoding.pack(value))
  }

  // TODO: These method names are a bit confusing
  setVersionstampedKey(key: KeyIn, value: ValIn) {
    const pack = this._keyEncoding.packUnboundStamp!(key)
    this.bakeCode(pack)
    this.setVersionstampedKeyRaw(packVersionStamp(pack, true), value)
  }

  setVersionstampSuffixedKey(key: KeyIn, value: ValIn, suffix?: Buffer) {
    const prefix = asBuf(this._keyEncoding.pack(key))
    this.setVersionstampedKeyBuf(prefix, suffix, value)
  }
  // setVersionstampedKeyPrefix(prefix: Key, value: Value) {
  //   this.setVersionstampedKey(prefix, null, value)
  // }



  // Get the specified key and split out the stamp and value pair. This
  // requires that the stamp was put at offset 0 (the start) of the value.
  async getVersionstampPrefixedValue(key: KeyIn): Promise<{stamp: Buffer, val: ValOut} | null> {
    const val = await this._tn.get(this._keyEncoding.pack(key), this.isSnapshot)
    return val == null ? null
      : {
        stamp: val.slice(0, 10),
        val: this._valueEncoding.unpack(val.slice(10))
      }
  }

  // Set key = [10 byte versionstamp, value in bytes].
  // This function leans on the value transformer to pack & unpack versionstamps.
  setVersionstampPrefixedValue(key: KeyIn, value: ValIn, prefix?: Buffer) {
    const valBuf = asBuf(this._valueEncoding.pack(value))
    const val = packVersionStampPrefixSuffix(prefix, valBuf, false)
    this.atomicOpKB(MutationType.SetVersionstampedValue, key, val)
  }

  setVersionstampedValue(key: KeyIn, value: ValIn) {
    const pack = this._valueEncoding.packUnboundStamp!(value)
    this.atomicOpKB(MutationType.SetVersionstampedValue, key, packVersionStamp(pack, false))
  }

  // This packs the value by prefixing the version stamp to the
  // valueEncoding's packed version of the value.
  // This is intended for use with getPackedVersionstampedValue.
  //
  // If your key transformer sometimes returns an unbound value for this key
  // (eg using tuples), just call set(key, value).
  // setVersionstampedValueBuf(key: KeyIn, value: Buffer, pos: number = 0) {
  //   // const valPack = packVersionstampedValue(asBuf(this._valueEncoding.pack(value)), pos)
  //   const valPack = packVersionStampRaw(value, pos, true)
  //   this.atomicOpKB(MutationType.SetVersionstampedValue, key, valPack)
  // }
}
