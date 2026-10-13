import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubApiError } from '../../../src/doc-sync/errors.js';
import {
  fetchRepository,
  GITHUB_API_VERSION,
} from '../../../src/doc-sync/github-client.js';
import { FULL_REPO_RESPONSE } from '../../fixtures/doc-sync.js';
import {
  failingFetch,
  fakeFetch,
  jsonResponse,
  textResponse,
} from '../../fixtures/fake-fetch.js';

const repo = { owner: 'jsynowiec', name: 'node-typescript-boilerplate' };
const TOKEN = 'ghp_SuperSecretToken123';

afterEach(() => {
  vi.restoreAllMocks();
});

function initOf(fetch: ReturnType<typeof fakeFetch>): RequestInit {
  const init = fetch.mock.calls[0]?.[1];
  if (init === undefined) {
    throw new Error('fetch was not called');
  }
  return init;
}

describe('fetchRepository request', () => {
  it('calls the repos endpoint and parses the response', async () => {
    const fetch = fakeFetch(() => jsonResponse(FULL_REPO_RESPONSE));

    const meta = await fetchRepository(repo, { fetch, token: undefined });

    expect(meta.fullName).toBe('jsynowiec/node-typescript-boilerplate');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/jsynowiec/node-typescript-boilerplate',
    );
  });

  it('percent-encodes path segments', async () => {
    const fetch = fakeFetch(() => jsonResponse(FULL_REPO_RESPONSE));

    await fetchRepository(
      { owner: 'a b', name: 'c/d' },
      { fetch, token: undefined },
    );

    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/a%20b/c%2Fd',
    );
  });

  it('sends the GitHub headers and no Authorization without a token', async () => {
    const fetch = fakeFetch(() => jsonResponse(FULL_REPO_RESPONSE));

    await fetchRepository(repo, { fetch, token: undefined });

    const init = initOf(fetch);
    expect(init).toMatchObject({ method: 'GET', redirect: 'follow' });
    expect(init.headers).toEqual({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'doc-sync',
    });
  });

  it('sends a Bearer token when one is configured', async () => {
    const fetch = fakeFetch(() => jsonResponse(FULL_REPO_RESPONSE));

    await fetchRepository(repo, { fetch, token: TOKEN });

    expect(initOf(fetch).headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    });
  });

  it('applies a 10 s timeout by default (NFR-2.2)', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetch = fakeFetch(() => jsonResponse(FULL_REPO_RESPONSE));

    await fetchRepository(repo, { fetch, token: undefined });

    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(initOf(fetch).signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts a redirect that stays on api.github.com (renamed repo)', async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(FULL_REPO_RESPONSE, {
        url: 'https://api.github.com/repositories/82412345',
      }),
    );

    await expect(
      fetchRepository(repo, { fetch, token: TOKEN }),
    ).resolves.toMatchObject({ name: 'node-typescript-boilerplate' });
  });
});

