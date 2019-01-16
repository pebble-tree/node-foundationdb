import * as apiVersion from './apiVersion'
import {
  ValWithUnboundVersionStamp,
} from './transformer'

const packedBufLen = (dataLen: number, isKey: boolean): number => {
  const use4ByteOffset = apiVersion.get()! >= 520
  return dataLen + (use4ByteOffset ? 4 : (isKey ? 2 : 0))
}

// If preallocated is set, the buffer already has space for the offset at the end.
// pos is the position in data. It does not take into account the prefix length.
const packVersionStampRaw = (data: Buffer, pos: number, isKey: boolean, preallocated: boolean): Buffer => {
  const use4ByteOffset = apiVersion.get()! >= 520

  // Before API version 520 it was a bit of a mess:
  // - Keys had a 2 byte offset appended to the end
  // - Values did not support an offset at all. Versionstamps in a value must be the first 10 bytes of that value.
  if (!isKey && !use4ByteOffset && pos > 0) {
    throw Error('API version <520 do not support versionstamps in a key value at a non-zero offset')
  }

  const result = preallocated ? data : Buffer.alloc(packedBufLen(data.length, isKey))
  if (!preallocated) data.copy(result, 0)

  if (use4ByteOffset) result.writeUInt32LE(pos, result.length - 4)
  else if (isKey) result.writeUInt16LE(pos, result.length - 2)

  return result
}
// Exported for binding tester. TODO: Consider moving this into its own file and exporting it generally.
export const packVersionStamp = ({data, stampPos}: ValWithUnboundVersionStamp, isKey: boolean): Buffer => (
  packVersionStampRaw(data, stampPos, isKey, false)
)
export const packPrefixedVersionStamp = (prefix: Buffer, {data, stampPos}: ValWithUnboundVersionStamp, isKey: boolean): Buffer => {
  // console.log('pl', prefix.length, 'dl', data.length, 'to', packedBufLen(prefix.length + data.length, isKey))
  const buf = Buffer.alloc(packedBufLen(prefix.length + data.length, isKey))
  prefix.copy(buf)
  data.copy(buf, prefix.length)
  return packVersionStampRaw(buf, prefix.length + stampPos, isKey, true)
}

const zeroBuf = Buffer.allocUnsafe(0)
export const packVersionStampPrefixSuffix = (prefix: Buffer = zeroBuf, suffix: Buffer = zeroBuf, isKey: boolean): Buffer => {
  const buf = Buffer.alloc(packedBufLen(prefix.length + 10 + suffix.length, isKey))
  prefix.copy(buf)
  suffix.copy(buf, prefix.length + 10)
  return packVersionStampRaw(buf, prefix.length, isKey, true)
}