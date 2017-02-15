const test = require('tape')
const spok = require('spok')
const FileSystemActivityCollector = require('../')
const tick = require('./util/tick')
const { checkFunction, checkFsReqWrap, checkReadStreamTick } = require('./util/checks')
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

    t.ok(activities.size >= 9, 'at least 9 fs activities')

    const openWrite = xs.next().value
    const openRead = xs.next().value
    const streamTick1 = xs.next().value
    const read1 = xs.next().value
    const write = xs.next().value
    const read2 = xs.next().value
    const streamTick2 = xs.next().value
    const closeRead = xs.next().value

    checkFsReqWrap(t, openWrite, 'open write', ROOTID)
    checkFsReqWrap(t, openRead, 'open read', ROOTID)
    checkReadStreamTick(t, streamTick1, ROOTID, __filename, null)
    checkFsReqWrap(t, read1, 'read 1', openRead.id)
    checkFsReqWrap(t, write, 'write', read1.id)
    checkFsReqWrap(t, read2, 'read 2', read1.id)
    checkReadStreamTick(t, streamTick2, read1.id, __filename, spok.gtz)
    checkFsReqWrap(t, closeRead, 'close read', read2.id)

    t.end()
  }
})
