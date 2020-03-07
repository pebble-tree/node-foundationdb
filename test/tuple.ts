import 'mocha'
import assert = require('assert')
import {tuple, TupleItem} from '../lib'

const floatBytes = (x: number) => {
  const result = Buffer.alloc(4)
  result.writeFloatBE(x, 0)
  return result
}

describe('tuple', () => {
  const assertRoundTrip = (val: TupleItem, strict: boolean = false) => {
    const packed = tuple.pack([val])
    const unpacked = tuple.unpack(packed, strict)[0]
    assert.deepStrictEqual(unpacked, val)

    // Check that numbered int -> bigint has no effect on encoded output.
    if (typeof val === 'number' && Number.isInteger(val)) {
      const packed2 = tuple.pack([BigInt(val)])
      assert.deepStrictEqual(packed2, packed, 'Value encoded differently with bigint encoder')
    }
  }
  const assertRoundTripBytes = (orig: Buffer, strict: boolean = false) => {
    const val = tuple.unpack(orig, strict)[0] as TupleItem
    const packed = tuple.pack([val])
    // console.log(orig.toString('hex'), val, packed.toString('hex'))
    assert.deepStrictEqual(packed, orig)
  }
  const assertEncodesAs = (value: TupleItem, data: Buffer | string | number[]) => {
    const encoded = tuple.pack([value])
    let bytes = Buffer.isBuffer(data) ? data
      : typeof data === 'string' ? Buffer.from(data, 'ascii')
      : Buffer.from(data)
    assert.deepStrictEqual(encoded, bytes)

    // Check that numbered int -> bigint has no effect on encoded output.
    if (typeof value === 'number' && Number.isInteger(value)) {
      const encoded2 = tuple.pack([BigInt(value)])
      assert.deepStrictEqual(encoded2, bytes, 'Value encoded differently with bigint encoder')
    }

    const decoded = tuple.unpack(encoded)
    // Node 8
    if (typeof value === 'number' && isNaN(value as number)) assert(isNaN(decoded[0] as number))
    else assert.deepStrictEqual(decoded, [value])
  }

  it('roundtrips expected values', () => {
    const data = ['hi', null, '👾', 321, 0, -100]
    assertRoundTrip(data)

    assertRoundTrip(0.75)
    assertRoundTrip(BigInt(12341234123412341234))
    assertRoundTrip(BigInt(-12341234123412341234))
    assertRoundTrip({type: 'float', value: 0.5, rawEncoding:floatBytes(0.5)}, true)
  })

  it('implements bigint encoding in a way that matches the java bindings', () => {
    // These are ported from here:
    // https://github.com/apple/foundationdb/blob/becc01923a30c1bc2ba158b293dbb38de7585c72/bindings/java/src/test/com/apple/foundationdb/test/TupleTest.java#L109-L122
    assertEncodesAs(BigInt('0x7fffffffffffffff'), [0x1C, 0x7f, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
    assertEncodesAs(BigInt('0x8000000000000000'), [0x1C, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    assertEncodesAs(BigInt('0xffffffffffffffff'), [0x1C, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
    assertEncodesAs(BigInt('0x10000000000000000'), [0x1D, 0x09, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    assertEncodesAs(-0xffffffff, [0x10, 0x00, 0x00, 0x00, 0x00])
    assertEncodesAs(-BigInt('0x7ffffffffffffffe'), [0x0C, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01])
    assertEncodesAs(-BigInt('0x7fffffffffffffff'), [0x0C, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    assertEncodesAs(-BigInt('0x8000000000000000'), [0x0C, 0x7f, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
    assertEncodesAs(-BigInt('0x8000000000000001'), [0x0C, 0x7f, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF - 1])
    assertEncodesAs(-BigInt('0xffffffffffffffff'), [0x0C, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
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

    const testConformance = (name: string, value: TupleItem, bytes: Buffer | string) => {
      it(name, () => assertEncodesAs(value, bytes))
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
    testConformance('bound version stamp',
      {type: 'versionstamp', value: Buffer.alloc(12).fill(0xe3)},
      Buffer.from('33e3e3e3e3e3e3e3e3e3e3e3e3', 'hex')
    )
    // TODO: unbound versionstamps
  })
})