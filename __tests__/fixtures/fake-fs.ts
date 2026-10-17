import path from 'node:path';
import type { FileStat, FileSystemLike } from '../../src/doc-sync/types.js';

interface FakeFile {
  content: string;
  mode: number;
}

export type FsMethod = keyof FileSystemLike;

function errnoError(code: string, message: string): Error {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

/**
 * In-memory `FileSystemLike` for unit tests. Paths are normalized with `path.resolve`, so tests
 * stay platform-independent. Supports directories, symlinks, and injected failures.
 */
export class FakeFileSystem implements FileSystemLike {
  readonly files = new Map<string, FakeFile>();
  readonly dirs = new Set<string>();
  readonly links = new Map<string, string>();
  readonly calls: Array<{
    readonly method: FsMethod;
    readonly args: ReadonlyArray<unknown>;
  }> = [];
  private readonly failures = new Map<FsMethod, Error>();

  addFile(filePath: string, content: string, mode = 0o100644): this {
    this.files.set(path.resolve(filePath), { content, mode });
    return this;
  }

  addDir(dirPath: string): this {
    this.dirs.add(path.resolve(dirPath));
    return this;
  }

  addLink(linkPath: string, target: string): this {
    this.links.set(path.resolve(linkPath), path.resolve(target));
    return this;
  }

  failOn(method: FsMethod, error: Error): this {
    this.failures.set(method, error);
    return this;
  }

  contentOf(filePath: string): string | undefined {
    return this.files.get(path.resolve(filePath))?.content;
  }

  callsTo(method: FsMethod): ReadonlyArray<ReadonlyArray<unknown>> {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  private record(method: FsMethod, ...args: ReadonlyArray<unknown>): void {
    this.calls.push({ method, args });
    const failure = this.failures.get(method);
    if (failure !== undefined) {
      throw failure;
    }
  }

  /** Resolves links on the path itself and on any parent directory, like `realpath`. */
  private resolveLinks(p: string): string {
    let current = path.resolve(p);
    for (let i = 0; i < 10; i++) {
      const link = [...this.links.keys()].find(
        (from) => current === from || current.startsWith(from + path.sep),
      );
      if (link === undefined) {
        return current;
      }
      current = (this.links.get(link) ?? link) + current.slice(link.length);
    }
    throw errnoError('ELOOP', p);
  }

  private exists(p: string): boolean {
    return this.files.has(p) || this.dirs.has(p);
  }

  async readFile(filePath: string, encoding: 'utf8'): Promise<string> {
    this.record('readFile', filePath, encoding);
    const file = this.files.get(this.resolveLinks(filePath));
    if (file === undefined) {
      throw errnoError('ENOENT', filePath);
    }
    return file.content;
  }

  async writeFile(
    filePath: string,
    data: string,
    options: { readonly encoding: 'utf8'; readonly mode: number },
  ): Promise<void> {
    this.record('writeFile', filePath, data, options);
    this.files.set(path.resolve(filePath), {
      content: data,
      mode: options.mode,
    });
  }

  async chmod(filePath: string, mode: number): Promise<void> {
    this.record('chmod', filePath, mode);
    const file = this.files.get(path.resolve(filePath));
    if (file === undefined) {
      throw errnoError('ENOENT', filePath);
    }
    file.mode = mode;
  }

  async rename(from: string, to: string): Promise<void> {
    this.record('rename', from, to);
    const file = this.files.get(path.resolve(from));
    if (file === undefined) {
      throw errnoError('ENOENT', from);
    }
    this.files.delete(path.resolve(from));
    this.files.set(path.resolve(to), file);
  }

  async rm(filePath: string, options: { readonly force: true }): Promise<void> {
    this.record('rm', filePath, options);
    this.files.delete(path.resolve(filePath));
  }

  async realpath(filePath: string): Promise<string> {
    this.record('realpath', filePath);
    const resolved = this.resolveLinks(filePath);
    if (!this.exists(resolved)) {
      throw errnoError('ENOENT', filePath);
    }
    return resolved;
  }

  async stat(filePath: string): Promise<FileStat> {
    this.record('stat', filePath);
    const resolved = this.resolveLinks(filePath);
    const file = this.files.get(resolved);
    if (file !== undefined) {
      return { isFile: () => true, mode: file.mode };
    }
    if (this.dirs.has(resolved)) {
      return { isFile: () => false, mode: 0o40755 };
    }
    throw errnoError('ENOENT', filePath);
  }
}
