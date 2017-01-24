const ActivityCollector = require('ah-collector')
const facileClone = require('facile-clone')
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
    , captureStackFor = defaultCaptureStackFor
    , bufferLength = 0
    , stringLength = 0
    , captureArguments = false
    , captureSource = false
  }) {
    let captureStack = null
    if (captureStackFor != null) {
      const stackCapturer = new StackCapturer({ events: captureStackFor, includedResources })
      captureStack = stackCapturer.captureStack.bind(stackCapturer)
    }
    super({ start, captureStack })

    this._bufferLength = bufferLength
    this._stringLength = stringLength
    this._captureArguments = captureArguments
    this._captureSource = captureSource

    this._processed = new Set()
  }

  get fileSystemActivities() {
    return prune({
        activities: this.activities
      , keep: includedResources
    })
  }

  cleanAllResources() {
    for (const uid of this.activities.keys()) this._cleanupResource(uid)
    return this
  }

  _clone(x) {
    if (x == null) return x
    return facileClone(
        x
      , { bufferLength: this._bufferLength, stringLength: this._stringLength }
    )
  }

  _processFunction(func) {
    const fn = Object.assign(
        {}
      , functionOrigin(func)
      , { name: func.name }
    )
    if (this._captureSource) fn.source = func.toString()
    if (this._captureArguments) fn.arguments = this._clone(func.arguments)
    return fn
  }

  _processResource(resource) {
    if (resource == null || resource.context == null) return null

    const ctx = this._clone(resource.context)

    // functions were removed by _clone, so we need to pull them
    // from the original context
    Object.keys(resource.context).forEach(k => {
      const val = resource.context[k]
      if (typeof val !== 'function') return
      ctx[k] = this._processFunction(val)
    })

    return { context: ctx }
  }

  _cleanupResource(uid) {
    if (this._processed.has(uid)) return
    const activity = this.activities.get(uid)
    activity.resource = this._processResource(activity.resource)
    this._processed.add(uid)
  }

  // @override
  _init(uid, type, triggerId, resource) {
    super._init(uid, type, triggerId, resource)
    const activity = this.activities.get(uid)
    // Capture entire resource for now, we will process it and let go
    // of the reference inside _after.
    // We could capture here, but then we'd miss a bunch of information
    // especially callback arguments
    activity.resource = resource
  }

  // @override
  _after(uid) {
    super._after(uid)
    this._cleanupResource(uid)
  }

  // @override
  _destroy(uid) {
    super._destroy(uid)
    this._cleanupResource(uid)
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
  , captureSource: false
  , bufferLength: 8
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
      .cleanAllResources()
    inspect(collector.fileSystemActivities)
  }
}
