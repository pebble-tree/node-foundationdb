// This file implements the tuple layer. More details are here:
// https://apple.github.io/foundationdb/data-modeling.html#tuples
//
// And the typecodes are here:
// https://github.com/apple/foundationdb/blob/master/design/tuple.md

const sizeLimits: number[] = new Array(8)

{
  sizeLimits[0] = 1
  for(var i = 1; i < sizeLimits.length; i++) {
    sizeLimits[i] = sizeLimits[i-1] * 256
    sizeLimits[i-1] -= 1
  }
  sizeLimits[7] -= 1
}

const maxInt = Math.pow(2, 53) - 1
const minInt = -Math.pow(2, 53)

const nullByte = new Buffer('00', 'hex')

const findNullBytes = (buf: Buffer, pos: number, searchForTerminators: boolean = false) => {
  var nullBytes = [];

  var found;
  for(pos; pos < buf.length; ++pos) {
    if(searchForTerminators && found && buf[pos] !== 255) {
      break;
    }

    found = false
    if(buf[pos] === 0) {
      found = true
      nullBytes.push(pos)
    }
  }

  if(!found && searchForTerminators) {
    nullBytes.push(buf.length)
  }

  return nullBytes
}

// Supported tuple item types. Note that integers are supported but not floats
// Floats are defined in the spec, they just haven't been added here. Please
// file an issue if float support is important to you.
export type TupleItem = null | number | string | Buffer | ArrayBuffer

function encode(item: TupleItem) {
  if(typeof item === 'undefined') throw new TypeError('Packed element cannot be undefined')

  else if(item === null) return nullByte;

  //byte string or unicode string
  else if(Buffer.isBuffer(item) || item instanceof ArrayBuffer || typeof item === 'string') {
    let unicode: boolean
    let itemBuf: Buffer

    if(typeof item === 'string') {
      itemBuf = new Buffer(item, 'utf8');
      unicode = true
    }
    else {
      itemBuf = Buffer.from(item)
      unicode = false
    }

    const nullBytes = findNullBytes(itemBuf, 0)

    const encodedString = new Buffer(2 + itemBuf.length + nullBytes.length)
    encodedString[0] = unicode ? 2 : 1

    let srcPos = 0
    let targetPos = 1
    for(let i = 0; i < nullBytes.length; ++i) {
      itemBuf.copy(encodedString, targetPos, srcPos, nullBytes[i]+1)
      targetPos += nullBytes[i]+1 - srcPos
      srcPos = nullBytes[i]+1
      encodedString[targetPos++] = 255
    }

    itemBuf.copy(encodedString, targetPos, srcPos)
    encodedString[encodedString.length-1] = 0

    return encodedString
  }

  //64-bit integer
  else if(item % 1 === 0) {
    const negative = item < 0
    let posItem = Math.abs(item)

    let length = 0
    for(; length < sizeLimits.length; ++length) {
      if(posItem <= sizeLimits[length]) break
    }

    if(item > maxInt || item < minInt) {
      throw new RangeError('Cannot pack signed integer larger than 54 bits')
    }

    const prefix = negative ? 20 - length : 20 + length

    const outBuf = new Buffer(length+1)
    outBuf[0] = prefix
    for(var byteIdx = length-1; byteIdx >= 0; --byteIdx) {
      var b = posItem & 0xff;
      if(negative) outBuf[byteIdx+1] = ~b
      else outBuf[byteIdx+1] = b

      posItem = (posItem - b) / 0x100
    }

    return outBuf
  }

  else throw new TypeError('Packed element must either be a string, a buffer, an integer, or null');
}

export function pack(arr: TupleItem[]) {
  if(!(arr instanceof Array))
    throw new TypeError('fdb.tuple.pack must be called with a single array argument');

  let totalLength = 0

  const outArr = []
  for(var i = 0; i < arr.length; ++i) {
    outArr.push(encode(arr[i]))
    totalLength += outArr[i].length
  }

  return Buffer.concat(outArr, totalLength)
}

function decodeNumber(buf: Buffer, offset: number, bytes: number) {
  var negative = bytes < 0
  bytes = Math.abs(bytes)

  var num = 0
  var mult = 1
  var odd
  for(var i = bytes-1; i >= 0; --i) {
    var b = buf[offset+i]
    if(negative) b = -(~b & 0xff)

    if(i == bytes-1) odd = b & 0x01

    num += b * mult
    mult *= 0x100
  }

  if(num > maxInt || num < minInt || (num === minInt && odd)) {
    throw new RangeError('Cannot unpack signed integers larger than 54 bits')
  }

  return num
}

type DecodeItem = {pos: number, value: TupleItem}
function decode(buf: Buffer, pos: number): DecodeItem {
  const code = buf[pos]
  let value: TupleItem

  if(code === 0) {
    value = null
    pos++
  }
  else if(code === 1 || code === 2) {
    let nullBytes = findNullBytes(buf, pos+1, true)

    let start = pos+1
    let end = nullBytes[nullBytes.length-1]

    if(code === 2 && nullBytes.length === 1) {
      value = buf.toString('utf8', start, end)
    }
    else {
      value = new Buffer(end-start-(nullBytes.length-1))
      let valuePos = 0

      for(let i=0; i < nullBytes.length && start < end; ++i) {
        buf.copy(value, valuePos, start, nullBytes[i])
        valuePos += nullBytes[i] - start
        start = nullBytes[i] + 2
        if(start <= end) {
          value[valuePos++] = 0
        }
      }

      if(code === 2) value = value.toString('utf8')
    }

    pos = end + 1
  }
  else if(Math.abs(code-20) <= 7) {
    value = (code === 20) ? 0 : decodeNumber(buf, pos+1, code-20)
    pos += Math.abs(20-code) + 1
  }
  else if(Math.abs(code-20) <= 8)
    throw new RangeError('Cannot unpack signed integers larger than 54 bits');
  else
    throw new TypeError('Unknown data type in DB: ' + buf + ' at ' + pos);

  return { pos, value }
}

export function unpack(key: Buffer) {
  let res: DecodeItem = { pos: 0, value: null }
  const arr = []

  while(res.pos < key.length) {
    res = decode(key, res.pos)
    arr.push(res.value)
  }

  return arr
}

export function range(arr: TupleItem[]) {
  var packed = pack(arr)
  return {
    begin: Buffer.concat([packed, nullByte]),
    // TODO: Is this just strInc?
    end: Buffer.concat([packed, new Buffer('ff', 'hex')])
  }
}
