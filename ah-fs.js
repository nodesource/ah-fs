const ActivityCollector = require('ah-collector')
const facileClone = require('facile-clone')
const prune = require('ah-prune')
const stringifyBuffer = require('stringify-buffer')
const StackCapturer = require('ah-stack-capturer')
const functionScout = require('function-scout')
/* eslint-disable no-unused-vars */
const util = require('util')
const print = obj => process._rawDebug(util.inspect(obj, true, 100, true))

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

/**
 * The WriteStream is attached to the pipes of a ReadableState
 * of the ReadStream that is piped into it.
 *
 * If one is found, it is returned so it can be added to the copied args.
 *
 * @name findWriteStream
 * @function
 * @private
 * @param {Object} arg the original arg found on the resource
 * @param {Object} copy the clone of the arg
 */
function findWriteStream(arg, copy) {
  if (copy.proto !== 'ReadableState') return null
  if (copy.pipes != null && copy.pipes.proto !== 'WriteStream') return null
  return arg.pipes
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
   *
   * @param {boolean} [collectFunctionInfo=false] if `true` it will collect info of all
   * functions found on the hooks resources. Set to `false` if you're calling this from
   * inside an async-hook callback since this otherwise crashes the process
   *
   * @return {FileSystemActivityCollector} fileSystemActivityCollector
   */
  cleanAllResources(collectFunctionInfo = false) {
    // TODO: setting this `true` segfaults in most cases
    for (const [ uid, h ] of this.activities) this._cleanupResource(h, uid, { collectFunctionInfo })
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
      const resource = a.resource
      if (resource == null) continue
      const ctx = resource.context
      if (ctx != null) {
        this._stringifyBuffersOf(ctx, encodings)
      }
      const functions = resource.functions
      if (functions == null) continue

      for (let i = 0; i < functions.length; i++) {
        this._stringifyBuffersOf(functions[i].arguments, encodings)
      }
    }
    return this
  }

  _stringifyBuffersOf(o, encodings) {
    if (o == null) return

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

  _scoutFunctions(ctx, uid, name) {
    const capture = this._captureArguments || this._captureSource
    const { functions }  = functionScout(ctx, { referenceFunction: capture })

    function adjustInfo(info) {
      // Point out to the user that these were attached to a specific property
      // of an activity with a specific id
      info.path.unshift(name)
      info.id = uid

      if (!capture) return

      // attach extra info if so required
      const fn = info.info && info.info.function
      if (fn == null) return

      try {
        info.arguments = this._clone(fn.arguments)
      } catch (e) {
        // We aren't allowed to access function arguments, if they
        // were created in 'use strict' mode. This affects all core functions.
        info.arguments = '<Inaccessible>'
      }
      if (this._captureSource) info.source = fn.toString()

      // Make sure we loose the function reference
      // Is delete expensive here? Not passing this into a function,
      // so the Object Map isn't that important.
      // Assigning to undefined is alternative, but clutters return value.
      delete info.info.function
    }

    functions.forEach(adjustInfo, this)
    return functions
  }

  _processArgs(uid, args, { collectFunctionInfo }) {
    const cloneOpts = { stringLength: Infinity }
    const copy = new Array(args.length)
    for (let i = 0; i < args.length; i++) {
      // capturing all strings so we get file paths and flags if found
      copy[i] = facileClone(args[i], cloneOpts)
    }
    // Look for writeStreams which are attached to the pipes of
    // readStream pipes and add them to the end of the copy array
    for (let i = 0; i < copy.length; i++) {
      const writeStream = findWriteStream(args[i], copy[i])
      if (writeStream != null) {
        copy.push(facileClone(writeStream, cloneOpts))
      }
    }

    if (!collectFunctionInfo) return { args: copy }

    const functions = this._scoutFunctions(args, uid, 'args')
    return { args: copy, functions }
  }

  _processResource(uid, resource, { collectFunctionInfo }) {
    if (resource == null) return null

    // TickObjects have no context, but they have an args array
    if (resource.context == null && resource.args != null) {
      const { args, functions } = this._processArgs(uid, resource.args, { collectFunctionInfo })
      return collectFunctionInfo ? { args, functions } : { args }
    }
    // no context or args
    if (resource.context == null) return null

    // For now we always capture funcion info when we are dealing with an fs context
    // that has a callback.
    // Only for args of a stream did we see crashes when getting the function origin
    // of contained functions.
    const ctx = this._clone(resource.context)
    const functions = this._scoutFunctions(resource.context, uid, 'context')
    return { context: ctx, functions }
  }

  _cleanupResource(h, uid, { collectFunctionInfo }) {
    if (h == null) return
    if (this._processed.has(uid)) return
    const activity = this.activities.get(uid)
    const processed = this._processResource(uid, activity.resource, { collectFunctionInfo })
    activity.resource = processed
    this._processed.add(uid)
  }

  // @override
  _init(uid, type, triggerId, resource) {
    const activity = super._init(uid, type, triggerId, resource)
    // Capture entire resource for now, we will process it and let go
    // of the reference inside _after.
    // We could capture here, but then we'd miss a bunch of information
    // especially callback arguments

    // print({ uid, type, resource })
    activity.resource = resource
    return activity
  }

  // @override
  _after(uid) {
    const h = super._after(uid)
    this._cleanupResource(h, uid, { collectFunctionInfo: true })
    return h
  }

  // @override
  _destroy(uid) {
    const h = super._destroy(uid)
    this._cleanupResource(h, uid, { collectFunctionInfo: true })
    return h
  }
}

module.exports = FileSystemActivityCollector

// Test
if (!module.parent && typeof window === 'undefined') {
const save = require('./test/util/save')
const path = require('path')
const fs = require('fs')
const tick = require('./test/util/tick')
const BUFFERLENGTH = 18

const collector = new FileSystemActivityCollector({
    start            : process.hrtime()
  , captureArguments : true
  , captureSource    : false
  , bufferLength     : BUFFERLENGTH
}).enable()

fs.writeFile(
    path.join(__dirname, 'test', 'tmp', 'write-one-file.tmp')
  , fs.readFileSync(__filename)
  , onwritten)

// eslint-disable-next-line no-inner-declarations
function onwritten(err) {
  if (err) return console.error(err)

  collector.cleanAllResources().disable()

  // allow `close` 'after' and `destroy` to fire
  tick(2, () => {
    collector
      .processStacks()
      .stringifyBuffers()

    // save('write-fs-only', Array.from(collector.fileSystemActivities))
    // save('write-fs-all', Array.from(collector.activities))
  })
}
}
