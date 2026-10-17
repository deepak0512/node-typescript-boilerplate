// Shared test data for doc-sync. Shapes follow the GitHub REST API `GET /repos/{owner}/{repo}`
// response (only the fields doc-sync reads, plus a few it must ignore).

export const FULL_REPO_RESPONSE = {
  id: 82_412_345,
  name: 'node-typescript-boilerplate',
  full_name: 'jsynowiec/node-typescript-boilerplate',
  private: false,
  html_url: 'https://github.com/jsynowiec/node-typescript-boilerplate',
  description:
    'Minimalistic project template to jump start a Node.js back-end application in TypeScript.',
  homepage: 'https://example.com/docs',
  default_branch: 'main',
  created_at: '2017-02-18T19:33:12Z',
  stargazers_count: 2600,
  license: {
    key: 'apache-2.0',
    name: 'Apache License 2.0',
    spdx_id: 'Apache-2.0',
  },
  topics: ['typescript', 'boilerplate', 'nodejs', 'vitest'],
} as const;

/** An empty repository: GitHub still returns metadata, but optional fields are absent (FR-6). */
export const EMPTY_REPO_RESPONSE = {
  name: 'empty',
  full_name: 'octo/empty',
  html_url: 'https://github.com/octo/empty',
  description: null,
  homepage: null,
  default_branch: 'main',
  created_at: '2026-10-01T00:00:00Z',
  size: 0,
  license: null,
  topics: [],
} as const;

export const FIXED_NOW = new Date('2026-10-13T09:30:00.123Z');
