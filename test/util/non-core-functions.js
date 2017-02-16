module.exports = function nonCoreFunctions(fns) {
  // TODO: not sure if that works on windows :(
  // can't just do .startsWith(path.sep) since windows also
  // adds a drive letter
  return fns.filter(x => x.info.file.startsWith('/'))
}
