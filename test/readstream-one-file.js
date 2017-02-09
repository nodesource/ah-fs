const test = require('tape')
const spok = require('spok')
const FileSystemActivityCollector = require('../')
const arrayElements = require('./util/array-elements')
const tick = require('./util/tick')
const ah = require('async_hooks')

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

function checkRead(t, read, triggerId) {
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
}

function checkStreamTick(t, streamTick, triggerId, fd) {
  spok(t, streamTick,
    { $topic       : 'stream tick'
    , id           : spok.number
    , type         : 'TickObject'
    , triggerId    : triggerId
    , init         : arrayElements(1)
    , before       : arrayElements(1)
    , after        : arrayElements(1)
    , destroy      : arrayElements(1) }
  )
  const readStream = streamTick.resource.args[0]

  spok(t, readStream,
      { $topic: 'readStream'
      , readable: true
      , _eventsCount: spok.number
      , fd: fd
      , mode: 438
      , _asyncId: -1
      , proto: 'ReadStream' }
  )

  spok(t, readStream._readableState,
      { $topic: 'readStream._readableState'
      , type: 'object'
      , proto: 'ReadableState'
      , val: '<deleted>' }
  )

  spok(t, readStream.path,
    { $topic: 'readStream.path'
    , type: 'string'
    , len: spok.gtz
    , included: spok.gtz
    , val: spok.test(/readstream-one-file.js/) }
  )

  spok(t, readStream.flags,
    { $topic: 'readStream.flags'
    , type: 'string'
    , len: 1
    , included: 1
    , val: 'r' }
  )
}

test('\ncreateReadStream one file', function(t) {
  const ROOTID = ah.currentId
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

      // save('stream-fs-only', Array.from(collector.fileSystemActivities))
      runTest(collector.fileSystemActivities, ROOTID)
    })
  }

  /*
   * Getting a mix of FSREQWRAPs and TickObjects (with stream info)
   * We only collect the TickObjects to get at the `args` which tell
   * us what file we are reading and with what flags, etc.
   *
   * For now we assume exactly those activities, but that may turn out
   * to be too brittle.
   * If so we will change the tests to check general grouping and the
   * stream tick args.
   *
   *  { type: 'FSREQWRAP', id: 10, tid: 3 }   open, triggered by root
   *  { type: 'TickObject', id: 11, tid: 3 }  stream tick, triggered by root
   *  { type: 'FSREQWRAP', id: 12, tid: 10 }  read, triggerd by open
   *  { type: 'FSREQWRAP', id: 13, tid: 12 }  read, next chunk, triggered by previous read
   *  { type: 'TickObject', id: 14, tid: 12 } stream tick, triggerd by first read
   *  { type: 'FSREQWRAP', id: 16, tid: 13 }  close, triggered by last read
  */
  function runTest(activities, ROOTID) {
    const xs = activities.values()

    t.ok(activities.size >= 6, 'at least 6 fs activities')

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
      , destroyStack : spok.array
      , resource     : null }
    )

    const streamTick1 = xs.next().value
    checkStreamTick(t, streamTick1, ROOTID, null)

    const read1 = xs.next().value
    checkRead(t, read1, open.id)

    const read2 = xs.next().value
    checkRead(t, read2, read1.id)

    const streamTick2 = xs.next().value
    checkStreamTick(t, streamTick2, read1.id, spok.gtz)

    const { value, done } = xs.next()
    const close = value

    t.ok(!done, 'not done when processing close')
    spok(t, close,
       { $topic       : 'close'
       , id           : spok.number
       , type         : 'FSREQWRAP'
       , triggerId    : read2.id
       , init         : arrayElements(1)
       , initStack    : spok.array
       , before       : arrayElements(1)
       , beforeStacks : arrayElements(1)
       , after        : arrayElements(1)
       , afterStacks  : arrayElements(1)
       , destroy      : arrayElements(1)
       , destroyStack : spok.array }
    )

    t.ok(xs.next().done, 'done after processing close')

    t.end()
  }
})
