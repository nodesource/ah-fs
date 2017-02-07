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

