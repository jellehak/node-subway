# Subway

A minimal Node.js HTTP proxy CLI with middleware support.

## Features

- Proxy HTTP requests to a target server
- Log incoming requests and responses
- Support middleware to modify requests and responses before proxying

## Install

```sh
npm install -g .
```

## Usage

```sh
subway --target http://192.168.1.1:8080 --port 3000 --log
```

## Options

- `--target`, `-t`  Target server URL to proxy requests to (required)
- `--port`, `-p`    Port for the proxy server (default: `3000`)
- `--log`, `-l`     Enable request/response logging
- `--middleware`   Path to middleware module (repeatable)

## Middleware

Middleware modules can export a single function or an array of functions.

```js
export default function middleware(req, res, next) {
  req.headers['X-Custom-Header'] = 'My Custom Header';
  next();
}
```

```js
export default [
  function middleware1(req, res, next) {
    next();
  },
  function middleware2(req, res, next) {
    next();
  }
];
```

## Example

```sh
subway --target http://192.168.1.1:8080 --port 3000 --log --middleware ./myMiddleware.js
```
