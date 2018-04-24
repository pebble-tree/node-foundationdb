import {Value} from './native'
export interface KeySelector {
  key: Value,
  orEqual: boolean
  offset: number
}

export const keySelector = (key: Value, orEqual: boolean, offset: number) => ({key, orEqual, offset})

export const add = (sel: KeySelector, addOffset: number) => keySelector(sel.key, sel.orEqual, sel.offset + addOffset)

export const next = (sel: KeySelector) => add(sel, 1)
export const prev = (sel: KeySelector) => add(sel, -1)

export const lastLessThan = (key: Value) => keySelector(key, false, 0)
export const lastLessOrEqual = (key: Value) => keySelector(key, true, 0)
export const firstGreaterThan = (key: Value) => keySelector(key, true, 1)
export const firstGreaterOrEqual = (key: Value) => keySelector(key, false, 1) // not true, 0?

export const toKeySelector = (key: KeySelector | string | Buffer): KeySelector => {
  return (typeof key === 'string' || Buffer.isBuffer(key)) ? firstGreaterOrEqual(key) : key
}
