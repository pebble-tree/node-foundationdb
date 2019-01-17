// The transformer type is used to transparently translate keys and values
// through an encoder and decoder function.

import {asBuf, concat2} from './util'
import {UnboundStamp} from './versionStamp'

export type Transformer<In, Out> = {
  // The tuple type supports embedding versionstamps, but the versionstamp
  // isn't known until the transaction has been committed.

  // TODO: I need a name for this fancy structure.
  pack(val: In): Buffer | string,
  unpack(buf: Buffer): Out,

  // These are hooks for the tuple type to support unset versionstamps
  packUnboundStamp?(val: In): UnboundStamp,
  bakeVersion?(val: In, versionStamp: Buffer): void,
}

// export const isPackUnbound = (val: Buffer | string | UnboundStamp): val is UnboundStamp => (
//   typeof val === 'object' && !Buffer.isBuffer(val)
// )

// export function asBound(val: Buffer | UnboundStamp): Buffer;
// export function asBound(val: Buffer | string | UnboundStamp): Buffer | string;
// export function asBound(val: any) {
//   if (isPackUnbound(val)) throw Error('Value with unbound versionstamp not allowed here')
//   return val
// }

const id = <T>(x: T) => x
export const defaultTransformer: Transformer<Buffer | string, Buffer> = {
  pack: id,
  unpack: id
}

export const prefixTransformer = <In, Out>(prefix: string | Buffer, inner: Transformer<In, Out>): Transformer<In, Out> => {
  const _prefix = asBuf(prefix)
  const transformer: Transformer<In, Out> = {
    pack(v: In): Buffer | string {
      // If you heavily nest these it'll get pretty inefficient.
      const innerVal = inner.pack(v)
      return concat2(_prefix, asBuf(innerVal))
    },
    unpack(buf: Buffer) {
      return inner.unpack(buf.slice(_prefix.length))
    },
  }

  if (inner.packUnboundStamp) transformer.packUnboundStamp = (val: In): UnboundStamp => {
    const innerVal = inner.packUnboundStamp!(val)

    return {
      data: concat2(_prefix, innerVal.data),
      stampPos: _prefix.length + innerVal.stampPos,
      codePos: innerVal.codePos != null ? _prefix.length + innerVal.codePos : undefined,
    }
  }

  if (inner.bakeVersion) transformer.bakeVersion = inner.bakeVersion.bind(inner)

  return transformer
}