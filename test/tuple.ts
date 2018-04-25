import 'mocha'
import fdb = require('../lib')
import assert = require('assert')

describe('tuple', () => {
  it('roundtrips expected values', () => {
    const data = ['hi', null, '👾', 321, 0, -100]
    assert.deepStrictEqual(fdb.tuple.unpack(fdb.tuple.pack(data)), data)
  })
})