import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { END_MARKER, START_MARKER } from '../../../src/doc-sync/markers.js';
import { syncDocs } from '../../../src/doc-sync/sync.js';
import type { CliOptions, SyncDeps } from '../../../src/doc-sync/types.js';
import { FIXED_NOW, FULL_REPO_RESPONSE } from '../../fixtures/doc-sync.js';
import { FakeFileSystem } from '../../fixtures/fake-fs.js';
import { fakeFetch, jsonResponse } from '../../fixtures/fake-fetch.js';

const cwd = path.resolve('/work');
const outPath = path.join(cwd, 'README.md');
const options: CliOptions = {
  repo: { owner: 'jsynowiec', name: 'node-typescript-boilerplate' },
  outArg: 'README.md',
  outPath,
  check: false,
};
const EMPTY_SECTION = `# Title\n${START_MARKER}\n${END_MARKER}\nfooter\n`;

function setup(content: string): {
  fs: FakeFileSystem;
  fetch: ReturnType<typeof fakeFetch>;
  deps: SyncDeps;
} {
  const fs = new FakeFileSystem().addDir(cwd).addFile(outPath, content);
  const fetch = fakeFetch(() => jsonResponse(FULL_REPO_RESPONSE));
  return {
    fs,
    fetch,
    deps: { fs, fetch, now: () => FIXED_NOW, token: undefined, cwd },
  };
}

async function syncedContent(): Promise<string> {
  const { fs, deps } = setup(EMPTY_SECTION);
  await syncDocs(options, deps);
  const content = fs.contentOf(outPath);
  if (content === undefined) {
    throw new Error('file missing');
  }
  return content;
}

describe('syncDocs write mode (FR-9)', () => {
  it('fills an empty section and reports "updated"', async () => {
    const { fs, deps } = setup(EMPTY_SECTION);

    await expect(syncDocs(options, deps)).resolves.toEqual({ kind: 'updated' });

    const content = fs.contentOf(outPath) ?? '';
    expect(
      content.startsWith(
        `# Title\n${START_MARKER}\n_Last synced: 2026-10-13T09:30:00Z_\n`,
      ),
    ).toBe(true);
    expect(
      content.endsWith(`| Created | 2017-02-18 |\n${END_MARKER}\nfooter\n`),
    ).toBe(true);
    expect(fs.callsTo('rename')).toHaveLength(1);
  });

  it('does not rewrite when only the timestamp would change (A2)', async () => {
    const existing = await syncedContent();
    const { fs, deps } = setup(existing);
    const later = {
      ...deps,
      now: (): Date => new Date('2030-01-01T00:00:00Z'),
    };

    await expect(syncDocs(options, later)).resolves.toEqual({
      kind: 'unchanged',
    });
    expect(fs.callsTo('writeFile')).toHaveLength(0);
    expect(fs.contentOf(outPath)).toBe(existing);
  });

  it('rewrites when the data changed', async () => {
    const existing = await syncedContent();
    const { fs, deps } = setup(existing);
    const fetch = fakeFetch(() =>
      jsonResponse({ ...FULL_REPO_RESPONSE, description: 'New description' }),
    );

    await expect(syncDocs(options, { ...deps, fetch })).resolves.toEqual({
      kind: 'updated',
    });
    expect(fs.contentOf(outPath)).toContain(
      '| Description | New description |',
    );
  });

  it('keeps CRLF line endings', async () => {
    const { fs, deps } = setup(EMPTY_SECTION.replace(/\n/g, '\r\n'));

    await syncDocs(options, deps);

    const content = fs.contentOf(outPath) ?? '';
    expect(content.replace(/\r\n/g, '')).not.toContain('\n');
    expect(content).toContain('| Name | node-typescript-boilerplate |\r\n');
  });
});

describe('syncDocs check mode (FR-10)', () => {
  const check = { ...options, check: true };

  it('reports "out-of-date" for an empty section and never writes', async () => {
    const { fs, deps } = setup(EMPTY_SECTION);

    await expect(syncDocs(check, deps)).resolves.toEqual({
      kind: 'out-of-date',
    });
    expect(fs.callsTo('writeFile')).toHaveLength(0);
    expect(fs.callsTo('rename')).toHaveLength(0);
  });

  it('reports "up-to-date" when only the timestamp differs', async () => {
    const existing = await syncedContent();
    const { fs, deps } = setup(existing);
    const later = {
      ...deps,
      now: (): Date => new Date('2030-01-01T00:00:00Z'),
    };

    await expect(syncDocs(check, later)).resolves.toEqual({
      kind: 'up-to-date',
    });
    expect(fs.callsTo('writeFile')).toHaveLength(0);
  });

  it('reports "out-of-date" when the data changed', async () => {
    const existing = await syncedContent();
    const { deps } = setup(existing);
    const fetch = fakeFetch(() =>
      jsonResponse({ ...FULL_REPO_RESPONSE, topics: ['changed'] }),
    );

    await expect(syncDocs(check, { ...deps, fetch })).resolves.toEqual({
      kind: 'out-of-date',
    });
  });
});

describe('syncDocs fails before side effects', () => {
  it.each([
    [
      'the file is missing',
      (fs: FakeFileSystem): void => void fs.files.clear(),
      'not-found',
    ],
    [
      'markers are missing',
      (fs: FakeFileSystem): void => void fs.addFile(outPath, '# none\n'),
      'missing-start-marker',
    ],
  ])('does not call the API when %s', async (_label, mutate, reason) => {
    const { fs, fetch, deps } = setup(EMPTY_SECTION);
    mutate(fs);

    await expect(syncDocs(options, deps)).rejects.toMatchObject({ reason });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves the file unchanged when the API fails (FR-11)', async () => {
    const { fs, deps } = setup(EMPTY_SECTION);
    const fetch = fakeFetch(() => jsonResponse({}, { status: 500 }));

    await expect(syncDocs(options, { ...deps, fetch })).rejects.toMatchObject({
      reason: 'server-error',
    });
    expect(fs.contentOf(outPath)).toBe(EMPTY_SECTION);
    expect(fs.callsTo('writeFile')).toHaveLength(0);
  });

  it('passes the token to the API client', async () => {
    const { fetch, deps } = setup(EMPTY_SECTION);

    await syncDocs(options, { ...deps, token: 'ghp_x' });

    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer ghp_x',
    });
  });
});
