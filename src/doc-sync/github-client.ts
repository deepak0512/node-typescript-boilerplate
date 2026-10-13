import { GitHubApiError } from './errors.js';
import { parseRepoMetadata } from './repo-metadata.js';
import type { FetchLike, RepoMetadata, RepoRef } from './types.js';

/** The only host doc-sync talks to; the token is never sent anywhere else (NFR-1.5). */
export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';
export const REQUEST_TIMEOUT_MS = 10_000;

export interface FetchRepositoryDeps {
  readonly fetch: FetchLike;
  readonly token: string | undefined;
  readonly timeoutMs?: number;
}

/**
 * Fetches `GET /repos/{owner}/{repo}` and parses it (FR-3, FR-11). Every failure becomes a
 * `GitHubApiError` whose message never includes the token, headers, or response body.
 */
export async function fetchRepository(
  repo: RepoRef,
  { fetch, token, timeoutMs = REQUEST_TIMEOUT_MS }: FetchRepositoryDeps,
): Promise<RepoMetadata> {
  const label = `${repo.owner}/${repo.name}`;
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': 'doc-sync',
  };
  if (token !== undefined) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error: unknown) {
    throw transportError(error, label, timeoutMs);
  }

  // Renamed repos redirect within api.github.com; anything else is refused (DR-2). A synthetic
  // Response has an empty `url`, which means no redirect happened.
  const finalUrl = response.url === '' ? url : response.url;
  if (!isGitHubApiUrl(finalUrl)) {
    throw new GitHubApiError(
      'malformed-response',
      `Unexpected GitHub API response for ${label}: redirected away from ${GITHUB_API_BASE}`,
      { status: response.status },
    );
  }

  if (!response.ok) {
    throw statusError(response, label, token !== undefined);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error: unknown) {
    if (isTimeout(error)) {
      throw transportError(error, label, timeoutMs);
    }
    throw new GitHubApiError(
      'malformed-response',
      `Unexpected GitHub API response for ${label}: body is not valid JSON`,
      { status: response.status, cause: error },
    );
  }
  return parseRepoMetadata(body);
}

function isGitHubApiUrl(value: string): boolean {
  try {
    return new URL(value).origin === GITHUB_API_BASE;
  } catch {
    return false;
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

function transportError(
  error: unknown,
  label: string,
  timeoutMs: number,
): GitHubApiError {
  if (isTimeout(error)) {
    return new GitHubApiError(
      'timeout',
      `Timed out after ${timeoutMs / 1000}s waiting for the GitHub API (${label})`,
      { cause: error },
    );
  }
  return new GitHubApiError(
    'network',
    `Could not reach the GitHub API (${label}); check your network connection`,
    { cause: error },
  );
}

function isRateLimited(response: Response): boolean {
  if (response.status === 429) {
    return true;
  }
  return (
    response.status === 403 &&
    (response.headers.get('x-ratelimit-remaining') === '0' ||
      response.headers.has('retry-after'))
  );
}

function rateLimitDetail(response: Response): string {
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (response.headers.has('x-ratelimit-reset') && Number.isFinite(reset)) {
    return `; resets at ${new Date(reset * 1000).toISOString()}`;
  }
  const retryAfter = Number(response.headers.get('retry-after'));
  if (response.headers.has('retry-after') && Number.isFinite(retryAfter)) {
    return `; retry after ${retryAfter}s`;
  }
  return '';
}

/** Maps a non-2xx response to an error, in the order fixed by the architecture §5 (DR-3). */
function statusError(
  response: Response,
  label: string,
  hasToken: boolean,
): GitHubApiError {
  const { status } = response;
  if (status === 401) {
    return new GitHubApiError(
      'unauthorized',
      'GitHub API rejected the token (401); check that GITHUB_TOKEN is valid and not expired',
      { status },
    );
  }
  if (status === 404) {
    return new GitHubApiError(
      'not-found',
      `Repository ${label} not found, or not accessible with the current credentials (404)`,
      { status },
    );
  }
  if (isRateLimited(response)) {
    const hint = hasToken ? '' : '. Set GITHUB_TOKEN to raise the limit';
    return new GitHubApiError(
      'rate-limited',
      `GitHub API rate limit exceeded (${status})${rateLimitDetail(response)}${hint}`,
      { status },
    );
  }
  if (status === 403) {
    return new GitHubApiError(
      'forbidden',
      `Access to ${label} is forbidden (403)`,
      { status },
    );
  }
  if (status >= 500) {
    return new GitHubApiError(
      'server-error',
      `GitHub API unavailable (${status}); try again later`,
      { status },
    );
  }
  return new GitHubApiError(
    'unexpected-status',
    `GitHub API returned unexpected status ${status} for ${label}`,
    { status },
  );
}
