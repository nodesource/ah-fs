const test = require('tape')
const spok = require('spok')
const FileSystemActivityCollector = require('../')
const arrayElements = require('./util/array-elements')
const tick = require('./util/tick')
const readRx = /Object.fs.read/i

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
const ROOTID = 1

test('\ncreateReadStream one file', function(t) {
  const collector = new FileSystemActivityCollector({
      start            : process.hrtime()
    , captureArguments : true
    , captureSource    : false
    , bufferLength     : BUFFERLENGTH
  }).enable()

  function ondata(d) { }

  fs.createReadStream(__filename)
    .on('data', ondata)
    .on('end', onend)

  function onend() {
    collector.cleanAllResources()

    // need 3 ticks so `destroy` of `close` can fire
    tick(3, () => {
      collector
        .processStacks()
        .stringifyBuffers()
        .disable()

      save('stream-fs-only', Array.from(collector.fileSystemActivities))
      // TODO adapt tests to included tick objects
      return  t.end()
      runTest(collector.fileSystemActivities)
    })
  }

  function runTest(activities) {
    const xs = activities.values()

    t.ok(activities.size >= 3, 'at least 3 fs activities')

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

    let triggerId = open.id
    let activity = null
    let done = false
    const reads = []
    // walk through all reads and check the basics
    while (true) {
      const next = xs.next()
      activity = next.value
      done = next.done
      t.ok(!done, 'not done while processing reads')
      if (done || !readRx.test(activity.initStack[0])) break
      const read = activity
      reads.push(read)
      spok(t, read,
        { $topic       : 'read'
        , id           : spok.number
        , type         : 'FSREQWRAP'
        , triggerId    : triggerId
        , init         : arrayElements(1)
        , initStack    : spok.array
        , before       : arrayElements(1)
        , beforeStacks : arrayElements(1)
        , after        : arrayElements(1)
        , afterStacks  : arrayElements(1)
        , destroy      : arrayElements(1)
        , destroyStack : spok.array }
      )
      triggerId = read.id
    }
    t.ok(reads.length >= 2, 'at least 2 reads')

    // last activity wasn't a read so it was actually the close
    const close = activity
    t.ok(!done, 'not done when processing close')
    spok(t, close,
       { $topic       : 'close'
       , id           : spok.number
       , type         : 'FSREQWRAP'
       , triggerId    : triggerId
       , init         : arrayElements(1)
       , initStack    : spok.array
       , before       : arrayElements(1)
       , beforeStacks : arrayElements(1)
       , after        : arrayElements(1)
       , afterStacks  : arrayElements(1)
       , destroy      : arrayElements(1)
       , destroyStack : spok.array }
    )

    done = xs.next().done
    t.ok(done, 'done after processing close')

    // None of the resources have a context, therefore
    // there is nothing to check here, we don't see any buffers or callbacks either.
    // TODO: However we encounter some PipeWraps which we could examine for info.
    t.end()
  }
})
