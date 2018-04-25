import 'mocha'
import fdb = require('../lib')
import assert = require('assert')

describe('tuple', () => {
  it('roundtrips expected values', () => {
    const data = ['hi', null, '👾', 321, 0, -100]
    assert.deepStrictEqual(fdb.tuple.unpack(fdb.tuple.pack(data)), data)
  })
      
  describe('Conformance tests', () => {
    // These are from the examples here:
    // https://github.com/apple/foundationdb/blob/master/design/tuple.md

    const testConformance = (name: string, value: any, expectedEncoding: string) => {
      it(name, () => testEq(value, expectedEncoding))
    }

    const testEq = (val: any, bytes: string) => {
      const encoded = fdb.tuple.pack([val])
      assert.deepStrictEqual(encoded, Buffer.from(bytes, 'ascii'))

      const decoded = fdb.tuple.unpack(encoded)
      assert.deepStrictEqual(decoded, [val])
    }
    
    testConformance('null', null, '\x00')
    testConformance('false', false, '\x26')
    testConformance('true', true, '\x27')
    testConformance('bytes', Buffer.from('foo\x00bar', 'ascii'), '\x01foo\x00\xffbar\x00')
    testConformance('string', "F\u00d4O\u0000bar", '\x02F\xc3\x94O\x00\xffbar\x00')
    // TODO: Nested tuple
    testConformance('nested tuples',
      [Buffer.from('foo\x00bar', 'ascii'), null, []],
      '\x05\x01foo\x00\xffbar\x00\x00\xff\x05\x00\x00'
    )
    testConformance('zero', 0, '\x14') // zero
    testConformance('integer', -5551212, '\x11\xabK\x93') // integer
    // testConformance(-42.
  })
})