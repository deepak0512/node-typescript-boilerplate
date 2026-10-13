import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseCliArgs,
  parseRepoRef,
  USAGE,
} from '../../../src/doc-sync/args.js';
import { UsageError } from '../../../src/doc-sync/errors.js';

const cwd = '/work';
const parse = (argv: ReadonlyArray<string>): ReturnType<typeof parseCliArgs> =>
  parseCliArgs(argv, cwd, path.posix);

describe('parseCliArgs', () => {
  it('parses a valid write-mode invocation', () => {
    expect(parse(['--repo', 'octo/hello', '--out', 'README.md'])).toEqual({
      kind: 'run',
      options: {
        repo: { owner: 'octo', name: 'hello' },
        outArg: 'README.md',
        outPath: '/work/README.md',
        check: false,
      },
    });
  });

  it('parses --check and --flag=value syntax', () => {
    const result = parse(['--check', '--repo=octo/hello', '--out=docs/a.md']);
    expect(result).toMatchObject({
      kind: 'run',
      options: { check: true, outPath: '/work/docs/a.md' },
    });
  });

  it('returns help when --help is given, even with other flags', () => {
    expect(parse(['--help'])).toEqual({ kind: 'help' });
    expect(parse(['--repo', 'octo/hello', '--help'])).toEqual({ kind: 'help' });
  });

  it.each([
    ['--repo missing', ['--out', 'README.md'], /--repo/],
    ['--out missing', ['--repo', 'octo/hello'], /--out/],
    ['no arguments', [], /--repo/],
    ['an unknown flag', ['--repo', 'o/r', '--out', 'a.md', '--force'], /force/],
    ['a positional', ['o/r'], /positional/i],
    ['--repo without a value', ['--out', 'a.md', '--repo'], /repo/],
  ])('throws UsageError for %s', (_label, argv, message) => {
    expect(() => parse(argv)).toThrow(UsageError);
    expect(() => parse(argv)).toThrow(message);
  });

  it('keeps the parseArgs error as the cause', () => {
    expect(() => parse(['--nope'])).toThrow(
      expect.objectContaining({
        name: 'UsageError',
        cause: expect.any(Error),
      }),
    );
  });

  describe('--out containment (NFR-1.4)', () => {
    it.each([
      ['an absolute path', '/etc/passwd'],
      ['a parent traversal', '../outside.md'],
      ['a nested traversal', 'docs/../../outside.md'],
      ['the cwd itself', '.'],
      ['an empty value', ''],
      ['whitespace', '   '],
    ])('rejects %s', (_label, out) => {
      expect(() => parse(['--repo', 'o/r', '--out', out])).toThrow(
        /must be a relative path inside the current directory/,
      );
    });

    it('accepts a traversal that stays inside the cwd', () => {
      expect(
        parse(['--repo', 'o/r', '--out', 'docs/../README.md']),
      ).toMatchObject({
        options: { outPath: '/work/README.md', outArg: 'docs/../README.md' },
      });
    });

    it('rejects a Windows path on another drive', () => {
      expect(() =>
        parseCliArgs(
          ['--repo', 'o/r', '--out', 'D:\\x.md'],
          'C:\\work',
          path.win32,
        ),
      ).toThrow(UsageError);
    });

    it('rejects a Windows drive-relative path on another drive', () => {
      expect(() =>
        parseCliArgs(
          ['--repo', 'o/r', '--out', 'D:x.md'],
          'C:\\work',
          path.win32,
        ),
      ).toThrow(UsageError);
    });
  });
});

describe('parseRepoRef (FR-2)', () => {
  it.each([
    ['octo/hello', { owner: 'octo', name: 'hello' }],
    ['a/b', { owner: 'a', name: 'b' }],
    ['my-org/repo.name_v2', { owner: 'my-org', name: 'repo.name_v2' }],
    ['o/.github', { owner: 'o', name: '.github' }],
    [
      `${'a'.repeat(39)}/${'b'.repeat(100)}`,
      { owner: 'a'.repeat(39), name: 'b'.repeat(100) },
    ],
  ])('accepts %s', (value, expected) => {
    expect(parseRepoRef(value)).toEqual(expected);
  });

  it.each([
    'foo',
    'foo/bar/baz',
    '../x',
    'foo/..',
    'foo/.',
    '-foo/x',
    '/x',
    'x/',
    'o w/r',
    'o/r?x=1',
    'o/r#frag',
    `${'a'.repeat(40)}/r`,
    `o/${'b'.repeat(101)}`,
  ])('rejects %j', (value) => {
    expect(() => parseRepoRef(value)).toThrow(UsageError);
  });

  it('quotes the rejected value in the message', () => {
    expect(() => parseRepoRef('bad\nvalue')).toThrow(
      'Invalid --repo "bad\\nvalue": expected "owner/repo"',
    );
  });
});

describe('USAGE', () => {
  it('documents every flag and the exit codes', () => {
    for (const flag of [
      '--repo',
      '--out',
      '--check',
      '--help',
      'GITHUB_TOKEN',
    ]) {
      expect(USAGE).toContain(flag);
    }
    expect(USAGE).toMatch(
      /0 success, 1 out of date \(--check\), 2 usage error, 3 runtime error/,
    );
  });
});
