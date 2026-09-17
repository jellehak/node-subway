#!/usr/bin/env node
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import { parseArgs } from './parseArgs.js';
import { createRequestHandler } from './subway.js';

export async function run(argv) {
  let args;
  try {
    const configPath = getConfigPath(argv);
    const config = loadConfig(configPath);

    args = parseArgs(
      argv,
      {
        config: { alias: ['c'], type: 'string' },
        port: { alias: ['p'], type: 'number', default: config.port ?? 3000 },
        target: { alias: ['t'], type: 'string', default: config.target },
        log: { alias: ['l'], type: 'boolean', default: config.log ?? false },
        hooks: { alias: ['hook'], type: 'string', multiple: true, default: config.hooks },
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

  console.error('Usage: subway [--config <file>] [--target <url>] [--port <port>] [--log] [--hooks <file>]...');
  console.error('');
  console.error('Example:');
  console.error('  subway --target http://localhost:11434 -p 1234');
  console.error('Options:');
  console.error('  -c, --config      Path to a JSON config file');
  console.error('  -t, --target      Target server URL for proxied requests');
  console.error('  -p, --port        Local port to listen on (default: 3000)');
  console.error('  -l, --log         Enable request/response logging');
  console.error('  --hooks           Hook module path (can be repeated)');
}

function getConfigPath(argv) {
  const configArgs = parseArgs(argv, {
    config: { alias: ['c'], type: 'string' },
    port: { alias: ['p'], type: 'number' },
    target: { alias: ['t'], type: 'string' },
    log: { alias: ['l'], type: 'boolean' },
    hooks: { alias: ['hook'], type: 'string', multiple: true },
  });

  return configArgs.config;
}

function loadConfig(rawPath) {
  if (!rawPath) {
    return {};
  }

  const configPath = path.resolve(process.cwd(), rawPath);
  let config;

  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read config file ${configPath}: ${error.message}`);
  }

  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new Error('Config file must contain a JSON object.');
  }

  const supported = new Set(['target', 'port', 'log', 'hooks']);
  for (const key of Object.keys(config)) {
    if (!supported.has(key)) {
      throw new Error(`Unknown config option: ${key}`);
    }
  }

  if (config.target !== undefined && typeof config.target !== 'string') {
    throw new Error('Config option target must be a string.');
  }
  if (config.port !== undefined && (typeof config.port !== 'number' || !Number.isFinite(config.port))) {
    throw new Error('Config option port must be a number.');
  }
  if (config.log !== undefined && typeof config.log !== 'boolean') {
    throw new Error('Config option log must be a boolean.');
  }
  if (config.hooks !== undefined && (!Array.isArray(config.hooks) || config.hooks.some((hook) => typeof hook !== 'string'))) {
    throw new Error('Config option hooks must be an array of strings.');
  }

  if (config.hooks) {
    const configDirectory = path.dirname(configPath);
    config.hooks = config.hooks.map((hook) => path.resolve(configDirectory, hook));
  }

  return config;
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
