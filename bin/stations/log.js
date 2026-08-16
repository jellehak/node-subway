const COLOR = {
  RESET: '\x1b[0m',
  CYAN: '\x1b[36m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  MAGENTA: '\x1b[35m',
  RED: '\x1b[31m',
  BLUE: '\x1b[34m',
};

export function logIncomingRequest(reqContext) {
  const length = reqContext.rawBody?.length ?? 0;
  const timestamp = new Date().toISOString();

  console.log(
    `${COLOR.CYAN}${timestamp}${COLOR.RESET} ${COLOR.CYAN}✨ [in]${COLOR.RESET} ` +
    `${COLOR.YELLOW}${reqContext.clientIp}${COLOR.RESET} ${COLOR.GREEN}${reqContext.method}${COLOR.RESET} ` +
    `${COLOR.MAGENTA}${reqContext.url}${COLOR.RESET} ${COLOR.YELLOW}${length}b${COLOR.RESET}`
  );
}

export function logOutgoingResponse(reqContext, resContext) {
  const size = resContext.body != null
    ? Buffer.isBuffer(resContext.body)
      ? `${resContext.body.length}b`
      : `${String(resContext.body).length}b`
    : 'stream';
  const statusColor = resContext.statusCode >= 500 ? COLOR.RED : resContext.statusCode >= 400 ? COLOR.YELLOW : COLOR.GREEN;
  const statusEmoji = resContext.statusCode >= 500
    ? '💥'
    : resContext.statusCode >= 400
      ? '⚠️'
      : '✅';
  const timestamp = new Date().toISOString();

  console.log(
    `${COLOR.BLUE}${timestamp}${COLOR.RESET} ${COLOR.BLUE}🌈 [out]${COLOR.RESET} ` +
    `${COLOR.YELLOW}${reqContext.clientIp}${COLOR.RESET} ${statusColor}${statusEmoji} ${resContext.statusCode}${COLOR.RESET} ` +
    `${COLOR.MAGENTA}${size}${COLOR.RESET}`
  );
}

export default (onRequest, onResponse) => {
  onRequest((req, res) => {
    logIncomingRequest(req);
  });

  onResponse((req, res) => {
    logOutgoingResponse(req, res);
  });
};