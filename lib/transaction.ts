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

import * as apiVersion from './apiVersion'
import {
  ValWithUnboundVersionStamp,
  Transformer,
  isPackUnbound,
  asBound,
} from './transformer'

const byteZero = Buffer.alloc(1)
byteZero.writeUInt8(0, 0)

// const bufEmpty = Buffer.alloc(0)

const packedBufLen = (dataLen: number, isKey: boolean): number => {
  const use4ByteOffset = apiVersion.get()! >= 520
  return dataLen + (use4ByteOffset ? 4 : (isKey ? 2 : 0))
}

// If preallocated is set, the buffer already has space for the offset at the end
const packVersionStampRaw = (data: Buffer, pos: number, isKey: boolean, preallocated: boolean): Buffer => {
  const use4ByteOffset = apiVersion.get()! >= 520

  // Before API version 520 it was a bit of a mess:
  // - Keys had a 2 byte offset appended to the end
  // - Values did not support an offset at all. Versionstamps in a value must be the first 10 bytes of that value.
  if (!isKey && !use4ByteOffset && pos > 0) {
    throw Error('API version <520 do not support versionstamps in a key value at a non-zero offset')
  }

  const result = preallocated ? data : Buffer.alloc(packedBufLen(data.length, isKey))
  if (!preallocated) data.copy(result, 0)

  if (use4ByteOffset) result.writeUInt32LE(pos, result.length - 4)
  else if (isKey) result.writeUInt16LE(pos, result.length - 2)

  return result
}
const packVersionStamp = ({data, stampPos}: ValWithUnboundVersionStamp, isKey: boolean): Buffer => (
  packVersionStampRaw(data, stampPos, isKey, false)
)

const packVersionStampPrefixSuffix = (prefix: Buffer | null, suffix: Buffer | null, isKey: boolean): Buffer => {
  const use4ByteOffset = apiVersion.get()! >= 520

  const stampPos = prefix != null ? prefix.length : 0
  const buf = Buffer.alloc(packedBufLen(stampPos + 10 + (suffix != null ? suffix.length : 0), isKey))
  if (prefix) prefix.copy(buf)
  if (suffix) suffix.copy(buf, stampPos + 10)
  packVersionStampRaw(buf, stampPos, isKey, true)
  return buf
}


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
export default class Transaction<Key = NativeValue, Value = NativeValue> {
  _tn: NativeTransaction
  isSnapshot: boolean
  _keyEncoding: Transformer<Key>
  _valueEncoding: Transformer<Value>
  code: number = 0

  constructor(tn: NativeTransaction, snapshot: boolean,
      keyEncoding: Transformer<Key>, valueEncoding: Transformer<Value>,
      opts?: TransactionOptions) {
    this._tn = tn
    this._keyEncoding = keyEncoding
    this._valueEncoding = valueEncoding
    if (opts) eachOption(transactionOptionData, opts, (code, val) => tn.setOption(code, val))
    this.isSnapshot = snapshot
  }

  // Most methods need the key and value to be known. Unbound versionstamps in
  // key / values only works for a few methods (like set).
  packBoundKey(key: Key): string | Buffer { return asBound(this._keyEncoding.pack(key)) }
  packBoundVal(val: Value): string | Buffer { return asBound(this._valueEncoding.pack(val)) }

  bakeCode(into: ValWithUnboundVersionStamp) {
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
    const keyBuf = this.packBoundKey(key)
    return cb
      ? this._tn.get(keyBuf, this.isSnapshot, (err, val) => {
        cb(err, val == null ? null : this._valueEncoding.unpack(val))
      })
      : this._tn.get(keyBuf, this.isSnapshot)
        .then(val => val == null ? null : this._valueEncoding.unpack(val))
  }

  getKey(_sel: Key | KeySelector<Key>): Promise<Key | null> {
    const sel = keySelector.from(_sel)
    return this._tn.getKey(this.packBoundKey(sel.key), sel.orEqual, sel.offset, this.isSnapshot)
      .then(keyOrNull => (
        keyOrNull != null ? this._keyEncoding.unpack(keyOrNull) : null
      ))
  }

