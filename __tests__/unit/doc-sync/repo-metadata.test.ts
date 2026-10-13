import { describe, expect, it } from 'vitest';
import { GitHubApiError } from '../../../src/doc-sync/errors.js';
import { parseRepoMetadata } from '../../../src/doc-sync/repo-metadata.js';
import {
  EMPTY_REPO_RESPONSE,
  FULL_REPO_RESPONSE,
} from '../../fixtures/doc-sync.js';

describe('parseRepoMetadata', () => {
  it('maps a full repository response', () => {
    expect(parseRepoMetadata(FULL_REPO_RESPONSE)).toEqual({
      name: 'node-typescript-boilerplate',
      fullName: 'jsynowiec/node-typescript-boilerplate',
      htmlUrl: 'https://github.com/jsynowiec/node-typescript-boilerplate',
      description:
        'Minimalistic project template to jump start a Node.js back-end application in TypeScript.',
      defaultBranch: 'main',
      license: { name: 'Apache License 2.0', spdxId: 'Apache-2.0' },
      topics: ['typescript', 'boilerplate', 'nodejs', 'vitest'],
      homepage: 'https://example.com/docs',
      createdAt: '2017-02-18T19:33:12Z',
    });
  });

  it('handles an empty repository (FR-6)', () => {
    expect(parseRepoMetadata(EMPTY_REPO_RESPONSE)).toEqual({
      name: 'empty',
      fullName: 'octo/empty',
      htmlUrl: 'https://github.com/octo/empty',
      description: null,
      defaultBranch: 'main',
      license: null,
      topics: [],
      homepage: null,
      createdAt: '2026-10-01T00:00:00Z',
    });
  });

  describe('missing optional fields become null (FR-5)', () => {
    const fields = [
      ['description', 'description'],
      ['homepage', 'homepage'],
      ['default_branch', 'defaultBranch'],
      ['created_at', 'createdAt'],
    ] as const;

    it.each(
      fields.flatMap(([api, key]) =>
        [null, '', '   ', 42, undefined].map(
          (value) => [api, key, value] as const,
        ),
      ),
    )('%s = %j → %s is null', (api, key, value) => {
      const result = parseRepoMetadata({ ...FULL_REPO_RESPONSE, [api]: value });
      expect(result[key]).toBeNull();
    });

    it('treats an absent field as missing', () => {
      const withoutDescription = Object.fromEntries(
        Object.entries(FULL_REPO_RESPONSE).filter(
          ([key]) => key !== 'description',
        ),
      );
      expect(parseRepoMetadata(withoutDescription).description).toBeNull();
    });
  });

  it('trims surrounding whitespace from strings', () => {
    expect(
      parseRepoMetadata({ ...FULL_REPO_RESPONSE, description: '  hi  ' })
        .description,
    ).toBe('hi');
  });

  describe('license', () => {
    it.each([
      ['null', null],
      ['a non-object', 'MIT'],
      ['missing name', { spdx_id: 'MIT' }],
      ['empty name', { name: ' ', spdx_id: 'MIT' }],
    ])('is null for %s', (_label, license) => {
      expect(
        parseRepoMetadata({ ...FULL_REPO_RESPONSE, license }).license,
      ).toBeNull();
    });

    it('maps the NOASSERTION placeholder to "Other" without an SPDX id (FR-5)', () => {
      const license = { key: 'other', name: 'Other', spdx_id: 'NOASSERTION' };
      expect(
        parseRepoMetadata({ ...FULL_REPO_RESPONSE, license }).license,
      ).toEqual({ name: 'Other', spdxId: null });
    });

    it('keeps the name when the SPDX id is missing', () => {
      const license = { name: 'Custom', spdx_id: null };
      expect(
        parseRepoMetadata({ ...FULL_REPO_RESPONSE, license }).license,
      ).toEqual({ name: 'Custom', spdxId: null });
    });
  });

  describe('topics', () => {
    it.each([
      ['null', null],
      ['a string', 'typescript'],
      ['missing', undefined],
    ])('are empty when %s', (_label, topics) => {
      expect(
        parseRepoMetadata({ ...FULL_REPO_RESPONSE, topics }).topics,
      ).toEqual([]);
    });

    it('drops non-string and blank entries', () => {
      const topics = ['a', 1, null, '', ' b '];
      expect(
        parseRepoMetadata({ ...FULL_REPO_RESPONSE, topics }).topics,
      ).toEqual(['a', 'b']);
    });
  });

  // Regression CR-5: zone-less or non-ISO values were parsed as local time.
  it.each(['2017-03-02T00:30:00', '2017-03-02', 'March 2, 2017', '2017'])(
    'nulls created_at %j without an explicit time zone',
    (created_at) => {
      expect(
        parseRepoMetadata({ ...FULL_REPO_RESPONSE, created_at }).createdAt,
      ).toBeNull();
    },
  );

  it.each(['2017-03-02T00:30:00Z', '2017-03-02T00:30:00.123+05:30'])(
    'keeps created_at %j with an explicit time zone',
    (created_at) => {
      expect(
        parseRepoMetadata({ ...FULL_REPO_RESPONSE, created_at }).createdAt,
      ).toBe(created_at);
    },
  );

  it('nulls an unparseable created_at instead of throwing (DR-8)', () => {
    expect(
      parseRepoMetadata({ ...FULL_REPO_RESPONSE, created_at: 'not-a-date' })
        .createdAt,
    ).toBeNull();
  });

  describe('malformed responses (FR-11)', () => {
    it.each([
      ['null', null],
      ['a string', 'Not Found'],
      ['an array', [FULL_REPO_RESPONSE]],
      ['an empty object', {}],
      ['missing name', { ...FULL_REPO_RESPONSE, name: undefined }],
      ['missing full_name', { ...FULL_REPO_RESPONSE, full_name: null }],
      ['blank html_url', { ...FULL_REPO_RESPONSE, html_url: ' ' }],
    ])('throws malformed-response for %s', (_label, body) => {
      expect(() => parseRepoMetadata(body)).toThrow(
        expect.objectContaining({
          name: 'GitHubApiError',
          reason: 'malformed-response',
        }),
      );
      expect(() => parseRepoMetadata(body)).toThrow(GitHubApiError);
    });
  });
});
