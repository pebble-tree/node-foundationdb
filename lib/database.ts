import * as fdb from './native'
import Transaction, {Transformer, RangeOptions} from './transaction'
import {NativeValue} from './native'
import {KeySelector} from './keySelector'
import FDBError from './error'
import {TupleItem, pack} from './tuple'
import {asBuf} from './util'
import {eachOption} from './opts'
import {DatabaseOptions,
  TransactionOptions,
  databaseOptionData,
  StreamingMode,
  MutationType,
} from './opts.g'

const id = <T>(x: T) => x

const defaultTransformer: Transformer<Buffer | string> = {
  pack: id,
  unpack: id
}

const concat2 = (a: Buffer, b: Buffer) => {
  const result = Buffer.alloc(a.length + b.length)
  a.copy(result, 0)
  b.copy(result, a.length)
  return result
}

const prefixTransformer = <V>(prefix: string | Buffer, inner: Transformer<V>): Transformer<V> => {
  const _prefix = asBuf(prefix)
  return {
    pack(v: V) {
      // If you heavily nest these it'll get pretty inefficient.
      const buf = asBuf(inner.pack(v))
      return concat2(_prefix, buf)
    },
    unpack(buf: Buffer) {
      return inner.unpack(buf.slice(_prefix.length))
    }
  }
}

const concatPrefix = (p1: Buffer, p2: string | Buffer | null) => (
  p2 == null ? p1
    : p1.length === 0 ? asBuf(p2)
    : concat2(p1, asBuf(p2))
)

const emptyBuf = Buffer.alloc(0)

export default class Database<Key = NativeValue, Value = NativeValue> {
  _db: fdb.NativeDatabase
  _prefix: Buffer // This is baked into _bakedKeyXf but we hold it so we can call .at / .atPrefix.
  _keyXf: Transformer<Key>
  _valueXf: Transformer<Value>

  _bakedKeyXf: Transformer<Key> // This is cached from _prefix + _keyXf.

  constructor(db: fdb.NativeDatabase, prefix: Buffer | null, keyXf: Transformer<Key>, valueXf: Transformer<Value>) {
    this._db = db
    this._prefix = prefix || emptyBuf
    this._keyXf = keyXf
    this._valueXf = valueXf

    this._bakedKeyXf = prefix ? prefixTransformer(prefix, keyXf) : keyXf
  }

  setNativeOptions(opts: DatabaseOptions) {
    eachOption(databaseOptionData, opts, (code, val) => this._db.setOption(code, val))
  }

  // **** Scoping functions
  
  getRoot(): Database {
    return new Database(this._db, null, defaultTransformer, defaultTransformer)
  }
  at(prefix: Key | null): Database<Key, Value>;
  at<ChildKey>(prefix: Key | null, keyXf: Transformer<ChildKey>): Database<ChildKey, Value>;
  at<ChildKey, ChildVal>(prefix: Key | null, keyXf: Transformer<ChildKey>, valueXf: Transformer<ChildVal>): Database<ChildKey, ChildVal>;
  at<ChildKey, ChildVal>(prefix: Key | null, keyXf: Transformer<any> = this._keyXf, valueXf: Transformer<any> = this._valueXf) {
    const _prefix = prefix == null ? null : this._keyXf.pack(prefix)
    return new Database(this._db, concatPrefix(this._prefix, _prefix), keyXf, valueXf)
  }

  withKeyEncoding<ChildKey>(keyXf: Transformer<ChildKey>): Database<ChildKey, Value> {
    return new Database(this._db, this._prefix, keyXf, this._valueXf)
  }
  withValueEncoding<ChildVal>(valXf: Transformer<ChildVal>): Database<Key, ChildVal> {
    return new Database(this._db, this._prefix, this._keyXf, valXf)
  }

  // This is the API you want to use for non-trivial transactions.
  async doTn<T>(body: (tn: Transaction<Key, Value>) => Promise<T>, opts?: TransactionOptions): Promise<T> {
    const tn = this.rawCreateTransaction(opts)

    // Logic described here:
    // https://apple.github.io/foundationdb/api-c.html#c.fdb_transaction_on_error
    do {
      try {
        const result: T = await body(tn)
        await tn.rawCommit()
        return result // Ok, success.
      } catch (err) {
        // See if we can retry the transaction
        if (err instanceof FDBError) {
          await tn.rawOnError(err.code) // If this throws, punt error to caller.
          // If that passed, loop.
        } else throw err
      }
    } while (true)
  }
  // Alias for db.doTn.
  async doTransaction<T>(body: (tn: Transaction<Key, Value>) => Promise<T>, opts?: TransactionOptions): Promise<T> {
    return this.doTn(body, opts)
  }

  doOneshot(body: (tn: Transaction<Key, Value>) => void, opts?: TransactionOptions): Promise<void> {
    // TODO: Could this be written better? It doesn't need a retry loop.
    return this.doTransaction(tn => {
      body(tn)
      return Promise.resolve()
    })
  }

  // TODO: setOption.

  // Infrequently used. You probably want to use doTransaction instead.
  rawCreateTransaction(opts?: TransactionOptions) {
    return new Transaction(this._db.createTransaction(), false, this._bakedKeyXf, this._valueXf, opts)
  }

  get(key: Key): Promise<Value | null> {
    return this.doTransaction(tn => tn.snapshot().get(key))
  }
  getKey(selector: Key | KeySelector<Key>): Promise<Key | null> {
    return this.doTransaction(tn => tn.snapshot().getKey(selector))
  }
  getPackedVersionstampedValue(key: Key): Promise<{stamp: Buffer, val: Value} | null> {
    return this.doTransaction(tn => tn.snapshot().getPackedVersionstampedValue(key))
  }

