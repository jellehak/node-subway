#!/usr/bin/env node
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import { parseArgs } from './parseArgs.js';
import { createRequestHandler } from './subway.js';

export async function run(argv) {
  let args;
  try {
    args = parseArgs(
      argv,
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
  const hookModules = await loadHookModules(args.hooks);

  const app = createRequestHandler({
    target: targetUrl.href,
    port: args.port,
    log: args.log,
  });

  for (const hookModule of hookModules) {
    app.hook(hookModule);
  }

  app.listen();
}

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
  const hookModules = [];

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

    hookModules.push(exported);
  }

  return hookModules;
}

function resolveModulePath(rawPath) {
  if (rawPath.startsWith('./') || rawPath.startsWith('../') || rawPath.startsWith('/') || rawPath.match(/^\.[a-zA-Z0-9_-]/)) {
    return path.resolve(process.cwd(), rawPath);
  }
  return path.resolve(process.cwd(), rawPath);
}

// Start CLI
run(process.argv.slice(2));
