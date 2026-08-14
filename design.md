a simple nodejs server cli to proxy request over the network.

# Features
- Proxy HTTP requests to a specified target server (eg. http://192.168.1.1:8080).
- Log incoming requests and responses for debugging purposes.
- Support for middleware to modify requests and responses before they are sent to the target server.

# Arguments
- `--target` or `-t`: The target server URL to which requests will be proxied. This argument is required.
- `--port` or `-p`: The port on which the proxy server will listen. Default is 3000.
- `--log` or `-l`: Enable logging of incoming requests and responses. Default is false.

# Usage
```sh
subway --target http://192.168.1.1:8080 --port 3000 --log
```

# Middleware
You can add middleware functions to modify requests and responses. Middleware functions receive the request and response objects, and can perform actions such as adding headers, modifying the request body, or logging information.
```sh
subway --target http://192.168.1.1:8080 --port 3000 --log --middleware ./myMiddleware.js
```

```js
// myMiddleware.js
export default function myMiddleware(req, res, next) {
  // Add a custom header to the request
  req.headers['X-Custom-Header'] = 'My Custom Header';
  
  // Log the request method and URL
  console.log(`Request: ${req.method} ${req.url}`);
  
  // Call the next middleware function
  next();
}
```

Stacking middleware functions is also supported. You can specify multiple middleware files, and they will be executed in the order they are provided.
```sh
subway --target http://192.168.1.1:8080 --port 3000 --log --middleware ./myMiddleware1.js --middleware ./myMiddleware2.js
```

Or you can use a single middleware file that exports an array of middleware functions.
```js
// myMiddleware.js
export default [
  function middleware1(req, res, next) {
    // Modify the request or response
    next();
  },
  function middleware2(req, res, next) {        
    // Modify the request or response
    next();
  }
];
```