// The transformer type is used to transparently translate keys and values
// through an encoder and decoder function.

export type ValWithUnboundVersionStamp = {data: Buffer, stampPos: number, codePos?: number}
export type Transformer<T> = {
  // The tuple type supports embedding versionstamps, but the versionstamp
  // isn't known until the transaction has been committed.

  // TODO: I need a name for this fancy structure.
  pack(k: T): Buffer | string | ValWithUnboundVersionStamp,
  unpack(k: Buffer): T,
}

export const isPackUnbound = (val: Buffer | string | ValWithUnboundVersionStamp): val is ValWithUnboundVersionStamp => (
  typeof val === 'object' && !Buffer.isBuffer(val)
)

export function asBound(val: Buffer | ValWithUnboundVersionStamp): Buffer;
export function asBound(val: Buffer | string | ValWithUnboundVersionStamp): Buffer | string;
export function asBound(val: any) {
  if (isPackUnbound(val)) throw Error('Value with unbound versionstamp not allowed here')
  return val
}
