// A subspace is a wrapper around a prefix and key and value transformers. This
// is nearly equivalent to subspaces in the other bindings - the difference is
// it also includes kv transformers, so a subspace here will also automatically
// encode and decode keys and values.

import { Transformer, prefixTransformer, defaultTransformer } from "./transformer"
import { NativeValue } from "./native"
import { asBuf, concat2 } from "./util"

const EMPTY_BUF = Buffer.alloc(0)

const concatPrefix = (p1: Buffer, p2: string | Buffer | null) => (
  p2 == null ? p1
    : p1.length === 0 ? asBuf(p2)
    : concat2(p1, asBuf(p2))
)


// Template parameters refer to the types of the allowed key and values you pass
// in to the database (eg in a set(keyin, valin) call) and the types of keys and
// values returned. KeyIn == KeyOut and ValIn == ValOut in almost all cases.
export default class Subspace<KeyIn = NativeValue, KeyOut = Buffer, ValIn = NativeValue, ValOut = Buffer> {
  prefix: Buffer // This is baked into bakedKeyXf but we hold it so we can call .at / .atPrefix.
  keyXf: Transformer<KeyIn, KeyOut>
  valueXf: Transformer<ValIn, ValOut>

  _bakedKeyXf: Transformer<KeyIn, KeyOut> // This is cached from _prefix + keyXf.

  constructor(prefix: string | Buffer | null, keyXf: Transformer<KeyIn, KeyOut>, valueXf: Transformer<ValIn, ValOut>) {
    this.prefix = prefix != null ? Buffer.from(prefix) : EMPTY_BUF
    this.keyXf = keyXf
    this.valueXf = valueXf

    this._bakedKeyXf = prefix ? prefixTransformer(prefix, keyXf) : keyXf
  }

  // All these template parameters make me question my life choices, but this is
  // legit all the variants. Typescript can probably infer using less than this,
  // but I honestly don't trust it not to land with any or unknown or something
  // in some of the derived types
  at(prefix: KeyIn | null): Subspace<KeyIn, KeyOut, ValIn, ValOut>;
  at<CKI, CKO>(prefix: KeyIn | null, keyXf: Transformer<CKI, CKO>): Subspace<CKI, CKO, ValIn, ValOut>;
  at<CVI, CVO>(prefix: KeyIn | null, keyXf: undefined, valueXf: Transformer<CVI, CVO>): Subspace<KeyIn, KeyOut, CVI, CVO>;
  at<CKI, CKO, CVI, CVO>(prefix: KeyIn | null, keyXf?: Transformer<CKI, CKO>, valueXf?: Transformer<CVI, CVO>): Subspace<CKI, CKO, CVI, CVO>;
  // ***
  at(prefix: KeyIn | null, keyXf: Transformer<any, any> = this.keyXf, valueXf: Transformer<any, any> = this.valueXf) {
    const _prefix = prefix == null ? null : this.keyXf.pack(prefix)
    return new Subspace(concatPrefix(this.prefix, _prefix), keyXf, valueXf)
  }

  /** At a child prefix thats specified without reference to the key transformer */
  atRaw(prefix: Buffer) {
    return new Subspace(concatPrefix(this.prefix, prefix), this.keyXf, this.valueXf)
  }


  withKeyEncoding<CKI, CKO>(keyXf: Transformer<CKI, CKO>): Subspace<CKI, CKO, ValIn, ValOut> {
    return new Subspace(this.prefix, keyXf, this.valueXf)
  }
  
  withValueEncoding<CVI, CVO>(valXf: Transformer<CVI, CVO>): Subspace<KeyIn, KeyOut, CVI, CVO> {
    return new Subspace(this.prefix, this.keyXf, valXf)
  }

  // GetSubspace implementation
  getSubspace() { return this }
}

export const defaultSubspace: Subspace = new Subspace(null, defaultTransformer, defaultTransformer)

export interface GetSubspace<KI, KO, VI, VO> {
  getSubspace(): Subspace<KI, KO, VI, VO>
}

export const isGetSubspace = <KI, KO, VI, VO>(obj: any): obj is GetSubspace<KI, KO, VI, VO> => {
  return obj != null && typeof obj === 'object' && 'getSubspace' in obj
}