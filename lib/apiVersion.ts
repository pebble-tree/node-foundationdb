import nativeMod from './native'

// To update:
// - regenerate lib/opts.g.ts using scripts/gentsopts.ts
// - re-run the test suite and binding test suite
export const MAX_VERSION = 600

let apiVersion: number | null = null
export const get = () => apiVersion

export function set(version: number) {
  if (typeof version !== 'number') throw TypeError('version must be a number')

  if (apiVersion != null) {
    if (apiVersion !== version) {
      throw Error('foundationdb already initialized with API version ' + apiVersion)
    }
  } else {
    // Old versions probably work fine, but there are no tests to check.
    if (version < 500) throw Error('FDB Node bindings only support API versions >= 500')
    
    if (version > MAX_VERSION) {
      // I'm going to allow it to work anyway since API changes seem to be
      // backwards compatible, but its possible that API-incompatible changes
      // will break something.
      console.warn(`Warning: Using foundationdb protocol version ${version} > ${MAX_VERSION}. This version of node-foundationdb only officially supports protocol version ${MAX_VERSION} or earlier.

Please update node-foundationdb if you haven't done so then file a ticket:
https://github.com/josephg/node-foundationdb/issues
`)
    }

    nativeMod.setAPIVersion(version)
    apiVersion = version
  }
}
