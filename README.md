# Subway

A minimal Node.js HTTP proxy CLI with hook support.

## Features

- Proxy HTTP requests to a target server
- Log incoming requests and responses
- Support request and response hooks to modify behavior before proxying

## Install

```sh
npm install -g .
```

## Usage

```sh
subway --target http://192.168.1.1:8080 --port 3000 --log
```

Or load options from a JSON config file:

```json
{
  "target": "http://192.168.1.1:8080",
  "host": "0.0.0.0",
  "port": 3000,
  "log": true,
  "hooks": ["./myHook.js"]
}
```

```sh
subway --config ./subway.json
```

Command-line options override config values. Hook paths in a config file are resolved relative to that file.

## Options

- `--config`, `-c`  Path to a JSON config file
- `--target`, `-t`  Target server URL to proxy requests to (required)
- `--host`          Host to listen on (default: `0.0.0.0`)
- `--port`, `-p`    Port for the proxy server (default: `3000`)
- `--log`, `-l`     Enable request/response logging
- `--hooks`         Path to hook module (can be repeated)

## Hooks

Hook modules export a default function that receives `onRequest` and `onResponse` registration callbacks.

```js
export default (onRequest, onResponse) => {
  onRequest(async (req, res) => {
    logIncomingRequest(req);
  });

  onResponse(async (req, res) => {
    logOutgoingResponse(req, res);
  });
};
```

## Example

```sh
subway --target http://192.168.1.1:8080 --port 3000 --log --hooks ./myHook.js
```
