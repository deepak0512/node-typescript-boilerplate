import { describe, expect, it } from 'vitest';
import {
  DocSyncError,
  exitCodeFor,
  GitHubApiError,
  TargetFileError,
  UsageError,
} from '../../../src/doc-sync/errors.js';

describe('error classes', () => {
  it('UsageError is a named DocSyncError that preserves cause', () => {
    const cause = new Error('root');
    const error = new UsageError('bad flag', { cause });

    expect(error).toBeInstanceOf(DocSyncError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('UsageError');
    expect(error.message).toBe('bad flag');
    expect(error.cause).toBe(cause);
  });

  it('GitHubApiError carries reason, status, and cause', () => {
    const cause = new TypeError('fetch failed');
    const error = new GitHubApiError('server-error', 'GitHub is down', {
      status: 503,
      cause,
    });

    expect(error.name).toBe('GitHubApiError');
    expect(error.reason).toBe('server-error');
    expect(error.status).toBe(503);
    expect(error.cause).toBe(cause);
  });

  it('GitHubApiError status is undefined when not provided', () => {
    expect(new GitHubApiError('network', 'offline').status).toBeUndefined();
  });

  it('TargetFileError carries reason and cause', () => {
    const cause = new Error('EACCES');
    const error = new TargetFileError('write-failed', 'cannot write', {
      cause,
    });

    expect(error.name).toBe('TargetFileError');
    expect(error.reason).toBe('write-failed');
    expect(error.cause).toBe(cause);
  });
});

describe('exitCodeFor', () => {
  it.each([
    ['UsageError', new UsageError('x'), 2],
    ['GitHubApiError', new GitHubApiError('not-found', 'x'), 3],
    ['TargetFileError', new TargetFileError('not-found', 'x'), 3],
    ['a plain Error', new Error('bug'), 3],
    ['a non-Error value', 'boom', 3],
    ['undefined', undefined, 3],
  ])('maps %s to %i', (_label, error, code) => {
    expect(exitCodeFor(error)).toBe(code);
  });
});
