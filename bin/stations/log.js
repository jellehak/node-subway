function logIncomingRequest(req) {
  console.log(`\n[proxy] Request: ${req.method} ${req.originalUrl}`);
  console.log('[proxy] Request Headers:', JSON.stringify(req.headers, null, 2));

  if (req.body != null) {
    if (Buffer.isBuffer(req.body)) {
      console.log(`[proxy] Request Body (${req.rawBody.length} bytes)`);
    } else {
      console.log('[proxy] Request Body:', req.body);
    }
  }
}

function logOutgoingResponse(req, res) {
  console.log(`\n[proxy] Response: ${res.statusCode}`);
  console.log('[proxy] Response Headers:', JSON.stringify(res.getHeaders(), null, 2));

  if (res.body != null) {
    if (Buffer.isBuffer(res.body)) {``
      console.log(`[proxy] Response Body (${res.body.length} bytes)`);
    } else {
      console.log('[proxy] Response Body:', res.body);
    }
  }
}

// export default (req, res, next) => {
//   const reqContext = {
//     method: req.method,
//     url: req.originalUrl,
//     headers: req.headers,
//     body: req.body,
//     rawBody: req.rawBody,
//   };

//   logIncomingRequest(reqContext);

//   const originalSend = res.send.bind(res);
//   res.send = (body) => {
//     const resContext = {
//       statusCode: res.statusCode,
//       headers: res.getHeaders(),
//       body,
//     };

//     logOutgoingResponse(resContext);

//     return originalSend(body);
//   };

//   next();
// }

export default (onRequest, onResponse) => {
  onRequest((req, res) => {
    logIncomingRequest(req);
  });

  onResponse((req, res) => {
    logOutgoingResponse(req, res);
  });
};