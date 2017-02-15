const test = require('tape')
const spok = require('spok')
const FileSystemActivityCollector = require('../')
const arrayElements = require('./util/array-elements')
const tick = require('./util/tick')
const { checkFunction } = require('./util/checks')
const ah = require('async_hooks')

/* eslint-disable no-unused-vars */
const ocat = require('./util/ocat')
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

test('\ncreateWriteStream one file', function(t) {
  const ROOTID = ah.currentId
  const collector = new FileSystemActivityCollector({
      start            : process.hrtime()
    , captureArguments : true
    , captureSource    : false
    , bufferLength     : BUFFERLENGTH
  }).enable()

  const writeStream = fs.createWriteStream('/dev/null').on('finish', onfinish)
  fs.createReadStream(__filename).pipe(writeStream)

  function onfinish() {
    collector.cleanAllResources()

    // need 3 ticks so `destroy` of `close` can fire
    tick(3, () => {
      collector
        .processStacks()
        .stringifyBuffers()
        .disable()

      save('write-stream-fs-only', Array.from(collector.fileSystemActivities))
      save('write-stream-all', Array.from(collector.activities))
      runTest(collector.fileSystemActivities, ROOTID)
    })
  }

  /*
   * Piping read stream into write stream results in two open and two close FSREQWRAPS.
   * We get one read resulting in a write on the write stream.
   *
   * The last read seems to come back empty as we don't see another write.
   *
   *  { type: 'FSREQWRAP', id: 10, tid: 3 }   open, write stream triggered by root
   *  { type: 'FSREQWRAP', id: 11, tid: 3 }   open, read stream triggered by root
   *  { type: 'TickObject', id: 12, tid: 3 }  read stream tick, triggered by root
   *  { type: 'FSREQWRAP', id: 13, tid: 11 }  read, triggerd by open of read steam
   *  { type: 'FSREQWRAP', id: 14, tid: 13 }  write, triggerd by read of read steam
   *  { type: 'FSREQWRAP', id: 15, tid: 13 }  read, next chunk, triggered by first read
   *  { type: 'TickObject', id: 16, tid: 13 } stream tick, triggerd by first read
   *  { type: 'FSREQWRAP', id: 18, tid: 15 }  close read stream, triggered by last read
   *  { type: 'FSREQWRAP', id: 19, tid: 15 }  close write stream, triggered by last read
   *
   *  - on the read stream ticks  we can collect all readable stream related functions
   *  - they are all inside core, mostly created due to piping into write stream
   *  - however for whatever reason it also has our `onfinish` which we actually
   *    assigned to the write stream, it's one of the pipe events
   *
   *  Note: that the missing async_resource with id: 17 is an Immediate that contains
   *        no useful information
  */
  function runTest(activities, ROOTID) {
    const xs = activities.values()

    t.end()
  }
})
