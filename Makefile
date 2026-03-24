.PHONY: install test build

install:
	npm install

test:
	npm test

build:
	npm run build
	mkdir -p dist
	cp -r browser-demo dist/
	cp -r build dist/
