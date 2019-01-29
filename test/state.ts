import 'mocha'
import assert = require('assert')
import * as fdb from '../lib'
import {testApiVersion} from './util'

fdb.setAPIVersion(testApiVersion)

describe('state tests', () => {
  it('throws if a closed database has a tn run on it', async () => {
    const db = fdb.openSync()
    db.close()
    await assert.rejects(db.get('x'))
  })

  it.skip('cancels pending watches when the database is closed', async () => {
    // This doesn't actually work, though I thought it would.
    const db = fdb.openSync()
    const w = await db.getAndWatch('x')
    db.close()

    await w.promise

  })

})