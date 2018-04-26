import 'mocha'
import fdb = require('../lib')
import assert = require('assert')
import {TupleItem} from '../lib/tuple'

const {tuple} = fdb
describe('tuple', () => {
  const assertRoundTrip = (val: TupleItem) => {
    const packed = tuple.pack([val])
    const unpacked = tuple.unpack(packed, true)[0]
    assert.deepStrictEqual(unpacked, val)
  }

  it('roundtrips expected values', () => {
    const data = ['hi', null, '👾', 321, 0, -100]
    assertRoundTrip(data)

    assertRoundTrip(0.75)
    assertRoundTrip({type: 'singlefloat', value: 0.5})
  })

  it('stalls on invalid input', () => {
    tuple.unpack(tuple.unpack(Buffer.from('\x01\x01tester_output\x00\xff\x01workspace\x01\x00', 'ascii'))[0] as Buffer)
  })

  // it('regression', () => {
  //   const orig = Buffer.from('\x01\x01tester_output\x00\xff\x01workspace\x00\xff\x00', 'ascii')
  //   assert.deepEqual(orig, tuple.pack(tuple.unpack(orig)))
  // })
      
  describe('Conformance tests', () => {
    // These are from the examples here:
    // https://github.com/apple/foundationdb/blob/master/design/tuple.md

    const testConformance = (name: string, value: any, bytes: Buffer | string) => {
      it(name, () => {
        const encoded = tuple.pack([value])
        assert.deepStrictEqual(encoded, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'ascii'))

        const decoded = tuple.unpack(encoded)
        assert.deepStrictEqual(decoded, [value])
      })
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