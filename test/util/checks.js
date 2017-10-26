const spok = require('spok')

exports.allEqual = function allEqual(t, prop, ...args) {
  const val = args[0][prop]
  args.slice(1).forEach((x, idx) => t.equal(x[prop], val, `${prop} [${idx}]`))
}

exports.checkBuffer = function checkBuffer(t, buf, src, len, topic) {
  t.ok(buf, `${topic}: buffer exists`)
  t.equal(buf.type, 'Buffer', `${topic}: correct type`)
  t.equal(buf.included, len, `${topic}: included right amount`)
  t.equal(buf.val.utf8, src, `${topic}: correct utf8 value`)
}

exports.checkFunction = function checkFunction(t, functions, { path, key, level, info }) {
  // find function with same path
  const fns = functions.filter(x => !x.path.some((el, idx) => el !== path[idx]))
  if (fns.length < 1) return t.fail(`Didn't find any function with path ${path}`)
  if (fns.length > 1) return t.fail(`Found more than one function with path ${path}`)

  const fn = fns[0]
  const $topic = path.join('.')
  spok(t, fn, { $topic, key, level })

  const { file, line, column, inferredName, name } = fn.info
  spok(t, fn.info, { $topic: $topic + '.info', file, line, column, inferredName, name })
}

exports.checkFsReqWrap = function checkFsReqWrap(t, resource, type, triggerId) {
  spok(t, resource,
    { $topic       : type
    , id           : spok.number
    , type         : 'FSREQWRAP'
    , triggerId    : triggerId
    , init         : spok.arrayElements(1)
    , initStack    : spok.array
    , before       : spok.arrayElements(1)
    , beforeStacks : spok.arrayElements(1)
    , after        : spok.arrayElements(1)
    , afterStacks  : spok.arrayElements(1)
    , destroy      : spok.arrayElements(1)
    , destroyStack : spok.array }
  )
}

exports.checkReadStreamTick = function checkReadStreamTick(t, streamTick, triggerId, filename, fd) {
  spok(t, streamTick,
    { $topic       : 'stream tick'
    , id           : spok.number
    , type         : 'TickObject'
    , triggerId    : triggerId
    , init         : spok.arrayElements(1)
    , before       : spok.arrayElements(1)
    , after        : spok.arrayElements(1)
    , destroy      : spok.arrayElements(1) }
  )
  const readStream = streamTick.resource.args[0]

  spok(t, readStream,
      { $topic: 'readStream'
      , readable: true
      , _eventsCount: spok.number
      , fd: fd
      , mode: 438
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
    , val: filename }
  )

  spok(t, readStream.flags,
    { $topic: 'readStream.flags'
    , type: 'string'
    , len: 1
    , included: 1
    , val: 'r' }
  )
}
