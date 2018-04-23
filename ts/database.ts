import * as fdb from './native'
import {eachOption} from './util'
import Transaction from './transaction'

export type DbOptions = any


export default class Database {
  _db: fdb.NativeDatabase

  constructor(db: fdb.NativeDatabase, opts: DbOptions) {
    this._db = db
    eachOption('DatabaseOption', opts, (code, val) => db.setOption(code, val))
  }

  createTransaction(opts?: any) {
    return new Transaction(this._db.createTransaction(), opts)
  }

  async transact<T>(body: (tn: Transaction) => Promise<T>, opts?: any): Promise<T> {
    const tn = this.createTransaction(opts)

    // Logic described here:
    // https://apple.github.io/foundationdb/api-c.html#c.fdb_transaction_on_error
    do {
      try {
        const result: T = await body(tn)
        await tn.commit()
        return result // Ok, success.
      } catch (err) {
        await tn.onError(err.code) // If this throws, punt error to caller.
        // If that passed, loop.
      }
    } while (true)
  }
}
