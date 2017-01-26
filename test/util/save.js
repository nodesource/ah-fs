const fs = require('fs')
const path = require('path')
const stringify = require('json-stringify-safe')

module.exports = function save(name, obj) {
  const file = path.join(__dirname, '..', 'tmp', name + '.json')
  fs.writeFileSync(file, stringify(obj, null, 2), 'utf8')
  console.log('saved to ' + file)
}
