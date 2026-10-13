import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { USAGE } from '../../../src/doc-sync/args.js';
import { type CliDeps, runCli } from '../../../src/doc-sync/cli.js';
import { END_MARKER, START_MARKER } from '../../../src/doc-sync/markers.js';
import type { FetchLike } from '../../../src/doc-sync/types.js';
import { FIXED_NOW, FULL_REPO_RESPONSE } from '../../fixtures/doc-sync.js';
import { FakeFileSystem } from '../../fixtures/fake-fs.js';
import {
  failingFetch,
  fakeFetch,
  jsonResponse,
} from '../../fixtures/fake-fetch.js';

const cwd = path.resolve('/work');
const outPath = path.join(cwd, 'docs', 'INFO.md');
const SECTION = `${START_MARKER}\n${END_MARKER}\n`;
const ARGS = ['--repo', 'octo/hello', '--out', 'docs/INFO.md'] as const;
const TOKEN = 'ghp_CliSecret987';

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly fs: FakeFileSystem;
}

async function run(
  argv: ReadonlyArray<string>,
  {
    env = {},
    fetch = fakeFetch(() => jsonResponse(FULL_REPO_RESPONSE)),
    content = SECTION,
  }: {
    env?: Record<string, string>;
    fetch?: FetchLike;
    content?: string;
  } = {},
): Promise<Run> {
  let stdout = '';
  let stderr = '';
  const fs = new FakeFileSystem().addDir(cwd).addFile(outPath, content);
  const deps: CliDeps = { fetch, fs, now: () => FIXED_NOW, cwd };
  const code = await runCli(
    argv,
    env,
    {
      stdout: (t) => (stdout += t),
      stderr: (t) => (stderr += t),
    },
    deps,
  );
  return { code, stdout, stderr, fs };
}

describe('runCli', () => {
  it('prints usage to stdout for --help and exits 0', async () => {
    const result = await run(['--help']);
    expect(result).toMatchObject({ code: 0, stdout: `${USAGE}\n`, stderr: '' });
  });

  it('updates the file and reports the relative --out path (FR-9, DR-13)', async () => {
    const result = await run(ARGS);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Updated docs/INFO.md from octo/hello\n');
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain(cwd);
    expect(result.fs.contentOf(outPath)).toContain(
      '| Name | node-typescript-boilerplate |',
    );
  });

  it('reports "not modified" when nothing changed', async () => {
    const first = await run(ARGS);
    const second = await run(ARGS, {
      content: first.fs.contentOf(outPath) ?? '',
    });

    expect(second.code).toBe(0);
    expect(second.stdout).toBe(
      'docs/INFO.md is already up to date with octo/hello; not modified\n',
    );
  });

  it('exits 1 with a message on stderr when --check finds drift (FR-10)', async () => {
    const result = await run([...ARGS, '--check']);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'docs/INFO.md is out of date with octo/hello; run without --check to update it\n',
    );
    expect(result.fs.contentOf(outPath)).toBe(SECTION);
  });

  it('exits 0 when --check finds the doc up to date', async () => {
    const first = await run(ARGS);
    const result = await run([...ARGS, '--check'], {
      content: first.fs.contentOf(outPath) ?? '',
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('docs/INFO.md is up to date with octo/hello\n');
  });

  describe('usage errors exit 2', () => {
    it.each([
      [['--out', 'a.md']],
      [['--repo', 'not-a-repo', '--out', 'a.md']],
      [['--repo', 'o/r', '--out', '../outside.md']],
      [['--unknown']],
    ])('%j', async (argv) => {
      const fetch = fakeFetch(() => jsonResponse(FULL_REPO_RESPONSE));
      const result = await run(argv, { fetch });

      expect(result.code).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(
        /^doc-sync: .+\nRun 'doc-sync --help' for usage\.\n$/,
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it('for a malformed token, without echoing it', async () => {
      const result = await run(ARGS, { env: { GITHUB_TOKEN: `${TOKEN} x` } });

      expect(result.code).toBe(2);
      expect(result.stderr).toContain(
        'GITHUB_TOKEN contains whitespace, control, or non-ASCII characters',
      );
      expect(result.stderr).not.toContain(TOKEN);
    });
  });

  describe('runtime errors exit 3', () => {
    it('for a missing file', async () => {
      let stderr = '';
      const code = await runCli(
        ARGS,
        {},
        { stdout: () => undefined, stderr: (t) => (stderr += t) },
        {
          fetch: fakeFetch(() => jsonResponse(FULL_REPO_RESPONSE)),
          fs: new FakeFileSystem().addDir(cwd),
          now: () => FIXED_NOW,
          cwd,
        },
      );

      expect(code).toBe(3);
      expect(stderr).toBe('doc-sync: docs/INFO.md: file not found\n');
    });

    it('for missing markers', async () => {
      const result = await run(ARGS, { content: '# nothing\n' });

      expect(result.code).toBe(3);
      expect(result.stderr).toMatch(
        /^doc-sync: docs\/INFO\.md: no "<!-- doc-sync:start -->" marker found/,
      );
    });

    it.each([
      [404, /octo\/hello not found/],
      [500, /unavailable \(500\)/],
      [401, /rejected the token/],
    ])('for HTTP %i', async (status, message) => {
      const result = await run(ARGS, {
        fetch: fakeFetch(() => jsonResponse({}, { status })),
      });

      expect(result.code).toBe(3);
      expect(result.stderr).toMatch(message);
      expect(result.fs.contentOf(outPath)).toBe(SECTION);
    });

    it('for a synchronous fetch throw, mapped to a network error without its details', async () => {
      const result = await run(ARGS, {
        fetch: () => {
          throw new RangeError('internal detail');
        },
      });

      expect(result.code).toBe(3);
      expect(result.stderr).toMatch(/Could not reach the GitHub API/);
      expect(result.stderr).not.toContain('internal detail');
    });

    it('prints only a generic message for non-DocSyncError failures', async () => {
      let stderr = '';
      const fs = new FakeFileSystem().addDir(cwd).addFile(outPath, SECTION);
      const code = await runCli(
        ARGS,
        {},
        { stdout: () => undefined, stderr: (t) => (stderr += t) },
        {
          fetch: fakeFetch(() => jsonResponse(FULL_REPO_RESPONSE)),
          fs,
          now: () => {
            throw new Error('clock exploded: secret detail');
          },
          cwd,
        },
      );

      expect(code).toBe(3);
      expect(stderr).toBe('doc-sync: unexpected internal error\n');
    });
  });

  it('redacts the token from any output (NFR-1.1)', async () => {
    const result = await run(ARGS, {
      env: { GITHUB_TOKEN: TOKEN },
      fetch: failingFetch(new TypeError(`connect failed ${TOKEN}`)),
    });

    expect(result.code).toBe(3);
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
  });

  it('redacts the token if it ever appears in a message', async () => {
    // A repo name equal to the token forces it into the success message.
    const token = 'abc123';
    const result = await run(
      ['--repo', `octo/${token}`, '--out', 'docs/INFO.md'],
      {
        env: { GITHUB_TOKEN: token },
      },
    );

    expect(result.stdout).toBe('Updated docs/INFO.md from octo/***\n');
  });
});
