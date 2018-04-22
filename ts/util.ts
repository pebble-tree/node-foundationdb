const dbOptions = require('../options.g.json')

export type OptVal = string | number | Buffer | null
export type Opts = {
  [name: string]: OptVal
}
export type OptionIter = (code: number, val: OptVal) => void
export const eachOption = (optType: 'NetworkOption' | 'DatabaseOption' | 'TransactionOption', opts: Opts, iterfn: OptionIter) => {
  const validOptions = dbOptions[optType]

  for (const k in opts) {
    const details = validOptions[k]
    if (details == null) {
      console.warn('Warning: Ignoring unknown option', k)
      continue
    }

    const {code, type} = details
    const userVal = opts[k]

    switch (type) {
      case 'none':
        if (userVal !== 'true' && userVal !== 1) console.warn('Ignoring value for key', k)
        iterfn(details.code, null)
        break
      case 'string': case 'bytes':
        iterfn(details.code, Buffer.from(userVal as any))
        break
      case 'int':
        if (typeof userVal !== 'number') console.warn('unexpected value for key', k, 'expected int')
        iterfn(details.code, (userVal as number)|0)
        break
    }
  }

}