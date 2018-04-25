import fs = require('fs')
import xml2js = require('xml2js') // I could type this but its not important enough.

const {parseString} = xml2js
const xml = fs.readFileSync('/Users/josephg/3rdparty/foundationdb/fdbclient/vexillographer/fdb.options', 'utf8')

const filename = 'lib/opts.g.ts'
const output = fs.createWriteStream(filename)

const comment = '\/\/' // I'm really sad that this is needed.
output.write(`${comment} This file is auto-generated from gentsopts.ts. Do not edit.
import {OptionData} from './opts'

`)


const toLowerCamelCase = (str: string) => str.replace(/(^\w|_\w)/g, c =>
  c.length == 1 ? c : c[1].toUpperCase()
)
const toUpperCamelCase = (str: string) => str.replace(/(^\w|_\w)/g, c =>
  c.length == 1 ? c.toUpperCase() : c[1].toUpperCase()
)
const toLowerFirst = (str: string) => str[0].toLowerCase() + str.slice(1)

const splitLines = (str: string) => str.split(/\s*(.{10,70})(?:\s+|$)/).filter(x => x)

type OptionType = 'string' | 'int' | 'bytes' | 'none'
const readOptions = (data: any[]) => (
  data.map(({$:opt}: {$: any}) => ({
    name: opt.name as string,
    code: opt.code as number,
    description: opt.description as string | undefined,
    paramDescription: opt.paramDescription as string | undefined,
    type: (opt.paramType ? opt.paramType.toLowerCase() : 'none') as OptionType,
    deprecated: (opt.description && opt.description.toLowerCase() === 'deprecated')
  }))
)

const typeToTs = (type: 'string' | 'int' | 'bytes' | 'none') => ({
  string: 'string',
  int: 'number',
  bytes: 'Buffer',
  none: 'true'
}[type])

parseString(xml, (err, result) => {
  if (err) throw err

  const line = (str: string = '') => output.write(str + '\n')

  // First do all the normal user-visible stuff
  result.Options.Scope.forEach((scope: any) => {
    const name: string = scope.$.name
    const options = readOptions(scope.Option)
    // console.log(name)
    if (name.endsWith('Option')) {
      line(`export type ${name}s = {`)
      options.forEach(({name, type, paramDescription, deprecated}) => {
        output.write(`  ${name}?: ${typeToTs(type)}`)
        if (deprecated) output.write(` ${comment} DEPRECATED`)
        else if (paramDescription) output.write(`  ${comment} ${paramDescription}`)
        line()
      })
      line(`}\n`)
    } else {
      line(`export enum ${name} {`)
      options.forEach(({name, code, type, description, deprecated}) => {
        if (deprecated) line(`  ${comment} DEPRECATED`)
        else if (description) output.write(splitLines(description).map(s => `  ${comment} ${s}\n`).join(''))

        line(`  ${toUpperCamelCase(name)} = ${code},\n`)
      })

      line(`}\n`)
    }
  })

  result.Options.Scope.forEach((scope: any) => {
    const name: string = scope.$.name
    if (name.endsWith('Option')) {
      const options = readOptions(scope.Option)

      line(`export const ${toLowerFirst(name) + 'Data'}: OptionData = {`)
      options.forEach(({name, code, description, paramDescription, type, deprecated}) => {
        line(`  ${name}: {`)
        line(`    code: ${code},`)
        line(`    description: "${description}",`)
        if (deprecated) line(`    deprecated: ${deprecated},`)
        line(`    type: '${type}',`)
        if (type !== 'none') line(`    paramDescription: "${paramDescription}",`)
        line(`  },\n`)
      })
      line(`}\n`)
    }
  })


  //console.log(JSON.stringify(result, null, 2))

  output.end()
  console.log('wrote', filename)
})