  set(key: Key, val: Value) {
    // console.log('key', key)
    const keyPack = this._keyEncoding.pack(key)
    const valPack = this._valueEncoding.pack(val)

    // If the key or value contains an unbound versionstamp we need to use special methods.
    // TODO: In this case, it'd be nice to automatically bake the committed versionstamp back into the tuple.
    if (isPackUnbound(keyPack)) {
      if (isPackUnbound(valPack)) throw new TypeError('Cannot set a key/value pair where both key and value have undefined versionstamp fields')
      // console.log('unbound pack', keyPack)
      this.bakeCode(keyPack)
      this._tn.atomicOp(MutationType.SetVersionstampedKey, packVersionStamp(keyPack, true), valPack)
    } else if (isPackUnbound(valPack)) {
      this.bakeCode(valPack)
      this._tn.atomicOp(MutationType.SetVersionstampedValue, keyPack, packVersionStamp(valPack, false))
    } else {
      this._tn.set(keyPack, valPack)
    }
  }
  clear(key: Key) {
    const pack = asBound(this._keyEncoding.pack(key))
    this._tn.clear(pack)
  }

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
      keySelector.toNative(start, this),
      end != null ? keySelector.toNative(end, this) : null,
      limit, targetBytes, streamingMode, iter, reverse)
    .then(r => ({more: r.more, results: this._encodeRangeResult(r.results)}))
  }

  async *getRangeBatch(
      _start: Key | KeySelector<Key>, // Consider also supporting string / buffers for these.
      _end?: Key | KeySelector<Key>, // If not specified, start is used as a prefix.
      opts: RangeOptions = {}) {
    let start = keySelector.toNative(keySelector.from(_start), this)
    let end = _end == null
      ? keySelector.firstGreaterOrEqual(strInc(start.key))
      : keySelector.toNative(keySelector.from(_end), this)
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

    const result: [Key, Value][] = []
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
    const _start = this.packBoundKey(start)
    const _end = end == null ? strInc(_start) : this.packBoundKey(end)
    this._tn.clearRange(_start, _end)
  }
  // Just an alias for unary clearRange.
  clearRangeStartsWith(prefix: Key) {
    this.clearRange(prefix)
  }

  watch(key: Key, opts?: WatchOptions): Watch {
    const throwAll = opts && opts.throwAllErrors
    return this._tn.watch(this.packBoundKey(key), !throwAll)
  }

  addReadConflictRange(start: Key, end: Key) {
    this._tn.addReadConflictRange(this.packBoundKey(start), this.packBoundKey(end))
  }
  addReadConflictKey(key: Key) {
    const keyBuf = this.packBoundKey(key)
    this._tn.addReadConflictRange(keyBuf, strNext(keyBuf))
  }

  addWriteConflictRange(start: Key, end: Key) {
    this._tn.addWriteConflictRange(this.packBoundKey(start), this.packBoundKey(end))
  }
  addWriteConflictKey(key: Key) {
    const keyBuf = this.packBoundKey(key)
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

  getAddressesForKey(key: Key): string[] {
    return this._tn.getAddressesForKey(this.packBoundKey(key))
  }

  // **** Atomic operations

  atomicOpNative(opType: MutationType, key: NativeValue, oper: NativeValue) {
    this._tn.atomicOp(opType, key, oper)
  }
  atomicOpKB(opType: MutationType, key: Key, oper: Buffer) {
    this._tn.atomicOp(opType, this.packBoundKey(key), oper)
  }
  atomicOp(opType: MutationType, key: Key, oper: Value) {
    this._tn.atomicOp(opType, this.packBoundKey(key), this.packBoundVal(oper))
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
    this.atomicOpNative(MutationType.SetVersionstampedKey, keyBytes, this.packBoundVal(value))
  }

  // This sets the key [prefix, 10 bytes versionstamp, suffix] to value.
  setVersionstampedKeyBuf(prefix: Buffer | null, suffix: Buffer | null, value: Value) {
    const key = packVersionStampPrefixSuffix(prefix, suffix, true)
    this.atomicOpNative(MutationType.SetVersionstampedKey, key, this.packBoundVal(value))
  }

  // TODO: These method names are really confusing.
  setVersionstampedKey(prefix: Key, suffix: Buffer | null, value: Value) {
    const _prefix = asBuf(this.packBoundKey(prefix))
    this.setVersionstampedKeyBuf(_prefix, suffix, value)
  }
  // setVersionstampedKeyPrefix(prefix: Key, value: Value) {
  //   this.setVersionstampedKey(prefix, null, value)
  // }



  // Get the specified key and split out the stamp and value pair. This
  // requires that the stamp was put at offset 0 (the start) of the value.
  async getVersionstampPrefixedValue(key: Key): Promise<{stamp: Buffer, val: Value} | null> {
    const val = await this._tn.get(this.packBoundKey(key), this.isSnapshot)
    return val == null ? null
      : {
        stamp: val.slice(0, 10),
        val: this._valueEncoding.unpack(val.slice(10))
      }
  }

  // Set key = [10 byte versionstamp, value in bytes].
  // This function leans on the value transformer to pack & unpack versionstamps.
  setVersionstampPrefixedValue(key: Key, value: Value, valPrefix?: Buffer) {
    const valBuf = asBuf(this.packBoundVal(value))
    const val = packVersionStampPrefixSuffix(valPrefix || null, valBuf, false)
    this.atomicOpKB(MutationType.SetVersionstampedValue, key, val)
  }

  // This packs the value by prefixing the version stamp to the
  // valueEncoding's packed version of the value.
  // This is intended for use with getPackedVersionstampedValue.
  //
  // If your key transformer sometimes returns an unbound value for this key
  // (eg using tuples), just call set(key, value).
  // setVersionstampedValueBuf(key: Key, value: Buffer, pos: number = 0) {
  //   // const valPack = packVersionstampedValue(asBuf(this._valueEncoding.pack(value)), pos)
  //   const valPack = packVersionStampRaw(value, pos, true)
  //   this.atomicOpKB(MutationType.SetVersionstampedValue, key, valPack)
  // }
}
