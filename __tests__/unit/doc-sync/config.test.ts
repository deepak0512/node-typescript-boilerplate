import { describe, expect, it } from 'vitest';
import { readConfig } from '../../../src/doc-sync/config.js';
import { UsageError } from '../../../src/doc-sync/errors.js';

describe('readConfig', () => {
  it.each([
    ['absent', {}],
    ['empty', { GITHUB_TOKEN: '' }],
    ['whitespace only', { GITHUB_TOKEN: '  \t ' }],
  ])('treats a %s token as no token', (_label, env) => {
    expect(readConfig(env)).toEqual({ token: undefined });
  });

  it('returns a valid token, trimmed', () => {
    expect(readConfig({ GITHUB_TOKEN: '  ghp_abc123  \n' })).toEqual({
      token: 'ghp_abc123',
    });
  });

  it('ignores unrelated variables', () => {
    expect(readConfig({ PATH: '/bin', GH_TOKEN: 'other' })).toEqual({
      token: undefined,
    });
  });

  it.each([
    ['an inner space', 'ghp_secret value'],
    ['an inner newline', 'ghp_secret\nX-Injected: 1'],
    ['a control character', 'ghp_secret\u0007'],
  ])(
    'rejects a token containing %s without echoing it',
    (_label, GITHUB_TOKEN) => {
      let thrown: unknown;
      try {
        readConfig({ GITHUB_TOKEN });
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(UsageError);
      expect(thrown).toHaveProperty(
        'message',
        'GITHUB_TOKEN contains whitespace or control characters',
      );
      expect(String(thrown)).not.toContain('ghp_secret');
    },
  );
});
