const test = require('tape')
const spok = require('spok')
const FileSystemActivityCollector = require('../')
const tick = require('./util/tick')
const { checkFunction, checkFsReqWrap, checkReadStreamTick } = require('./util/checks')
const nonCoreFunctions = require('./util/non-core-functions')
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

      // save('read-stream-piped-into-write-stream-fs-only', Array.from(collector.fileSystemActivities))
      // save('write-stream-all', Array.from(collector.activities))
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
   *  - it also has our `onfinish` which we assigned to the write stream and since
   *    it's one of the pipes of the read stream it shows up here
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
    const closeWrite = xs.next().value

    checkFsReqWrap(t, openWrite, 'open write', ROOTID)
    checkFsReqWrap(t, openRead, 'open read', ROOTID)
    checkReadStreamTick(t, streamTick1, ROOTID, __filename, null)
    checkFsReqWrap(t, read1, 'read 1', openRead.id)
    checkFsReqWrap(t, write, 'write', read1.id)
    checkFsReqWrap(t, read2, 'read 2', read1.id)
    checkReadStreamTick(t, streamTick2, read1.id, __filename, spok.gtz)
    checkFsReqWrap(t, closeRead, 'close read', read2.id)
    checkFsReqWrap(t, closeWrite, 'close write', read2.id)

    // the functions on both stream ticks are very similar
    // most are core functions that we aren't interested in, but we
    // find our `onfinish` callback on both ticks in two places
    // - args[0]_readableState.pipes._events.finish[1]
    // - args[1].pipes._events.finish[1]
    // it appears there exist two references to the same pipes objects

    const tick1Fns = nonCoreFunctions(streamTick1.resource.functions)
    t.equal(tick1Fns.length, 2, 'finds our non core function 2 times on first tick')

    const fn1 = tick1Fns[0]
    const fn2 = tick1Fns[1]
    t.equal(fn1.info.file, fn2.info.file, 'same file')
    t.equal(fn1.info.name, fn2.info.name, 'same name')

    checkFunction(t, tick1Fns,
       { path: [ 'args', '0', '_readableState', 'pipes', '_events', 'finish', '1' ]
       , key: '1'
       , level: 6
       , info: {
            file: spok.endsWith('writestream-one-file.js')
          , line: spok.gt(90)
          , column: spok.gtz
          , inferredName: ''
         , name: 'onfinish' }
       , id: streamTick1.id
       , arguments: null }
    )

    // proving that stream tick 2 has that function as well
    const tick2Fns = nonCoreFunctions(streamTick2.resource.functions)
    t.equal(tick2Fns.length, 2, 'finds our non core function 2 times on second tick')

    checkFunction(t, tick2Fns,
       { path: [ 'args', '0', '_readableState', 'pipes', '_events', 'finish', '1' ]
       , key: '1'
       , level: 6
       , info: {
            file: spok.endsWith('writestream-one-file.js')
          , line: spok.gt(90)
          , column: spok.gtz
          , inferredName: ''
         , name: 'onfinish' }
       , id: streamTick1.id
       , arguments: null }
    )

    // Both stream ticks should have the WriteStream as the last argument.
    // Note that the second one captured the file descriptor (fd).
    // It wasn't set when the first one initialized.
    const ws1 = streamTick1.resource.args.pop()
    const ws2 = streamTick2.resource.args.pop()
    spok(t, ws1,
       { $topic: 'WriteStream, last arg of streamTick1.resource'
       , _writableState: { type: 'object', proto: 'WritableState', val: '<deleted>' }
       , writable: true
       , domain: null
       , _events: { type: 'object', proto: null, val: '<deleted>' }
       , _eventsCount: spok.gtz
       , path: { type: 'string', len: 9, included: 9, val: '/dev/null' }
       , fd: null
       , flags: { type: 'string', len: 1, included: 1, val: 'w' }
       , mode: 438
       , autoClose: true
       , bytesWritten: spok.number
       , proto: 'WriteStream'
    })
    spok(t, ws2,
       { $topic: 'WriteStream, last arg of streamTick2.resource'
       , _writableState: { type: 'object', proto: 'WritableState', val: '<deleted>' }
       , writable: true
       , domain: null
       , _events: { type: 'object', proto: null, val: '<deleted>' }
       , _eventsCount: spok.gtz
       , path: { type: 'string', len: 9, included: 9, val: '/dev/null' }
       , fd: spok.gtz
       , flags: { type: 'string', len: 1, included: 1, val: 'w' }
       , mode: 438
       , autoClose: true
       , bytesWritten: spok.number
       , proto: 'WriteStream'
    })

    t.end()
  }
})
