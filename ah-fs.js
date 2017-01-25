const ActivityCollector = require('ah-collector')
const facileClone = require('facile-clone')
const functionOrigin = require('function-origin')
const prune = require('ah-prune')
const stringifyBuffer = require('stringify-buffer')
const StackCapturer = require('ah-stack-capturer')

const types = new Set([ 'FSREQWRAP', 'FSREQUESTWRAP' ])
const defaultStackCapturer = StackCapturer.forAllEvents(types)

class FileSystemActivityCollector extends ActivityCollector {
  /**
   * Instantiates a FileSystemActivityCollector.
   *
   * Extends [ActivityCollector](https://github.com/thlorenz/ah-collector) and thus
   * exposes the same [public
   * API](https://github.com/thlorenz/ah-collector#api) with added
   * functionality.
   *
   * @param {Array.<number>} $0.start the start time of the process, i.e. the result of `process.hrtime()`
   * @param {StackCapturer} [$0.stackCapturer=StackCapturer] [see ah-stack-capturer](https://github.com/thlorenz/ah-stack-capturer) which
   * configures how and when stacks traces are captured and processed.
   *
   * By default a StackCapturer is used that captures stacks for all events for
   * file system related types: `FSREQWRAP`, `FSREQUESTWRAP`
   *
   * @param {number} [$0.bufferLength=0] determines how many elements of Buffers are
   * captured. By default not Buffer data is captured.
   *
   * @param {number} [$0.stringLength=0] determines how much of each string is
   * captured. By default no string data is captured.
   *
   * @param {boolean} [$0.captureArguments=false] if `true` arguments of callbacks
   * are captured when they are processed.
   *
   * @param {boolean} [$0.captureSource=false] if `true` the source code of callbacks
   * is captured when they are processed.
   *
   * @constructor
   * @name FileSystemActivityCollector
   */
  constructor({
      start
    , stackCapturer = defaultStackCapturer
    , bufferLength = 0
    , stringLength = 0
    , captureArguments = false
    , captureSource = false
  }) {
    super({ start, stackCapturer })

    this._bufferLength = bufferLength
    this._stringLength = stringLength
    this._captureArguments = captureArguments
    this._captureSource = captureSource

    this._processed = new Set()
  }

  /**
   * Getter that returns all activities related to file system operations.
   *
   * @name fileSystemActivityCollector.fileSystemActivities
   * @return {Map.<string, object>} fileSystemActivities
   */
  get fileSystemActivities() {
    return prune({
        activities: this.activities
      , keep: types
    })
  }

  /**
   * Cleans up all captured resources which means that they are processed,
   * meaningful data extracted and the reference to the actual resource removed
   * so it can be GCed.
   *
   * Resources are cleaned during `after` and `destroy` events, therefore
   * calling this function only affects those resources for which none of these
   * events have fired yet.
   *
   * @name fileSystemActivityCollector.cleanAllResources
   * @function
   * @return {FileSystemActivityCollector} fileSystemActivityCollector
   */
  cleanAllResources() {
    for (const uid of this.activities.keys()) this._cleanupResource(uid)
    return this
  }

  /**
   * Finds all buffers that are part of the resources, including arguments
   * passed to callbacks and stringifies their value for the supplied
   * encodings.
   *
   * @name fileSystemActivityCollector.stringifyBuffers
   * @function
   * @param {Array.<string>} [encodings='utf8', 'hex']  specified for which encodings to create
   * strings. In order to creates strings for all encodings, pass
   * [stringify-buffer.encodings](https://github.com/thlorenz/stringify-buffer#stringifybufferencodings)
   * @return {FileSystemActivityCollector} fileSystemActivityCollector
   */
  stringifyBuffers(encodings) {
    if (encodings == null) encodings = [ 'utf8', 'hex' ]
    for (const a of this.activities.values()) {
      const ctx = a.resource && a.resource.context
      if (ctx == null) return
      this._stringifyBuffersOf(ctx)
      const args = ctx.callback && ctx.callback.arguments
      if (args != null) this._stringifyBuffersOf(args)
    }
    return this
  }

  _stringifyBuffersOf(o, encodings) {
    function stringify(k) {
      const wrapper = o[k]
      if (wrapper == null || wrapper.type !== 'Buffer') return
      wrapper.val = stringifyBuffer(wrapper.val, encodings)
    }
    Object.keys(o).forEach(stringify)
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
  , bufferLength: 18
}).enable()
let tasks = 1 // files.length

function readFiles(files) {
  files.slice(1, 2).forEach(readFile)
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
      .stringifyBuffers()

    inspect(collector.fileSystemActivities)
  }
}
