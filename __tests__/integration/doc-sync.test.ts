import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/doc-sync/cli.js';
import { END_MARKER, START_MARKER } from '../../src/doc-sync/markers.js';
import type { FetchLike } from '../../src/doc-sync/types.js';
import { FIXED_NOW, FULL_REPO_RESPONSE } from '../fixtures/doc-sync.js';
import {
  failingFetch,
  fakeFetch,
  jsonResponse,
} from '../fixtures/fake-fetch.js';

// End-to-end through runCli with the real file system; only `fetch` and the clock are faked,
// so no test touches the network (architecture §7).

const TOKEN = 'ghp_IntegrationSecret42';
const REPO = 'jsynowiec/node-typescript-boilerplate';
const TEMPLATE = [
  '# Project',
  '',
  'Hand-written intro.',
  '',
  '```md',
  START_MARKER,
  'example markers inside a fence are ignored',
  END_MARKER,
  '```',
  '',
  START_MARKER,
  END_MARKER,
  '',
  'Hand-written footer.',
  '',
].join('\n');

const EXPECTED_SECTION = [
  '_Last synced: 2026-10-13T09:30:00Z_',
  '',
  '| Field | Value |',
  '| --- | --- |',
  '| Name | node-typescript-boilerplate |',
  '| Full Name | jsynowiec/node-typescript-boilerplate |',
  '| Description | Minimalistic project template to jump start a Node.js back-end application in TypeScript. |',
  '| URL | [github.com/jsynowiec/node-typescript-boilerplate](https://github.com/jsynowiec/node-typescript-boilerplate) |',
  '| Default Branch | `main` |',
  '| License | Apache License 2.0 (Apache-2.0) |',
  '| Topics | `boilerplate`, `nodejs`, `typescript`, `vitest` |',
  '| Homepage | [example.com/docs](https://example.com/docs) |',
  '| Created | 2017-02-18 |',
].join('\n');

const EXPECTED_FILE = TEMPLATE.replace(
  `${START_MARKER}\n${END_MARKER}\n\nHand-written footer.`,
  `${START_MARKER}\n${EXPECTED_SECTION}\n${END_MARKER}\n\nHand-written footer.`,
);

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-sync-it-'));
  file = path.join(dir, 'README.md');
  await fs.writeFile(file, TEMPLATE, 'utf8');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function cli(
  args: ReadonlyArray<string>,
  {
    fetch = fakeFetch(() => jsonResponse(FULL_REPO_RESPONSE)),
    now = FIXED_NOW,
  }: { fetch?: FetchLike; now?: Date } = {},
): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const code = await runCli(
    args,
    { GITHUB_TOKEN: TOKEN },
    { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) },
    { fetch, fs, now: () => now, cwd: dir },
  );
  // Every scenario doubles as a secret-leak check (NFR-1.1, DR-10).
  expect(stdout + stderr).not.toContain(TOKEN);
  return { code, stdout, stderr };
}

const sync = ['--repo', REPO, '--out', 'README.md'] as const;
const check = [...sync, '--check'] as const;

async function readFile(): Promise<string> {
  return fs.readFile(file, 'utf8');
}

