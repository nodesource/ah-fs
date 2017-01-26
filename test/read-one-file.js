const test = require('tape')
const spok = require('spok')
const FileSystemActivityCollector = require('../')

/* eslint-disable no-unused-vars */
const ocat = require('./util/ocat')
const mapToObject = require('./util/map-to-object')
const save = require('./util/save')
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 15, true))
}
/* eslint-enable no-unused-vars */

function arrayElements(n) {
  return function checkCount(array) {
    return spok.array(array) && array.length === n
  }
}

function contextOf(activity) {
  return activity.resource.context
}

function allEqual(t, prop, ...args) {
  const val = args[0][prop]
  args.slice(1).forEach((x, idx) => t.equal(x[prop], val, `${prop} [${idx}]`))
}

function checkBuffer(t, buf, src, topic) {
  t.ok(buf, `${topic}: buffer exists`)
  t.equal(buf.type, 'Buffer', `${topic}: correct type`)
  t.equal(buf.included, BUFFERLENGTH, `${topic}: included right amount`)
  t.equal(buf.val.utf8, src, `${topic}: correct utf8 value`)
}

const fs = require('fs')
const BUFFERLENGTH = 18

const collector = new FileSystemActivityCollector({
    start            : process.hrtime()
  , captureArguments : true
  , captureSource    : false
  , bufferLength     : BUFFERLENGTH
}).enable()

test('\nreading one file', function(t) {
  fs.readFile(__filename, onread)
  const ROOTID = 1

  function onread(err, src) {
    t.iferror(err, 'onread should not return an error')
    // capture/clean resources before having another round through
    // the event loop clean things up, i.e. we want to grab the args
    // whenever possible
    collector.cleanAllResources()

    // allow `close` 'after' to fire
    setImmediate(() => {
      // allow `close` 'destroy' to fire
      setImmediate(() => {
        collector
          .processStacks()
          .stringifyBuffers()

        runTest(collector.fileSystemActivities)
      })
    })
  }

  function runTest(activities) {
    // 4 activities are created as nested children for the following tasks
    // - open file
    // - stat file
    // - read from file
    // - close file
    // The same fd is used for all those tasks.
    const xs = activities.values()

    t.equal(activities.size, 4, '4 fs activities')

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
       , destroyStack : arrayElements(0) }
    )
    const stat = xs.next().value
    spok(t, stat,
       { $topic       : 'stat'
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
       , destroyStack : arrayElements(0) }
    )
    const read = xs.next().value
    spok(t, read,
       { $topic       : 'read'
       , id           : spok.number
       , type         : 'FSREQWRAP'
       , triggerId    : stat.id
       , init         : arrayElements(1)
       , initStack    : spok.array
       , before       : arrayElements(1)
       , beforeStacks : arrayElements(1)
       , after        : arrayElements(1)
       , afterStacks  : arrayElements(1)
       , destroy      : arrayElements(1)
       , destroyStack : arrayElements(0) }
    )
    const close = xs.next().value
    spok(t, close,
       { $topic       : 'close'
       , id           : spok.number
       , type         : 'FSREQWRAP'
       , triggerId    : read.id
       , init         : arrayElements(1)
       , initStack    : spok.array
       , before       : arrayElements(1)
       , beforeStacks : arrayElements(1)
       , after        : arrayElements(1)
       , afterStacks  : arrayElements(1)
       , destroy      : arrayElements(1)
       , destroyStack : arrayElements(0) }
    )

    const openCtx = contextOf(open)
    const statCtx = contextOf(stat)
    const readCtx = contextOf(read)
    const closeCtx = contextOf(close)

    t.ok(openCtx.fd > 0, 'valid file descriptor')
    allEqual(t, 'fd', openCtx, statCtx, readCtx, closeCtx)
    allEqual(t, 'file', openCtx.callback, statCtx.callback, readCtx.callback, closeCtx.callback)
    allEqual(t, 'name', openCtx.callback, statCtx.callback, readCtx.callback, closeCtx.callback)

    const src = fs.readFileSync(__filename).slice(0, BUFFERLENGTH).toString()
    checkBuffer(t, statCtx.buffer, src, 'stat buffer')
    checkBuffer(t, readCtx.buffer, src, 'read buffer')
    checkBuffer(t, closeCtx.buffer, src, 'close buffer')
    checkBuffer(t, closeCtx.callback.arguments['1'], src, 'close buffer ')

    t.end()
  }
})
