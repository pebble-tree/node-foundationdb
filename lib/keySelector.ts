import {NativeValue} from './native'
export interface KeySelector<Key> {
  key: Key,
  orEqual: boolean
  offset: number
  _isKeySelector: true
}

const keySelector = <Key>(key: Key, orEqual: boolean, offset: number): KeySelector<Key> => (
  {key, orEqual, offset, _isKeySelector: true}
)

const add = <Key>(sel: KeySelector<Key>, addOffset: number) => keySelector(sel.key, sel.orEqual, sel.offset + addOffset)

const next = <Key>(sel: KeySelector<Key>) => add(sel, 1)
const prev = <Key>(sel: KeySelector<Key>) => add(sel, -1)

// From the [docs](https://apple.github.io/foundationdb/developer-guide.html#key-selectors):
// 
// To resolve these key selectors FoundationDB first finds the last key less
// than the reference key (or equal to the reference key, if the equality flag
// is true), then moves forward a number of keys equal to the offset (or
// backwards, if the offset is negative).
const lastLessThan = <Key>(key: Key) => keySelector(key, false, 0)
const lastLessOrEqual = <Key>(key: Key) => keySelector(key, true, 0)
const firstGreaterThan = <Key>(key: Key) => keySelector(key, true, 1)
const firstGreaterOrEqual = <Key>(key: Key) => keySelector(key, false, 1)

const isKeySelector = <Key>(val: any): val is KeySelector<Key> => {
  return (typeof val === 'object' && val != null && val._isKeySelector)
}

const from = <Key>(valOrKS: Key | KeySelector<Key>): KeySelector<Key> => (
  isKeySelector(valOrKS) ? valOrKS : firstGreaterOrEqual(valOrKS)
)

const toNative = <Key>(sel: KeySelector<Key>, txn: {packBoundKey(key: Key): string | Buffer}): KeySelector<NativeValue> => (
  keySelector(txn.packBoundKey(sel.key), sel.orEqual, sel.offset)
)

export default Object.assign(keySelector, {
  add, next, prev, lastLessThan, lastLessOrEqual, firstGreaterThan, firstGreaterOrEqual, isKeySelector, from, toNative
})