async function leftoverTempFiles(): Promise<ReadonlyArray<string>> {
  return (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'));
}

describe('doc-sync end to end', () => {
  it('writes the section and preserves everything else byte-for-byte', async () => {
    const result = await cli(sync);

    expect(result).toEqual({
      code: 0,
      stdout: 'Updated README.md from jsynowiec/node-typescript-boilerplate\n',
      stderr: '',
    });
    expect(await readFile()).toBe(EXPECTED_FILE);
    expect(await leftoverTempFiles()).toEqual([]);
  });

  it('does not rewrite on a second run with unchanged data (A2)', async () => {
    await cli(sync);
    const before = await fs.stat(file);

    const result = await cli(sync, { now: new Date('2030-01-01T00:00:00Z') });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('not modified');
    expect(await readFile()).toBe(EXPECTED_FILE);
    expect((await fs.stat(file)).mtimeMs).toBe(before.mtimeMs);
  });

  it('--check exits 1 on drift and 0 once synced, never writing (FR-10)', async () => {
    const drift = await cli(check);
    expect(drift.code).toBe(1);
    expect(await readFile()).toBe(TEMPLATE);

    await cli(sync);
    const clean = await cli(check, { now: new Date('2030-01-01T00:00:00Z') });
    expect(clean).toMatchObject({ code: 0, stderr: '' });
    expect(await readFile()).toBe(EXPECTED_FILE);
  });

  it('keeps CRLF line endings throughout', async () => {
    await fs.writeFile(file, TEMPLATE.replace(/\n/g, '\r\n'), 'utf8');

    expect((await cli(sync)).code).toBe(0);

    const content = await readFile();
    expect(content).toBe(EXPECTED_FILE.replace(/\n/g, '\r\n'));
  });

  it('handles an empty repository with "Not Found" fields (FR-6)', async () => {
    const fetch = fakeFetch(() =>
      jsonResponse({
        name: 'empty',
        full_name: 'octo/empty',
        html_url: 'https://github.com/octo/empty',
        description: null,
        license: null,
        topics: [],
        homepage: '',
      }),
    );

    expect(
      (await cli(['--repo', 'octo/empty', '--out', 'README.md'], { fetch }))
        .code,
    ).toBe(0);
    const content = await readFile();
    for (const field of [
      'Description',
      'Default Branch',
      'License',
      'Topics',
      'Homepage',
      'Created',
    ]) {
      expect(content).toContain(`| ${field} | Not Found |`);
    }
  });

  describe('failures leave the file untouched (FR-7, FR-11, NFR-2.1)', () => {
    it.each<[string, () => FetchLike, RegExp]>([
      [
        '404',
        (): FetchLike => fakeFetch(() => jsonResponse({}, { status: 404 })),
        /not found/,
      ],
      [
        '500',
        (): FetchLike => fakeFetch(() => jsonResponse({}, { status: 500 })),
        /unavailable \(500\)/,
      ],
      [
        'rate limit',
        (): FetchLike => fakeFetch(() => jsonResponse({}, { status: 429 })),
        /rate limit/,
      ],
      [
        'network',
        (): FetchLike => failingFetch(new TypeError('fetch failed')),
        /Could not reach/,
      ],
      [
        'foreign redirect',
        (): FetchLike =>
          fakeFetch(() =>
            jsonResponse(FULL_REPO_RESPONSE, { url: 'https://evil.example/x' }),
          ),
        /redirected away/,
      ],
    ])('on %s', async (_label, makeFetch, message) => {
      const result = await cli(sync, { fetch: makeFetch() });

      expect(result.code).toBe(3);
      expect(result.stderr).toMatch(message);
      expect(await readFile()).toBe(TEMPLATE);
      expect(await leftoverTempFiles()).toEqual([]);
    });

    it('on missing markers, without calling the API', async () => {
      await fs.writeFile(file, '# No markers here\n', 'utf8');
      const fetch = fakeFetch(() => jsonResponse(FULL_REPO_RESPONSE));

      const result = await cli(sync, { fetch });

      expect(result.code).toBe(3);
      expect(result.stderr).toContain(
        'README.md: no "<!-- doc-sync:start -->" marker found',
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(await readFile()).toBe('# No markers here\n');
    });

    it('on a missing file', async () => {
      const result = await cli(['--repo', REPO, '--out', 'nope.md']);
      expect(result).toMatchObject({
        code: 3,
        stderr: 'doc-sync: nope.md: file not found\n',
      });
    });

    it('on a directory target', async () => {
      await fs.mkdir(path.join(dir, 'docs'));
      const result = await cli(['--repo', REPO, '--out', 'docs']);
      expect(result).toMatchObject({
        code: 3,
        stderr: 'doc-sync: docs: not a regular file\n',
      });
    });

    it('on an --out outside the working directory (exit 2)', async () => {
      const result = await cli(['--repo', REPO, '--out', '../README.md']);
      expect(result.code).toBe(2);
    });
  });

  it.runIf(process.platform !== 'win32')(
    'preserves the file mode (DR-6; POSIX only, Windows has no mode bits)',
    async () => {
      await fs.chmod(file, 0o640);
      await cli(sync);
      expect((await fs.stat(file)).mode & 0o777).toBe(0o640);
    },
  );

  it('rejects a symlink that escapes the working directory (DR-5)', async (ctx) => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-sync-out-'));
    try {
      const secret = path.join(outside, 'secret.md');
      await fs.writeFile(secret, TEMPLATE, 'utf8');
      try {
        await fs.symlink(secret, path.join(dir, 'link.md'));
      } catch {
        // Justified runtime skip: creating symlinks needs elevated rights or developer mode on
        // Windows. CI (Linux) always runs this test.
        // eslint-disable-next-line vitest/no-disabled-tests
        ctx.skip();
      }

      const result = await cli(['--repo', REPO, '--out', 'link.md']);

      expect(result).toMatchObject({
        code: 3,
        stderr: 'doc-sync: link.md: resolves outside the current directory\n',
      });
      expect(await fs.readFile(secret, 'utf8')).toBe(TEMPLATE);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
