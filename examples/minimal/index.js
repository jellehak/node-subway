#!/usr/bin/env node
import { createRequestHandler } from '../../bin/subway.js';

const server = await createRequestHandler({
  target: 'http://192.168.1.1:8080',
  port: 3001,
  log: true,
});