describe('fetchRepository failures (FR-11)', () => {
  it.each([
    [401, {}, 'unauthorized', /rejected the token \(401\)/],
    [404, {}, 'not-found', /jsynowiec\/node-typescript-boilerplate not found/],
    [429, {}, 'rate-limited', /rate limit exceeded \(429\)/],
    [
      403,
      { 'x-ratelimit-remaining': '0' },
      'rate-limited',
      /rate limit exceeded \(403\)/,
    ],
    [403, { 'retry-after': '60' }, 'rate-limited', /retry after 60s/],
    [403, {}, 'forbidden', /forbidden \(403\)/],
    [403, { 'x-ratelimit-remaining': '12' }, 'forbidden', /forbidden/],
    [500, {}, 'server-error', /unavailable \(500\)/],
    [503, {}, 'server-error', /unavailable \(503\)/],
    [410, {}, 'unexpected-status', /unexpected status 410/],
    [422, {}, 'unexpected-status', /unexpected status 422/],
    [451, {}, 'unexpected-status', /unexpected status 451/],
    [302, {}, 'unexpected-status', /unexpected status 302/],
  ] as const)('maps %i %j to %s', async (status, headers, reason, message) => {
    const fetch = fakeFetch(() =>
      jsonResponse({ message: `body with ${TOKEN}` }, { status, headers }),
    );

    const promise = fetchRepository(repo, { fetch, token: TOKEN });

    await expect(promise).rejects.toThrow(GitHubApiError);
    await expect(promise).rejects.toMatchObject({ reason, status });
    await expect(promise).rejects.toThrow(message);
    await expect(promise).rejects.not.toThrow(TOKEN);
    await expect(promise).rejects.not.toThrow('body with');
  });

  it('includes the rate-limit reset time and suggests a token when none is set', async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(
        {},
        {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1791883800',
          },
        },
      ),
    );

    await expect(
      fetchRepository(repo, { fetch, token: undefined }),
    ).rejects.toThrow(
      'GitHub API rate limit exceeded (403); resets at 2026-10-13T09:30:00.000Z. Set GITHUB_TOKEN to raise the limit',
    );
  });

  it('does not suggest a token when one is already set', async () => {
    const fetch = fakeFetch(() => jsonResponse({}, { status: 429 }));

    await expect(
      fetchRepository(repo, { fetch, token: TOKEN }),
    ).rejects.toThrow(/^GitHub API rate limit exceeded \(429\)$/);
  });

  it('ignores a non-numeric reset header', async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(
        {},
        { status: 429, headers: { 'x-ratelimit-reset': 'soon' } },
      ),
    );

    await expect(
      fetchRepository(repo, { fetch, token: TOKEN }),
    ).rejects.toThrow(/^GitHub API rate limit exceeded \(429\)$/);
  });

  it('maps a network failure to "network" and keeps the cause', async () => {
    const cause = new TypeError('fetch failed');
    const promise = fetchRepository(repo, {
      fetch: failingFetch(cause),
      token: TOKEN,
    });

    await expect(promise).rejects.toMatchObject({ reason: 'network', cause });
    await expect(promise).rejects.toThrow(/Could not reach the GitHub API/);
  });

  it('maps an abort timeout to "timeout"', async () => {
    const cause = new DOMException('The operation timed out.', 'TimeoutError');
    const promise = fetchRepository(repo, {
      fetch: failingFetch(cause),
      token: undefined,
    });

    await expect(promise).rejects.toMatchObject({ reason: 'timeout', cause });
    await expect(promise).rejects.toThrow(/Timed out after 10s/);
  });

  it('maps a timeout while reading the body to "timeout"', async () => {
    const response = jsonResponse(FULL_REPO_RESPONSE);
    vi.spyOn(response, 'json').mockRejectedValue(
      new DOMException('timed out', 'TimeoutError'),
    );

    await expect(
      fetchRepository(repo, {
        fetch: fakeFetch(() => response),
        token: undefined,
      }),
    ).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('maps a non-JSON 200 body to "malformed-response"', async () => {
    const fetch = fakeFetch(() => textResponse('<html>oops</html>'));

    await expect(
      fetchRepository(repo, { fetch, token: undefined }),
    ).rejects.toMatchObject({ reason: 'malformed-response', status: 200 });
  });

  it('maps an unexpected JSON shape to "malformed-response"', async () => {
    const fetch = fakeFetch(() => jsonResponse([]));

    await expect(
      fetchRepository(repo, { fetch, token: undefined }),
    ).rejects.toMatchObject({ reason: 'malformed-response' });
  });

  it.each([
    'https://evil.example.com/repos/x',
    'http://api.github.com/repos/x',
    'https://api.github.com.evil.example/repos/x',
    'not a url',
  ])('refuses a response whose final URL is %s (DR-2)', async (url) => {
    const fetch = fakeFetch(() => jsonResponse(FULL_REPO_RESPONSE, { url }));

    await expect(
      fetchRepository(repo, { fetch, token: TOKEN }),
    ).rejects.toMatchObject({
      reason: 'malformed-response',
      message: expect.stringContaining(
        'redirected away from https://api.github.com',
      ),
    });
  });
});
