const fs = require('fs')
const parseString = require('xml2js').parseString
const xml = fs.readFileSync('/Users/josephg/3rdparty/foundationdb/fdbclient/vexillographer/fdb.options', 'utf8')

const filename = 'lib/opts.g.ts'
const output = fs.createWriteStream(filename)

const toCamelCase = str => str.replace(/(^\w|_\w)/g, c =>
  c.length == 1 ? c : c[1].toUpperCase()
)

const splitLines = str => str.split(/\s*(.{10,70})(?:\s+|$)/).filter(x => x)

const comment = '\/\/'

parseString(xml, (err, result) => {
  if (err) throw err

  result.Options.Scope.forEach(scope => {
    const name = scope.$.name

    output.write(`export enum ${name} {\n`)
    scope.Option.forEach(({$:opt}) => {
      const {code, description, paramDescription} = opt
      const type = opt.paramType ? opt.paramType.toLowerCase() : 'none'
      const deprecated = (opt.description && opt.description.toLowerCase() === 'deprecated')

      if (deprecated) output.write(`  ${comment} Deprecated\n`)
      else if (description) output.write(splitLines(description).map(s => `  ${comment} ${s}\n`).join(''))

      output.write(`  ${toCamelCase(opt.name)} = ${opt.code},\n\n`)
    })

    output.write(`}\n\n`)
  })

  //console.log(JSON.stringify(result, null, 2))

  output.end()
  console.log('wrote', filename)
})
