module.exports = function mapToObject(map) {
  const o = {}
  for (const [ k, v ] of map) o[k] = v
  return o
}
