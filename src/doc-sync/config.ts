import { UsageError } from './errors.js';

export interface Config {
  readonly token: string | undefined;
}

export type Env = Readonly<Record<string, string | undefined>>;

// Header values must be printable ASCII: whitespace or control characters would corrupt the
// Authorization header, and non-ASCII makes `fetch` throw while building it (CR-4).
const INVALID_TOKEN_CHARS = /[^\x21-\x7E]/;

/**
 * Validates doc-sync's environment in one place (NFR-3.3). The env object is passed in so that
 * nothing is read at import time.
 */
export function readConfig(env: Env): Config {
  const token = env['GITHUB_TOKEN']?.trim();
  if (token === undefined || token === '') {
    return { token: undefined };
  }
  if (INVALID_TOKEN_CHARS.test(token)) {
    // Fixed message: never echo any part of the token (DR-10).
    throw new UsageError(
      'GITHUB_TOKEN contains whitespace, control, or non-ASCII characters',
    );
  }
  return { token };
}
