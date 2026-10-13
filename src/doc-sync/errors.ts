import type { ExitCode } from './types.js';

/**
 * Base class for every expected doc-sync failure. Messages are built from fixed templates by the
 * thrower and must never contain the token, request headers, or response bodies (NFR-1.1).
 */
export abstract class DocSyncError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Invalid CLI arguments or environment (exit code 2). */
export class UsageError extends DocSyncError {}

export type GitHubApiErrorReason =
  | 'not-found'
  | 'unauthorized'
  | 'rate-limited'
  | 'forbidden'
  | 'server-error'
  | 'unexpected-status'
  | 'network'
  | 'timeout'
  | 'malformed-response';

export interface GitHubApiErrorOptions extends ErrorOptions {
  readonly status?: number;
}

/** A failed or unusable GitHub API call (exit code 3). */
export class GitHubApiError extends DocSyncError {
  readonly reason: GitHubApiErrorReason;
  readonly status: number | undefined;

  constructor(
    reason: GitHubApiErrorReason,
    message: string,
    options?: GitHubApiErrorOptions,
  ) {
    super(message, options);
    this.reason = reason;
    this.status = options?.status;
  }
}

export type TargetFileErrorReason =
  | 'not-found'
  | 'not-a-file'
  | 'outside-cwd'
  | 'read-failed'
  | 'missing-start-marker'
  | 'missing-end-marker'
  | 'markers-out-of-order'
  | 'duplicate-markers'
  | 'write-failed';

/** A problem with the target Markdown file or its markers (exit code 3). */
export class TargetFileError extends DocSyncError {
  readonly reason: TargetFileErrorReason;

  constructor(
    reason: TargetFileErrorReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.reason = reason;
  }
}

/** Maps any thrown value to an exit code (NFR-2.3); unknown values are runtime failures. */
export function exitCodeFor(error: unknown): ExitCode {
  return error instanceof UsageError ? 2 : 3;
}
