const test = require('tape')
const spok = require('spok')
const FileSystemActivityCollector = require('../')
const tick = require('./util/tick')
const { checkFunction, checkFsReqWrap, checkReadStreamTick } = require('./util/checks')
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

test('\ncreateReadStream one file', function(t) {
  const ROOTID = ah.currentId
  const collector = new FileSystemActivityCollector({
      start            : process.hrtime()
    , captureArguments : true
    , captureSource    : false
    , bufferLength     : BUFFERLENGTH
  }).enable()

  fs.createReadStream(__filename)
    .on('data', ondata)
    .on('end', onend)

  function ondata(d) { }
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
    const streamTick1 = xs.next().value
    const read1 = xs.next().value
    const read2 = xs.next().value
    const streamTick2 = xs.next().value
    const { value, done } = xs.next()
    const close = value

    checkFsReqWrap(t, open, 'open', ROOTID)
    checkReadStreamTick(t, streamTick1, ROOTID, __filename, null)
    checkFsReqWrap(t, read1, 'read 1', open.id)
    checkFsReqWrap(t, read2, 'read 2', read1.id)
    checkReadStreamTick(t, streamTick2, read1.id, __filename, spok.gtz)
    checkFsReqWrap(t, close, 'close read', read2.id)

    t.ok(!done, 'not done when processing close')
    t.ok(xs.next().done, 'done after processing close')

    checkFunction(t, streamTick2.resource.functions, {
        path: [ 'args', '0', '_events', 'end', '0' ]
      , key: '0'
      , level: 4
      , info: {
          file: 'fs.js'
        , line: spok.gtz
        , column: spok.gtz
        , inferredName: ''
        , name: '' }
    })
    checkFunction(t, streamTick2.resource.functions, {
        path: [ 'args', '0', '_events', 'end', '1' ]
      , key: '1'
      , level: 4
      , info: {
            file: spok.endsWith('readstream-one-file.js')
          , line: spok.gt(90)
          , column: spok.gtz
          , inferredName: ''
          , name: 'onend'
        }
    })
    checkFunction(t, streamTick2.resource.functions, {
        path: [ 'args', '0', '_events', 'data' ]
      , key: 'data'
      , level: 3
      , info: {
            file: spok.endsWith('readstream-one-file.js')
          , line: spok.gt(90)
          , column: spok.gtz
          , inferredName: ''
          , name: 'ondata'
      }
    })

    t.end()
  }
})
