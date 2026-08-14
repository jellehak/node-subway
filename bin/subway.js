#!/usr/bin/env node
import http from 'http';
import https from 'https';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import { parseArgs } from './parseArgs.js';

let args;
try {
  args = parseArgs(
    process.argv.slice(2),
    {
      port: { alias: ['p'], type: 'number', default: 3000 },
      target: { alias: ['t'], type: 'string' },
      log: { alias: ['l'], type: 'boolean', default: false },
      middleware: { type: 'string', multiple: true },
    },
    {
      unknown: (arg) => {
        printUsage(`Unknown argument: ${arg}`);
        process.exit(1);
        return false;
      },
    }
  );
} catch (error) {
  printUsage(error.message);
  process.exit(1);
}

if (!args.target) {
  printUsage('Missing required --target argument.');
  process.exit(1);
}

const targetUrl = parseTarget(args.target);
const middleware = await loadMiddlewareModules(args.middleware);
const server = http.createServer(createRequestHandler(targetUrl, middleware, args.log));

server.listen(args.port, () => {
  console.log(`subway proxy listening on http://localhost:${args.port} -> ${targetUrl.href}`);
});


function printUsage(error) {
  if (error) {
    console.error(`Error: ${error}`);
    console.error('');
  }

  console.error('Usage: subway --target <url> [--port <port>] [--log] [--middleware <file>]...');
  console.error('Options:');
  console.error('  -t, --target      Target server URL for proxied requests');
  console.error('  -p, --port        Local port to listen on (default: 3000)');
  console.error('  -l, --log         Enable request/response logging');
  console.error('  --middleware      Middleware module path (can be repeated)');
}

function parseTarget(rawTarget) {
  try {
    const url = new URL(rawTarget);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Target URL must use http or https.');
    }
    return url;
  } catch (error) {
    console.error(`Invalid target URL: ${rawTarget}`);
    process.exit(1);
  }
}

async function loadMiddlewareModules(paths) {
  const handlers = [];

  for (const rawPath of paths) {
    if (!rawPath) {
      continue;
    }

    const resolvedPath = resolveModulePath(rawPath);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`Middleware file not found: ${resolvedPath}`);
      process.exit(1);
    }

    const imported = await import(pathToFileURL(resolvedPath).href);
    const exported = imported.default;

    if (!exported) {
      console.error(`Middleware file did not export a default value: ${resolvedPath}`);
      process.exit(1);
    }

    if (Array.isArray(exported)) {
      for (const middlewareFn of exported) {
        verifyMiddlewareFunction(middlewareFn, resolvedPath);
        handlers.push(middlewareFn);
      }
      continue;
    }

    verifyMiddlewareFunction(exported, resolvedPath);
    handlers.push(exported);
  }

  return handlers;
}

function verifyMiddlewareFunction(fn, sourcePath) {
  if (typeof fn !== 'function') {
    console.error(`Middleware exported value must be a function or an array of functions: ${sourcePath}`);
    process.exit(1);
  }
}

function resolveModulePath(rawPath) {
  if (rawPath.startsWith('./') || rawPath.startsWith('../') || rawPath.startsWith('/') || rawPath.match(/^\.[a-zA-Z0-9_-]/)) {
    return path.resolve(process.cwd(), rawPath);
  }
  return path.resolve(process.cwd(), rawPath);
}

function createRequestHandler(targetUrl, middleware, logEnabled) {
  return async (clientReq, clientRes) => {
    const requestContext = await buildRequestContext(clientReq);
    const responseContext = createResponseContext();

    if (logEnabled) {
      logIncomingRequest(requestContext);
    }

    runMiddleware(requestContext, responseContext, middleware, async (middlewareError) => {
      if (middlewareError) {
        clientRes.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        clientRes.end(`Middleware error: ${middlewareError.message}`);
        return;
      }

      try {
        await proxyToTarget(targetUrl, clientReq, clientRes, requestContext, responseContext, logEnabled);
      } catch (error) {
        if (!clientRes.headersSent) {
          clientRes.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        }
        clientRes.end(`Proxy error: ${error.message}`);
      }
    });
  };
}

function buildRequestContext(clientReq) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    clientReq.on('data', (chunk) => chunks.push(chunk));
    clientReq.on('end', () => {
      const rawBody = Buffer.concat(chunks);
      const contentType = clientReq.headers['content-type'] || '';
      let parsedBody = rawBody;

      if (rawBody.length > 0) {
        if (contentType.includes('application/json')) {
          try {
            parsedBody = JSON.parse(rawBody.toString('utf8'));
          } catch {
            parsedBody = rawBody.toString('utf8');
          }
        } else if (contentType.startsWith('text/') || contentType.includes('charset=')) {
          parsedBody = rawBody.toString('utf8');
        }
      }

      resolve({
        method: clientReq.method,
        url: clientReq.url,
        headers: { ...clientReq.headers },
        rawBody,
        body: parsedBody,
      });
    });

    clientReq.on('error', reject);
  });
}

