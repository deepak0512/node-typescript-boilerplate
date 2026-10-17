// Shared helpers for Copilot hook scripts. Hook input arrives as JSON on stdin;
// `toolArgs` is usually a JSON-encoded string, but may already be an object.
import process from 'node:process';

export async function readHookInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function toolArgsOf(input) {
  const args = input?.toolArgs;
  if (typeof args !== 'string') return args;
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

export function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value !== null && typeof value === 'object')
    Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}
