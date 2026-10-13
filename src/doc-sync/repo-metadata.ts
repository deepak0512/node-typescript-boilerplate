import { GitHubApiError } from './errors.js';
import type { RepoLicense, RepoMetadata } from './types.js';

type JsonObject = Readonly<Record<string, unknown>>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the trimmed string, or `null` for anything "missing" (FR-5). */
function presentString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function parseLicense(value: unknown): RepoLicense | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const name = presentString(value['name']);
  if (name === null) {
    return null;
  }
  const spdxId = presentString(value['spdx_id']);
  // GitHub reports unrecognised licenses as `{ name: "Other", spdx_id: "NOASSERTION" }`.
  return { name, spdxId: spdxId === 'NOASSERTION' ? null : spdxId };
}

function parseTopics(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(presentString)
    .filter((topic): topic is string => topic !== null);
}

function parseTimestamp(value: unknown): string | null {
  const text = presentString(value);
  return text !== null && !Number.isNaN(Date.parse(text)) ? text : null;
}

/**
 * Narrows a `GET /repos/{owner}/{repo}` response body into `RepoMetadata` (FR-4, FR-5, FR-6).
 * Only `name`, `full_name`, and `html_url` are required; everything else degrades to `null`.
 */
export function parseRepoMetadata(json: unknown): RepoMetadata {
  if (!isJsonObject(json)) {
    throw new GitHubApiError(
      'malformed-response',
      'Unexpected GitHub API response: expected a repository object',
    );
  }
  const name = presentString(json['name']);
  const fullName = presentString(json['full_name']);
  const htmlUrl = presentString(json['html_url']);
  if (name === null || fullName === null || htmlUrl === null) {
    throw new GitHubApiError(
      'malformed-response',
      'Unexpected GitHub API response: missing name, full_name, or html_url',
    );
  }
  return {
    name,
    fullName,
    htmlUrl,
    description: presentString(json['description']),
    defaultBranch: presentString(json['default_branch']),
    license: parseLicense(json['license']),
    topics: parseTopics(json['topics']),
    homepage: presentString(json['homepage']),
    createdAt: parseTimestamp(json['created_at']),
  };
}
