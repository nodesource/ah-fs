# TODO: generate this via a configure
NODEDIR=~/dev/ns/nsolid/node

install:
	npm install --ignore-scripts
	(cd node_modules/function-origin && node-gyp rebuild --nodedir $(NODEDIR))
