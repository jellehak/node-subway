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
      hooks: { alias: ['hook'], type: 'string', multiple: true },
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
const { requestHooks, responseHooks } = await loadHookModules(args.hooks);
const server = http.createServer(createRequestHandler(targetUrl, args.log, { requestHooks, responseHooks }));

server.listen(args.port, () => {
  console.log(`subway proxy listening on http://localhost:${args.port} -> ${targetUrl.href}`);
});


function printUsage(error) {
  if (error) {
    console.error(`Error: ${error}`);
    console.error('');
  }

  console.error('Usage: subway --target <url> [--port <port>] [--log] [--hooks <file>]...');
  console.error('Options:');
  console.error('  -t, --target      Target server URL for proxied requests');
  console.error('  -p, --port        Local port to listen on (default: 3000)');
  console.error('  -l, --log         Enable request/response logging');
  console.error('  --hooks           Hook module path (can be repeated)');
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

async function loadHookModules(paths) {
  const requestHooks = [];
  const responseHooks = [];

  for (const rawPath of paths) {
    if (!rawPath) {
      continue;
    }

    const resolvedPath = resolveModulePath(rawPath);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`Hook file not found: ${resolvedPath}`);
      process.exit(1);
    }

    const imported = await import(pathToFileURL(resolvedPath).href);
    const exported = imported.default;

    if (!exported || typeof exported !== 'function') {
      console.error(`Hook module must export a default function: ${resolvedPath}`);
      process.exit(1);
    }

    const onRequest = (hookFn) => {
      verifyHookFunction(hookFn, resolvedPath, 'onRequest');
      requestHooks.push(hookFn);
    };

    const onResponse = (hookFn) => {
      verifyHookFunction(hookFn, resolvedPath, 'onResponse');
      responseHooks.push(hookFn);
    };

    await exported(onRequest, onResponse);
  }

  return {
    requestHooks,
    responseHooks,
  };
}

function verifyHookFunction(fn, sourcePath, hookName) {
  if (typeof fn !== 'function') {
    console.error(`Hook callback passed to ${hookName} must be a function: ${sourcePath}`);
    process.exit(1);
  }
}

function resolveModulePath(rawPath) {
  if (rawPath.startsWith('./') || rawPath.startsWith('../') || rawPath.startsWith('/') || rawPath.match(/^\.[a-zA-Z0-9_-]/)) {
    return path.resolve(process.cwd(), rawPath);
  }
  return path.resolve(process.cwd(), rawPath);
}

function createRequestHandler(targetUrl, logEnabled, hooks) {
  return async (clientReq, clientRes) => {
    const requestContext = await buildRequestContext(clientReq);
    const responseContext = createResponseContext();
    const { requestHooks = [], responseHooks = [] } = hooks || {};

    if (logEnabled) {
      logIncomingRequest(requestContext);
    }

    try {
      await runRequestHooks(requestContext, responseContext, requestHooks);
    } catch (error) {
      clientRes.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      clientRes.end(`Request hook error: ${error.message}`);
      return;
    }

    try {
      await proxyToTarget(targetUrl, clientReq, clientRes, requestContext, responseContext, logEnabled, responseHooks);
    } catch (error) {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      }
      clientRes.end(`Proxy error: ${error.message}`);
    }
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
        clientIp: clientReq.socket?.remoteAddress || 'unknown',
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
    getHeaders() {
      return { ...headers };
    },
    locals: {},
  };
}

async function runRequestHooks(req, res, hooks) {
  for (const hook of hooks) {
    await hook(req, res);
  }
}

async function runResponseHooks(req, res, hooks) {
  for (const hook of hooks) {
    await hook(req, res);
  }
}

function proxyToTarget(targetUrl, clientReq, clientRes, reqContext, resContext, logEnabled, responseHooks) {
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
      const shouldBufferResponse = resContext.body != null || (responseHooks && responseHooks.length > 0);

      if (shouldBufferResponse) {
        const responseChunks = [];

        targetRes.on('data', (chunk) => responseChunks.push(chunk));
        targetRes.on('end', async () => {
          const body = Buffer.concat(responseChunks);
          resContext.statusCode = targetRes.statusCode;
          resContext.headers = responseHeaders;
          resContext.body = body;

          try {
            if (responseHooks && responseHooks.length > 0) {
              await runResponseHooks(reqContext, resContext, responseHooks);
            }
          } catch (hookError) {
            clientRes.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
            clientRes.end(`Response hook error: ${hookError.message}`);
            resolve();
            return;
          }

          if (logEnabled) {
            logOutgoingResponse(reqContext, resContext);
          }

          sendClientResponse(clientRes, resContext);
          resolve();
        });

        targetRes.on('error', reject);
        return;
      }

      if (logEnabled) {
        logOutgoingResponse(reqContext, {
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
  const length = reqContext.rawBody?.length ?? 0;
  const cyan = '\x1b[36m';
  const green = '\x1b[32m';
  const yellow = '\x1b[33m';
  const magenta = '\x1b[35m';
  const reset = '\x1b[0m';

  console.log(
    `${cyan}✨ [in]${reset} ${yellow}${reqContext.clientIp}${reset} ${green}${reqContext.method}${reset} ` +
    `${magenta}${reqContext.url}${reset} ${yellow}${length}b${reset}`
  );
}

function logOutgoingResponse(reqContext, resContext) {
  const size = resContext.body != null
    ? Buffer.isBuffer(resContext.body)
      ? `${resContext.body.length}b`
      : `${String(resContext.body).length}b`
    : 'stream';
  const green = '\x1b[32m';
  const yellow = '\x1b[33m';
  const red = '\x1b[31m';
  const blue = '\x1b[34m';
  const magenta = '\x1b[35m';
  const reset = '\x1b[0m';
  const statusColor = resContext.statusCode >= 500 ? red : resContext.statusCode >= 400 ? yellow : green;
  const statusEmoji = resContext.statusCode >= 500
    ? '💥'
    : resContext.statusCode >= 400
      ? '⚠️'
      : '✅';

  console.log(
    `${blue}🌈 [out]${reset} ${yellow}${reqContext.clientIp}${reset} ${statusColor}${statusEmoji} ${resContext.statusCode}${reset} ` +
    `${magenta}${size}${reset}`
  );
}