function createResponseContext() {
  const headers = {};

  return {
    statusCode: 200,
    headers,
    body: null,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    removeHeader(name) {
      delete headers[name.toLowerCase()];
    },
    locals: {},
  };
}

function runMiddleware(req, res, middleware, done) {
  let index = 0;

  function next(error) {
    if (error) {
      done(error);
      return;
    }

    if (index >= middleware.length) {
      done();
      return;
    }

    const current = middleware[index];
    index += 1;

    try {
      current(req, res, next);
    } catch (error) {
      done(error);
    }
  }

  next();
}

function proxyToTarget(targetUrl, clientReq, clientRes, reqContext, resContext, logEnabled) {
  return new Promise((resolve, reject) => {
    const targetPath = new URL(reqContext.url, targetUrl).href;
    const urlObject = new URL(targetPath);
    const agent = urlObject.protocol === 'https:' ? https : http;

    const bodyBuffer = createBodyBuffer(reqContext.body);
    const headers = { ...reqContext.headers };
    headers.host = urlObject.host;

    if (bodyBuffer.length > 0) {
      headers['content-length'] = bodyBuffer.length;
    } else {
      delete headers['content-length'];
    }

    const requestOptions = {
      protocol: urlObject.protocol,
      hostname: urlObject.hostname,
      port: urlObject.port || (urlObject.protocol === 'https:' ? '443' : '80'),
      path: `${urlObject.pathname}${urlObject.search}`,
      method: reqContext.method,
      headers,
    };

    const outbound = agent.request(requestOptions, (targetRes) => {
      const responseHeaders = { ...targetRes.headers, ...resContext.headers };

      if (resContext.body != null) {
        const responseChunks = [];

        targetRes.on('data', (chunk) => responseChunks.push(chunk));
        targetRes.on('end', () => {
          const body = Buffer.concat(responseChunks);
          resContext.statusCode = targetRes.statusCode;
          resContext.headers = responseHeaders;
          resContext.body = body;

          if (logEnabled) {
            logOutgoingResponse(resContext);
          }

          sendClientResponse(clientRes, resContext);
          resolve();
        });

        targetRes.on('error', reject);
        return;
      }

      if (logEnabled) {
        logOutgoingResponse({
          statusCode: targetRes.statusCode,
          headers: responseHeaders,
          body: null,
        });
      }

      clientRes.writeHead(targetRes.statusCode, responseHeaders);
      targetRes.pipe(clientRes);

      targetRes.on('end', resolve);
      targetRes.on('error', reject);
      clientRes.on('error', reject);
      clientRes.on('close', () => {
        outbound.destroy();
        resolve();
      });
    });

    outbound.on('error', reject);

    if (bodyBuffer.length > 0) {
      outbound.write(bodyBuffer);
    }
    outbound.end();
  });
}

function createBodyBuffer(body) {
  if (body == null) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }

  try {
    return Buffer.from(JSON.stringify(body), 'utf8');
  } catch {
    return Buffer.alloc(0);
  }
}

function sendClientResponse(clientRes, responseContext) {
  const rawBody = createBodyBuffer(responseContext.body);
  const headers = { ...responseContext.headers };

  if (rawBody.length > 0) {
    headers['content-length'] = rawBody.length;
  }

  clientRes.writeHead(responseContext.statusCode, headers);
  clientRes.end(rawBody);
}

function logIncomingRequest(reqContext) {
  console.log(`\n[proxy] Request: ${reqContext.method} ${reqContext.url}`);
  console.log('[proxy] Request Headers:', JSON.stringify(reqContext.headers, null, 2));

  if (reqContext.body != null) {
    if (Buffer.isBuffer(reqContext.body)) {
      console.log(`[proxy] Request Body (${reqContext.rawBody.length} bytes)`);
    } else {
      console.log('[proxy] Request Body:', reqContext.body);
    }
  }
}

function logOutgoingResponse(resContext) {
  console.log(`\n[proxy] Response: ${resContext.statusCode}`);
  console.log('[proxy] Response Headers:', JSON.stringify(resContext.headers, null, 2));

  if (resContext.body != null) {
    if (Buffer.isBuffer(resContext.body)) {
      console.log(`[proxy] Response Body (${resContext.body.length} bytes)`);
    } else {
      console.log('[proxy] Response Body:', resContext.body);
    }
  }
}
