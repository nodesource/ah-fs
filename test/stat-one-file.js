const test = require('tape')
const fs = require('fs')
const spok = require('spok')
const FileSystemActivityCollector = require('../')
const arrayElements = require('./util/array-elements')
const tick = require('./util/tick')
const ROOTID = 1

/* eslint-disable no-unused-vars */
const ocat = require('./util/ocat')
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 15, true))
}
/* eslint-enable no-unused-vars */

const collector = new FileSystemActivityCollector({
    start            : process.hrtime()
  , captureArguments : true
  , captureSource    : false
}).enable()

test('\nstating one file', function(t) {
  fs.stat(__filename, onstat)

  function onstat(err, info) {
    t.iferror(err, 'onstat should not return an error')
    collector.cleanAllResources()

    // allow `stat` 'after' to fire (needs 2 ticks)
    tick(2, () => {
      collector.processStacks()
      runTest(collector.fileSystemActivities)
    })
  }

  function runTest(activities) {
    t.equal(activities.size, 1, '1 fs activity')
    const stat = activities.values().next().value
    spok(t, stat,
       { $topic       : 'stat'
       , id           : spok.number
       , type         : 'FSREQWRAP'
       , triggerId    : ROOTID
       , init         : arrayElements(1)
       , initStack    : spok.array
       , before       : arrayElements(1)
       , beforeStacks : arrayElements(1)
       , after        : arrayElements(1)
       , afterStacks  : arrayElements(1)
       , destroy      : arrayElements(1)
       , destroyStack : spok.array
        , resource    : null }
    )
    t.end()
  }
})
