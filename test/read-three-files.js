const test = require('tape')
const spok = require('spok')
const FileSystemActivityCollector = require('../')
const arrayElements = require('./util/array-elements')
const tick = require('./util/tick')
const { checkBuffer, checkFunction, allEqual } = require('./util/checks')

/* eslint-disable no-unused-vars */
const ocat = require('./util/ocat')
const mapToObject = require('./util/map-to-object')
const save = require('./util/save')
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 15, true))
}
/* eslint-enable no-unused-vars */

function contextOf(activity) {
  return activity.resource.context
}

function functionsOf(activity) {
  return activity.resource.functions
}

const fs = require('fs')
const BUFFERLENGTH = 18

const collector = new FileSystemActivityCollector({
    start            : process.hrtime()
  , captureArguments : true
  , captureSource    : false
  , bufferLength     : BUFFERLENGTH
}).enable()

function readFiles(cb) {
  let tasks = 3
  fs.readFile(require.resolve('../'), onreadFile)
  fs.readFile(require.resolve('../package.json'), onreadFile)
  fs.readFile(__filename, onreadFile)

  function onreadFile(err) {
    if (err) return cb(err)
    if (--tasks === 0) cb()
  }
}
test('\nreading one file', function(t) {
  readFiles(onread)

  function onread(err, src) {
    t.iferror(err, 'onread should not return an error')
    // capture/clean resources before having another round through
    // the event loop clean things up, i.e. we want to grab the args
    // whenever possible
    collector.cleanAllResources()

    // allow `close` 'after' and `destroy` to fire
    tick(2, () => {
      collector
        .processStacks()
        .stringifyBuffers()

      save('three-files.read-fs-only', Array.from(collector.fileSystemActivities))
      t.end()
    })
  }
})
