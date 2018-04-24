import {Value} from './native'
export interface KeySelector {
  key: Value,
  orEqual: boolean
  offset: number
}

const keySelector = (key: Value, orEqual: boolean, offset: number): KeySelector => (
  {key, orEqual, offset}
)
// const keySelector = (key: Value | KeySelector, orEqual: boolean = false, offset: number = 1): KeySelector => {
//   if (typeof key === 'string' || Buffer.isBuffer(key)) return {key, orEqual, offset}
//   else return key
// }

const add = (sel: KeySelector, addOffset: number) => keySelector(sel.key, sel.orEqual, sel.offset + addOffset)

const next = (sel: KeySelector) => add(sel, 1)
const prev = (sel: KeySelector) => add(sel, -1)

const lastLessThan = (key: Value) => keySelector(key, false, 0)
const lastLessOrEqual = (key: Value) => keySelector(key, true, 0)
const firstGreaterThan = (key: Value) => keySelector(key, true, 1)
const firstGreaterOrEqual = (key: Value) => keySelector(key, false, 1) // not true, 0?

const from = (valOrKS: Value | KeySelector): KeySelector => (
  (typeof valOrKS === 'string' || Buffer.isBuffer(valOrKS))
    ? firstGreaterOrEqual(valOrKS)
    : valOrKS
)

export default Object.assign(keySelector, {
  add, next, prev, lastLessThan, lastLessOrEqual, firstGreaterThan, firstGreaterOrEqual, from
})
