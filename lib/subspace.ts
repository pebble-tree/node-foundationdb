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

  constructor(prefix: Buffer | null, keyXf: Transformer<KeyIn, KeyOut>, valueXf: Transformer<ValIn, ValOut>) {
    this.prefix = prefix || EMPTY_BUF
    this.keyXf = keyXf
    this.valueXf = valueXf

    this._bakedKeyXf = prefix ? prefixTransformer(prefix, keyXf) : keyXf
  }

  // All these template parameters make me question my life choices.
  // at(prefix: KeyIn | null): Scope<KeyIn, KeyOut, ValIn, ValOut>;
  // at<ChildKeyIn, ChildKeyOut>(prefix: KeyIn | null, keyXf: Transformer<ChildKeyIn, ChildKeyOut>): Scope<ChildKeyIn, ChildKeyOut, ValIn, ValOut>;
  // at<ChildKeyIn, ChildKeyOut, ChildValIn, ChildValOut>(prefix: KeyIn | null, keyXf?: Transformer<ChildKeyIn, ChildKeyOut>, valueXf?: Transformer<ChildValIn, ChildValOut>): Scope<ChildKeyIn, ChildKeyOut, ChildValIn, ChildValOut>;
  at<ChildKeyIn, ChildKeyOut, ChildValIn, ChildValOut>(prefix: KeyIn | null, keyXf: Transformer<any, any> = this.keyXf, valueXf: Transformer<any, any> = this.valueXf) {
    const _prefix = prefix == null ? null : this.keyXf.pack(prefix)
    return new Subspace(concatPrefix(this.prefix, _prefix), keyXf, valueXf)
  }
}

export const defaultSubspace: Subspace = new Subspace(null, defaultTransformer, defaultTransformer)
