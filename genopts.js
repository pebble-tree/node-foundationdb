const fs = require('fs')
const parseString = require('xml2js').parseString
const xml = fs.readFileSync('/Users/josephg/3rdparty/foundationdb/fdbclient/vexillographer/fdb.options', 'utf8')

parseString(xml, (err, result) => {
  if (err) throw err

  const options = {}

  result.Options.Scope.forEach(scope => {
    const opts = {}
    scope.Option.forEach(({$:opt}) => {
      // TODO: Should we camelCase opt.name?
      opts[opt.name] = {
        code: opt.code,
        description: opt.description,
        // 'string', 'int', 'bytes' or 'none'
        type: opt.paramType ? opt.paramType.toLowerCase() : 'none',
        paramDescription: opt.paramDescription,
      }

      if (opt.description && opt.description.toLowerCase() === 'deprecated') opts[opt.name].deprecated = true
    })
    options[scope.$.name] = opts
  })

  //console.log(JSON.stringify(result, null, 2))
  const processed_result = JSON.stringify(options, null, 2)

  const filename = 'lib/options.g.json'
  fs.writeFileSync(filename, processed_result)
  console.log('wrote', filename)
})
