const ActivityCollector = require('ah-collector')
const facileClone = require('facile-clone')
const functionOrigin = require('function-origin')
const prune = require('ah-prune')
const stringifyBuffer = require('stringify-buffer')
const StackCapturer = require('ah-stack-capturer')
/* eslint-disable no-unused-vars */
const print = process._rawDebug

const types = new Set([ 'FSREQWRAP', 'FSREQUESTWRAP' ])

function isfsType(type) {
  return types.has(type)
}

function isreadStreamTickObject(type, activity) {
  if (type !== 'TickObject') return false
  if (activity.resource == null || activity.resource.args == null) return false
  const args = activity.resource.args
  if (!Array.isArray(args) || args.length === 0) return false
  return args[0].readable
}

const defaultStackCapturer = new StackCapturer({
  shouldCapture(event, type, activity) {
    // could include stream tick objects here, but those stacks
    // are useless as they just contain two traces of process/next_tick.js
    return isfsType(type)
  }
})

class FileSystemActivityCollector extends ActivityCollector {
  /**
   * Instantiates a FileSystemActivityCollector.
   *
   * Extends [ActivityCollector](https://github.com/nodesource/ah-collector) and thus
   * exposes the same [public
   * API](https://github.com/nodesource/ah-collector#api) with added
   * functionality.
   *
   * @param {Array.<number>} $0.start the start time of the process, i.e. the result of `process.hrtime()`
   * @param {StackCapturer} [$0.stackCapturer=StackCapturer] [see ah-stack-capturer](https://github.com/nodesource/ah-stack-capturer) which
   * configures how and when stacks traces are captured and processed.
   *
   * By default a StackCapturer is used that captures stacks for all events for
   * file system related types: `FSREQWRAP`, `FSREQUESTWRAP` and some others like
   * `TickObject`s that also are related, i.e. if they contain information related
   * to streams.
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
    super({ start, stackCapturer, requireInit: true })

    this._bufferLength = bufferLength
    this._stringLength = stringLength
    this._captureArguments = captureArguments
    this._captureSource = captureSource

    this._processed = new Set()
  }

  /**
   * Getter that eturns all activities related to file system operations including
   * things like TickObjects that have a ReadStream attached.
   *
   * @name fileSystemActivityCollector.fileSystemActivities
   * @return {Map.<string, object>} fileSystemActivities
   */
  get fileSystemActivities() {
    return prune({
        activities: this.activities
      , keepFn(type, activity) {
          return isfsType(type) || isreadStreamTickObject(type, activity)
        }
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
    for (const [ uid, h ] of this.activities) this._cleanupResource(h, uid)
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
   * [stringify-buffer.encodings](https://github.com/nodesource/stringify-buffer#stringifybufferencodings)
   * @return {FileSystemActivityCollector} fileSystemActivityCollector
   */
  stringifyBuffers(encodings) {
    if (encodings == null) encodings = [ 'utf8', 'hex' ]
    for (const a of this.activities.values()) {
      const ctx = a.resource && a.resource.context
      if (ctx == null) continue
      this._stringifyBuffersOf(ctx, encodings)
      const args = ctx.callback && ctx.callback.arguments
      if (args != null) this._stringifyBuffersOf(args, encodings)
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

  _processArgs(args) {
    const copy = new Array(args.length)
    for (let i = 0; i < args.length; i++) {
      // capturing all strings so we get file paths and flags if found
      copy[i] = facileClone(args[i], { stringLength: Infinity })
    }
    return copy
  }

  _processResource(resource) {
    if (resource == null) return null

    // TickObjects have no context, but they have an args array
    if (resource.context == null && resource.args != null) {
      return { args: this._processArgs(resource.args) }
    }
    // no context or args
    if (resource.context == null) return null

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

  _cleanupResource(h, uid) {
    if (h == null) return
    if (this._processed.has(uid)) return
    const activity = this.activities.get(uid)
    activity.resource = this._processResource(activity.resource)
    this._processed.add(uid)
  }

  // @override
  _init(uid, type, triggerId, resource) {
    const activity = super._init(uid, type, triggerId, resource)
    // Capture entire resource for now, we will process it and let go
    // of the reference inside _after.
    // We could capture here, but then we'd miss a bunch of information
    // especially callback arguments

    activity.resource = resource
    return activity
  }

  // @override
  _after(uid) {
    const h = super._after(uid)
    this._cleanupResource(h, uid)
    return h
  }

  // @override
  _destroy(uid) {
    const h = super._destroy(uid)
    this._cleanupResource(h, uid)
    return h
  }
}

module.exports = FileSystemActivityCollector
