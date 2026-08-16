import https from 'https';
import http from 'http';
import { logIncomingRequest, logOutgoingResponse } from './stations/log.js';

export function createRequestHandler(config) {
  const { target, port, log } = config;
  const requestHooks = [];
  const responseHooks = [];

  const handler = async (clientReq, clientRes) => {
    const requestContext = await buildRequestContext(clientReq);
    const responseContext = createResponseContext();

    if (log) {
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
      await proxyToTarget(target, clientReq, clientRes, requestContext, responseContext, log, responseHooks);
    } catch (error) {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      }
      clientRes.end(`Proxy error: ${error.message}`);
    }
  };

  return {
    hook(hookModule) {
      const onRequest = (fn) => {
        requestHooks.push(fn);
      };
      const onResponse = (fn) => {
        responseHooks.push(fn);
      };
      hookModule(onRequest, onResponse);
      return this;
    },
    listen() {
      const server = http.createServer(handler);
      server.listen(port, () => {
        console.log(`subway proxy listening on http://localhost:${port} -> ${target}`);
      });
      return server;
    },
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