  set(key: Key, value: Value) {
    return this.doOneshot(tn => tn.set(key, value))
  }

  clear(key: Key) {
    return this.doOneshot(tn => tn.clear(key))
  }

  clearRange(start: Key, end?: Key) {
    return this.doOneshot(tn => tn.clearRange(start, end))
  }

  clearRangeStartsWith(prefix: Key) {
    return this.doOneshot(tn => tn.clearRangeStartsWith(prefix))
  }

  getAndWatch(key: Key, listener: fdb.Callback<void>): Promise<fdb.Watch & {value: Value | null}> {
    return this.doTransaction(async tn => {
      const value = await tn.get(key)
      const watch = tn.watch(key, listener) as any
      watch.value = value
      return watch
    })
  }

  // TODO: What happens if this set conflicts? Does the watch promise fire to be aborted?
  setAndWatch(key: Key, value: Value, listener: fdb.Callback<void>): Promise<fdb.Watch> {
    return this.doTransaction(async tn => {
      tn.set(key, value)
      return tn.watch(key, listener)
    })
  }

  clearAndWatch(key: Key, listener: fdb.Callback<void>): Promise<fdb.Watch> {
    return this.doTransaction(async tn => {
      tn.clear(key)
      return tn.watch(key, listener)
    })
  }

  getRangeAll(
      start: Key | KeySelector<Key>,
      end?: Key | KeySelector<Key>,
      opts?: RangeOptions) {
    return this.doTransaction(async tn => tn.snapshot().getRangeAll(start, end, opts))
  }

  getRangeAllStartsWith(prefix: Key | KeySelector<Key>, opts?: RangeOptions) {
    return this.getRangeAll(prefix, undefined, opts)
  }

  // These functions all need to return their values because they're returning a child promise.
  atomicOpNative(op: MutationType, key: NativeValue, oper: NativeValue) {
    return this.doOneshot(tn => tn.atomicOpNative(op, key, oper))
  }
  atomicOp(op: MutationType, key: Key, oper: Value) {
    return this.doOneshot(tn => tn.atomicOp(op, key, oper))
  }
  atomicOpKB(op: MutationType, key: Key, oper: Buffer) {
    return this.doOneshot(tn => tn.atomicOpKB(op, key, oper))
  }
  add(key: Key, oper: Value) { return this.atomicOp(MutationType.Add, key, oper) }
  max(key: Key, oper: Value) { return this.atomicOp(MutationType.Max, key, oper) }
  min(key: Key, oper: Value) { return this.atomicOp(MutationType.Min, key, oper) }

  // Raw buffer variants are provided here to support fancy bit packing semantics.
  bitAnd(key: Key, oper: Value) { return this.atomicOp(MutationType.BitAnd, key, oper) }
  bitOr(key: Key, oper: Value) { return this.atomicOp(MutationType.BitOr, key, oper) }
  bitXor(key: Key, oper: Value) { return this.atomicOp(MutationType.BitXor, key, oper) }
  bitAndBuf(key: Key, oper: Buffer) { return this.atomicOpKB(MutationType.BitAnd, key, oper) }
  bitOrBuf(key: Key, oper: Buffer) { return this.atomicOpKB(MutationType.BitOr, key, oper) }
  bitXorBuf(key: Key, oper: Buffer) { return this.atomicOpKB(MutationType.BitXor, key, oper) }

  // Performs lexicographic comparison of byte strings. Sets the value in the
  // database to the lexographical min / max of its current value and the
  // value supplied as a parameter. If the key does not exist in the database
  // this is the same as set().
  byteMin(key: Key, oper: Value) { return this.atomicOp(MutationType.ByteMin, key, oper) }
  byteMax(key: Key, oper: Value) { return this.atomicOp(MutationType.ByteMax, key, oper) }

  setVersionstampedKeyBuf(prefix: Buffer | null, suffix: Buffer | null, value: Value) {
    return this.doOneshot(tn => tn.setVersionstampedKeyBuf(prefix, suffix, value))
  }
  setVersionstampedKey(prefix: Key, suffix: Buffer | null, value: Value) {
    return this.doOneshot(tn => tn.setVersionstampedKey(prefix, suffix, value))
  }
  setVersionstampedKeyPrefix(prefix: Key, value: Value) {
    return this.setVersionstampedKey(prefix, null, value)
  }

  setVersionstampedValue(key: Key, oper: Value) { return this.atomicOp(MutationType.SetVersionstampedValue, key, oper) }
  setVersionstampedValueBuf(key: Key, oper: Buffer) { return this.atomicOpKB(MutationType.SetVersionstampedValue, key, oper) }
  setPackedVersionstampedValue(key: Key, value: Value) {
    return this.doOneshot(tn => tn.setPackedVersionstampedValue(key, value))
  }
}

export const createDatabase = <Key = NativeValue, Val = NativeValue>(db: fdb.NativeDatabase, prefix?: string | Buffer | null, keyXf?: Transformer<Key> | null, valXf?: Transformer<Val>): Database<Key, Val> => {
  return new Database(db,
    prefix == null ? null : asBuf(prefix),
    // Typing here is ugly but eh.
    keyXf || (defaultTransformer as any as Transformer<Key>),
    valXf || (defaultTransformer as any as Transformer<Val>)
  )
}
