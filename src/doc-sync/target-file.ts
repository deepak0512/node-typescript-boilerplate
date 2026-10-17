import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { TargetFileError } from './errors.js';
import { isInside } from './paths.js';
import type { FileSystemLike, TargetFile } from './types.js';

export interface ReadTargetDeps {
  readonly fs: FileSystemLike;
  readonly cwd: string;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

/**
 * Resolves, validates, and reads the target file (FR-7, NFR-1.4). Symlinks are resolved on both
 * the file and the cwd before the containment check, so a link cannot escape the cwd (DR-5).
 *
 * @param displayPath - `--out` as given by the user, used in error messages (DR-13).
 */
export async function readTarget(
  outPath: string,
  displayPath: string,
  { fs, cwd }: ReadTargetDeps,
): Promise<TargetFile> {
  let realCwd: string;
  let realPath: string;
  try {
    realCwd = await fs.realpath(cwd);
    realPath = await fs.realpath(outPath);
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      throw new TargetFileError('not-found', `${displayPath}: file not found`, {
        cause: error,
      });
    }
    throw new TargetFileError(
      'read-failed',
      `${displayPath}: could not resolve path`,
      { cause: error },
    );
  }

  if (!isInside(realCwd, realPath)) {
    throw new TargetFileError(
      'outside-cwd',
      `${displayPath}: resolves outside the current directory`,
    );
  }

  try {
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) {
      throw new TargetFileError(
        'not-a-file',
        `${displayPath}: not a regular file`,
      );
    }
    const content = await fs.readFile(realPath, 'utf8');
    // Keep permission bits only; the file-type bits are not a valid creation mode.
    return { realPath, content, mode: stat.mode & 0o777 };
  } catch (error: unknown) {
    if (error instanceof TargetFileError) {
      throw error;
    }
    throw new TargetFileError(
      'read-failed',
      `${displayPath}: could not read file`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Atomically replaces the target's contents (NFR-2.1, DR-6): writes a uniquely named temp file
 * next to the real path, restores the original mode, then renames it over the real path so a
 * symlink pointing at the file is preserved.
 */
export async function writeAtomic(
  target: TargetFile,
  content: string,
  displayPath: string,
  fs: FileSystemLike,
  createId: () => string = randomUUID,
): Promise<void> {
  const tempPath = path.join(
    path.dirname(target.realPath),
    `.${path.basename(target.realPath)}.doc-sync-${createId()}.tmp`,
  );
  try {
    await fs.writeFile(tempPath, content, {
      encoding: 'utf8',
      mode: target.mode,
    });
    // writeFile's mode is filtered by the umask; chmod restores the exact original bits.
    await fs.chmod(tempPath, target.mode);
    await fs.rename(tempPath, target.realPath);
  } catch (error: unknown) {
    // Best-effort cleanup: the write failure is the error worth reporting, so a failed
    // removal is deliberately not allowed to replace it.
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw new TargetFileError(
      'write-failed',
      `${displayPath}: could not write file`,
      { cause: error },
    );
  }
}
