import 'mocha'
import fdb = require('../lib')
import assert = require('assert')
import {
  prefix,
} from './util'

process.on('unhandledRejection', err => { throw err })

const db = fdb.openSync()
// TODO: Check this also works using db.at() syntax.
const scopedDb = db.atPrefix(Buffer.from(prefix))

beforeEach(() => db.clearRangeStartsWith(prefix))
afterEach(() => db.clearRangeStartsWith(prefix))

describe('sub spaces', () => {
  it('lets you set and get items from a child space', async () => {
    await scopedDb.set('x', 'hi')
    assert.deepStrictEqual(await scopedDb.get('x'), Buffer.from('hi'))
    assert.deepStrictEqual(await db.get(prefix + 'x'), Buffer.from('hi'))
  })

  it('lets you recursively telescope in')
  it('works with all the range functions')
})