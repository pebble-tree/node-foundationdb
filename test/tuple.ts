import 'mocha'
import assert = require('assert')
import {tuple, TupleItem} from '../lib'

describe('tuple', () => {
  const assertRoundTrip = (val: TupleItem, strict: boolean = false) => {
    const packed = tuple.pack([val])
    const unpacked = tuple.unpack(packed, strict)[0]
    assert.deepStrictEqual(unpacked, val)
  }
  const assertRoundTripBytes = (orig: Buffer, strict: boolean = false) => {
    const val = tuple.unpack(orig, strict)[0]
    const packed = tuple.pack([val])
    // console.log(orig.toString('hex'), val, packed.toString('hex'))
    assert.deepStrictEqual(packed, orig)
  }

  it('roundtrips expected values', () => {
    const data = ['hi', null, '👾', 321, 0, -100]
    assertRoundTrip(data)

    assertRoundTrip(0.75)
    assertRoundTrip({type: 'float', value: 0.5}, true)
  })

  it('preserves encoding of values in strict mode', () => {
    // There's a few ways NaN is encoded.
    assertRoundTripBytes(Buffer.from('210007ffffffffffff', 'hex'), true) // double
    assertRoundTripBytes(Buffer.from('21fff8000000000000', 'hex'), true)
    assertRoundTripBytes(Buffer.from('20ffc00000', 'hex'), true) // TODO: 
    assertRoundTripBytes(Buffer.from('20003fffff', 'hex'), true)
    // Do any other nan encodings exist?
    
    // Also any regular integers should be preserved.
    assertRoundTripBytes(Buffer.from('2080000000', 'hex'), true)
    assertRoundTripBytes(Buffer.from('218000000000000000', 'hex'), true)
  })

  it('preserves encoding of exotic numbers', () => {
    // I'm sure there's lots more I'm missing here.
    assertRoundTripBytes(Buffer.from('217fffffffffffffff', 'hex'), true) // This is -0.
  })

  it('stalls on invalid input', () => {
    tuple.unpack(tuple.unpack(Buffer.from('\x01\x01tester_output\x00\xff\x01workspace\x01\x00', 'ascii'))[0] as Buffer)
  })
      
  describe('Conformance tests', () => {
    // These are from the examples here:
    // https://github.com/apple/foundationdb/blob/master/design/tuple.md

    const testConformance = (name: string, value: any, bytes: Buffer | string) => {
      it(name, () => {
        const encoded = tuple.pack([value])
        assert.deepStrictEqual(encoded, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'ascii'))

        const decoded = tuple.unpack(encoded)
        // Node 8
        if (isNaN(value)) assert(isNaN(decoded[0] as number))
        else assert.deepStrictEqual(decoded, [value])
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
    // testConformance('nan float', NaN, Buffer.from('0007ffffffffffff', 'hex')
    testConformance('nan double', NaN, Buffer.from('21fff8000000000000', 'hex'))
  })
})