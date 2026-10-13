import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TargetFileError } from '../../../src/doc-sync/errors.js';
import { readTarget, writeAtomic } from '../../../src/doc-sync/target-file.js';
import { FakeFileSystem } from '../../fixtures/fake-fs.js';

const cwd = path.resolve('/work');
const readme = path.join(cwd, 'README.md');

function setup(): FakeFileSystem {
  return new FakeFileSystem().addDir(cwd);
}

describe('readTarget', () => {
  it('returns the real path, content, and permission bits', async () => {
    const fs = setup().addFile(readme, 'hello', 0o100640);

    await expect(readTarget(readme, 'README.md', { fs, cwd })).resolves.toEqual(
      {
        realPath: readme,
        content: 'hello',
        mode: 0o640,
      },
    );
  });

  it('follows a symlink that stays inside the cwd', async () => {
    const real = path.join(cwd, 'docs', 'real.md');
    const fs = setup().addFile(real, 'x').addLink(readme, real);

    await expect(
      readTarget(readme, 'README.md', { fs, cwd }),
    ).resolves.toMatchObject({ realPath: real, content: 'x' });
  });

  it('resolves a symlinked cwd before comparing (DR-5)', async () => {
    const realCwd = path.resolve('/real-work');
    const fs = new FakeFileSystem()
      .addDir(realCwd)
      .addFile(path.join(realCwd, 'README.md'), 'x')
      .addLink(cwd, realCwd);

    await expect(
      readTarget(readme, 'README.md', { fs, cwd }),
    ).resolves.toMatchObject({ content: 'x' });
  });

  it.each([
    ['not-found', (): FakeFileSystem => setup(), 'README.md: file not found'],
    [
      'outside-cwd',
      (): FakeFileSystem =>
        setup()
          .addFile(path.resolve('/etc/secret.md'), 'x')
          .addLink(readme, path.resolve('/etc/secret.md')),
      'README.md: resolves outside the current directory',
    ],
    [
      'not-a-file',
      (): FakeFileSystem => setup().addDir(readme),
      'README.md: not a regular file',
    ],
    [
      'read-failed',
      (): FakeFileSystem =>
        setup()
          .addFile(readme, 'x')
          .failOn(
            'readFile',
            Object.assign(new Error('EACCES'), { code: 'EACCES' }),
          ),
      'README.md: could not read file',
    ],
    [
      'read-failed',
      (): FakeFileSystem =>
        setup().failOn(
          'realpath',
          Object.assign(new Error('EIO'), { code: 'EIO' }),
        ),
      'README.md: could not resolve path',
    ],
  ])('throws %s', async (reason, makeFs, message) => {
    const promise = readTarget(readme, 'README.md', { fs: makeFs(), cwd });

    await expect(promise).rejects.toThrow(TargetFileError);
    await expect(promise).rejects.toMatchObject({ reason, message });
  });

  it('keeps the underlying error as the cause', async () => {
    const cause = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    const fs = setup().addFile(readme, 'x').failOn('readFile', cause);

    await expect(
      readTarget(readme, 'README.md', { fs, cwd }),
    ).rejects.toMatchObject({ cause });
  });
});

describe('writeAtomic', () => {
  const target = { realPath: readme, content: 'old', mode: 0o640 } as const;
  const tempPath = path.join(cwd, '.README.md.doc-sync-fixed-id.tmp');
  const fixedId = (): string => 'fixed-id';

  it('writes a temp file next to the target, restores the mode, then renames', async () => {
    const fs = setup().addFile(readme, 'old');

    await writeAtomic(target, 'new', 'README.md', fs, fixedId);

    expect(fs.calls.map((c) => c.method)).toEqual([
      'writeFile',
      'chmod',
      'rename',
    ]);
    expect(fs.callsTo('writeFile')[0]).toEqual([
      tempPath,
      'new',
      { encoding: 'utf8', mode: 0o640 },
    ]);
    expect(fs.callsTo('chmod')[0]).toEqual([tempPath, 0o640]);
    expect(fs.callsTo('rename')[0]).toEqual([tempPath, readme]);
    expect(fs.contentOf(readme)).toBe('new');
    expect(fs.contentOf(tempPath)).toBeUndefined();
  });

  it('uses a random temp name by default', async () => {
    const fs = setup().addFile(readme, 'old');

    await writeAtomic(target, 'new', 'README.md', fs);

    expect(fs.callsTo('writeFile')[0]?.[0]).toMatch(
      /\.README\.md\.doc-sync-[0-9a-f-]{36}\.tmp$/,
    );
  });

  it.each(['writeFile', 'chmod', 'rename'] as const)(
    'removes the temp file and leaves the target unchanged when %s fails',
    async (method) => {
      const cause = new Error(`${method} failed`);
      const fs = setup().addFile(readme, 'old').failOn(method, cause);

      await expect(
        writeAtomic(target, 'new', 'README.md', fs, fixedId),
      ).rejects.toMatchObject({
        name: 'TargetFileError',
        reason: 'write-failed',
        message: 'README.md: could not write file',
        cause,
      });
      expect(fs.callsTo('rm')).toEqual([[tempPath, { force: true }]]);
      expect(fs.contentOf(readme)).toBe('old');
      expect(fs.contentOf(tempPath)).toBeUndefined();
    },
  );

  it('reports the write failure even if cleanup also fails', async () => {
    const cause = new Error('rename failed');
    const fs = setup()
      .addFile(readme, 'old')
      .failOn('rename', cause)
      .failOn('rm', new Error('rm failed'));

    await expect(
      writeAtomic(target, 'new', 'README.md', fs, fixedId),
    ).rejects.toMatchObject({ reason: 'write-failed', cause });
  });
});
