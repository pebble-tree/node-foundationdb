import Database from './database'
import Transaction from './transaction'

export const getBoundaryKeys = (db: Database, begin: Buffer, end: Buffer) => {
  const tn = db.rawCreateTransaction({
    read_system_keys: true,
    lock_aware: true,
  })

  
}