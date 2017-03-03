const test = require('tape')
const path = require('path')
const spok = require('spok')
const FileSystemActivityCollector = require('../')
const arrayElements = require('./util/array-elements')
const tick = require('./util/tick')

/* eslint-disable no-unused-vars */
const ocat = require('./util/ocat')
const mapToObject = require('./util/map-to-object')
const save = require('./util/save')
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 15, true))
}
/* eslint-enable no-unused-vars */

const fs = require('fs')
const BUFFERLENGTH = 18

const collector = new FileSystemActivityCollector({
    start            : process.hrtime()
  , captureArguments : true
  , captureSource    : false
  , bufferLength     : BUFFERLENGTH
}).enable()

test('\nwriting one file', function(t) {
  fs.writeFile(
      path.join(__dirname, 'tmp', 'write-one-file.tmp')
    , fs.readFileSync(__filename)
    , onwritten)
  const ROOTID = 1

  function onwritten(err) {
    t.iferror(err, 'onwritten should not return an error')
    collector.cleanAllResources()

    // allow `close` 'after' and `destroy` to fire
    tick(2, () => {
      collector
        .processStacks()
        .stringifyBuffers()
        .disable()

      save('write-fs-only', Array.from(collector.fileSystemActivities))
      // save('write-fs-all', Array.from(collector.activities))
      runTest(collector.fileSystemActivities)
    })
  }

  function runTest(activities) {
    // 4 activities are created as nested children for the following tasks
    // - open file
    // - write to file
    // - close file
    // The same fd is used for all those tasks.
    const xs = activities.values()
    t.equal(activities.size, 3, '3 fs activities')

    const open = xs.next().value
    spok(t, open,
       { $topic       : 'open'
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
       , destroyStack : spok.array }
    )
    const write = xs.next().value
    spok(t, write,
       { $topic       : 'write'
       , id           : spok.number
       , type         : 'FSREQWRAP'
       , triggerId    : open.id
       , init         : arrayElements(1)
       , initStack    : spok.array
       , before       : arrayElements(1)
       , beforeStacks : arrayElements(1)
       , after        : arrayElements(1)
       , afterStacks  : arrayElements(1)
       , destroy      : arrayElements(1)
       , destroyStack : spok.array }
    )
    const close = xs.next().value
    spok(t, close,
       { $topic       : 'close'
       , id           : spok.number
       , type         : 'FSREQWRAP'
       , triggerId    : write.id
       , init         : arrayElements(1)
       , initStack    : spok.array
       , before       : arrayElements(1)
       , beforeStacks : arrayElements(1)
       , after        : arrayElements(1)
       , afterStacks  : arrayElements(1)
       , destroy      : arrayElements(1)
       , destroyStack : spok.array }
    )

    // The fs.writeFile activities hold no resources, unlike the fs.readFile
    // activities for instance.

    t.end()
  }
})
