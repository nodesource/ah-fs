const spok = require('spok')

module.exports = function arrayElements(n) {
  return function checkCount(array) {
    if (array == null) {
      return console.error(`Expected ${n}, but found array to be null.`)
    }
    const pass = spok.array(array) && array.length === n
    if (!pass) console.error(`Expected ${n}, but found ${array.length} elements.`)
    return pass
  }
}
