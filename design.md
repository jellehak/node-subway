a simple nodejs server cli to proxy request over the network.

# Features
- Proxy HTTP requests to a specified target server (eg. http://192.168.1.1:8080).
- Log incoming requests and responses for debugging purposes.
- Support for hooks to modify requests and responses before they are sent to the target server.

# Arguments
- `--target` or `-t`: The target server URL to which requests will be proxied. This argument is required.
- `--port` or `-p`: The port on which the proxy server will listen. Default is 3000.
- `--log` or `-l`: Enable logging of incoming requests and responses. Default is false.

# Usage
```sh
subway --target http://192.168.1.1:8080 --port 3000 --log
```

# Hooks
You can add hook modules to run code before the request is proxied and after the response is received.

```sh
subway --target http://192.168.1.1:8080 --port 3000 --log --hooks ./myHook.js
```

```js
// myHook.js
export default (onRequest, onResponse) => {
  onRequest((req, res) => {
    req.headers['X-Custom-Header'] = 'My Custom Header';
    console.log(`Request: ${req.method} ${req.url}`);
  });

  onResponse((req, res) => {
    console.log(`Response: ${res.statusCode}`);
  });
};
```
```