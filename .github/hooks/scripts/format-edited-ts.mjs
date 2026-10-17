// postToolUse: run Prettier on TypeScript files the agent just edited, limited to
// the same scope as `npm run prettier` (src/ and __tests__/).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { collectStrings, readHookInput, toolArgsOf } from './read-hook-input.mjs';

const root = process.cwd();
const prettierBin = path.join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');

const input = await readHookInput();
const files = [...new Set(collectStrings(toolArgsOf(input)))]
  .filter((s) => /\.m?ts$/.test(s))
  .map((s) => path.resolve(root, s))
  .filter((abs) => {
    const rel = path.relative(root, abs);
    return /^(src|__tests__)[\\/]/.test(rel) && existsSync(abs);
  });

if (files.length > 0 && existsSync(prettierBin)) {
  try {
    execFileSync(process.execPath, [prettierBin, '--write', '--config', '.prettierrc', ...files], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (error) {
    process.stderr.write(`format-edited-ts: prettier failed: ${String(error)}\n`);
  }
}
