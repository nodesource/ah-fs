const ActivityCollector = require('ah-collector')
const functionOrigin = require('function-origin')
const prune = require('ah-prune')

const includedResources = new Set([ 'FSREQWRAP', 'FSREQUESTWRAP' ])
const defaultCaptureStackFor = new Set([ 'init', 'before', 'after', 'destroy' ])

class StackCapturer {
  constructor({
      events
    , includedResources
  }) {
    this._events = events
    this._includedResources = includedResources
  }

  captureStack(event, activity, resource) {
    if (!this._events.has(event)) return false
    if (!this._includedResources.has(activity.type)) return false
    return true
  }
}

class FileSystemActivityCollector extends ActivityCollector {
  constructor({
      start
    , captureArguments = false
    , captureBuffers = false
    , captureSource = false
    , captureStackFor = defaultCaptureStackFor
  }) {
    let captureStack = null
    if (captureStackFor != null) {
      const stackCapturer = new StackCapturer({ events: captureStackFor, includedResources })
      captureStack = stackCapturer.captureStack.bind(stackCapturer)
    }
    super({ start, captureStack })

    this._captureArguments = captureArguments
    this._captureBuffers = captureBuffers
    this._captureSource = captureSource
  }

  processFileSystemCallbacks() {
    // need to operate on all activities, as prune creates a copy
    for (const v of this.activities.values()) {
      if (!includedResources.has(v.type)) return
      if (v.context != null) {
        Object.keys(v.context).forEach(k => {
          const val = v.context[k]
          if (typeof val !== 'function') return
          const fn = v.context[k] = Object.assign(
              {}
            , functionOrigin(val)
            , { name: val.name }
          )
          if (this._captureSource) fn.source = val.toString()
          if (this._captureArguments) fn.arguments = val.arguments
          if (!this._captureBufferArguments) {
            fn.arguments = Object.keys(fn.arguments)
              .reduce((acc, k) => {
                const val = fn.arguments[k]
                acc[k] = Buffer.isBuffer(val) ? '<Buffer>' : val
                return acc
              }, {})
          }
        })
      }
    }
    return this
  }

  get fileSystemActivities() {
    return prune({
        activities: this.activities
      , keep: includedResources
    })
  }

  // @override
  _init(uid, type, triggerId, resource) {
    super._init(uid, type, triggerId, resource)
    const activity = this.activities.get(uid)
    const ctx =  activity.context = resource.context

    // hold on to parts context only and leave resource to be GCed
    // leave out Buffer since that's huge ;)
    if (this._captureBuffers || ctx == null) return

    const buffer = ctx.buffer == null ? null : '<Buffer>'
    const buffers = ctx.buffers == null ? null : ctx.buffers.map(x => '<Buffer>')
    this.activities.get(uid).context = Object.assign({}, ctx, { buffers, buffer })
  }
}

// eslint-disable-next-line no-unused-vars
const print = process._rawDebug
// eslint-disable-next-line no-unused-vars
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 15, true))
}

const fs = require('fs')
const path = require('path')
const p = __dirname

const files = fs.readdirSync(p)
  .filter(x => fs.statSync(x).isFile())
  .map(x => path.join(p, x))

const collector = new FileSystemActivityCollector({
  start: process.hrtime()
  , captureArguments: true
  , captureSource: true
}).enable()
let tasks = 1 // files.length

function readFiles(files) {
  files.slice(0, 1).forEach(readFile)
}

function readFile(x) {
  fs.readFile(x, onread)
}

readFiles(files)

function onread(err, src) {
  if (err) return console.error(err)
  if (--tasks <= 0) {
    collector
      .processStacks()
      .processFileSystemCallbacks()
    inspect(collector.fileSystemActivities)
  }
}
