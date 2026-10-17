// Process entry point for `npm run doc-sync`. This is the only doc-sync module with intentional
// top-level side effects: it reads argv/env/cwd, wires real I/O, and sets the exit code.
import * as fs from 'node:fs/promises';
import process from 'node:process';
import { runCli } from './cli.js';

runCli(
  process.argv.slice(2),
  process.env,
  {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  {
    fetch: (input, init) => fetch(input, init),
    fs,
    now: () => new Date(),
    cwd: process.cwd(),
  },
).then(
  (code) => {
    process.exitCode = code;
  },
  // runCli never rejects; this only guards against a bug becoming an unhandled rejection
  // (DR-12). The error itself is not printed because it could contain anything.
  () => {
    process.exitCode = 3;
  },
);
