#!/usr/bin/env node
import { createRequestHandler } from '../../bin/subway.js';

const app = await createRequestHandler({
  target: 'http://192.168.1.1:8080',
  port: 3001,
  log: true,
})

app.hook(async (onRequest, onResponse) => {
  onRequest((req, res) => {
    console.log('in', req);
  });
  onResponse((req, res) => {
    console.log('out',res);
  });
});

app.listen();