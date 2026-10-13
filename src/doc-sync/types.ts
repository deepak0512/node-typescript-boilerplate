/**
 * Shared shapes for doc-sync. Types only: this module has no runtime code.
 */

/** Process exit codes (requirements NFR-2.3). */
export type ExitCode = 0 | 1 | 2 | 3;

/** A validated `owner/repo` reference. */
export interface RepoRef {
  readonly owner: string;
  readonly name: string;
}

export interface CliOptions {
  readonly repo: RepoRef;
  /** `--out` exactly as given by the user; used in messages (DR-13). */
  readonly outArg: string;
  /** Absolute path, lexically inside the working directory (DR-5). */
  readonly outPath: string;
  readonly check: boolean;
}

export interface RepoLicense {
  readonly name: string;
  readonly spdxId: string | null;
}

/** Repository metadata; `null` / empty means "Not Found" when rendered. */
export interface RepoMetadata {
  readonly name: string;
  readonly fullName: string;
  readonly htmlUrl: string;
  readonly description: string | null;
  readonly defaultBranch: string | null;
  readonly license: RepoLicense | null;
  readonly topics: ReadonlyArray<string>;
  readonly homepage: string | null;
  /** ISO-8601 timestamp, or `null` if missing or unparseable (DR-8). */
  readonly createdAt: string | null;
}

export type SyncResult =
  | { readonly kind: 'updated' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'up-to-date' }
  | { readonly kind: 'out-of-date' };

/** Narrow `fetch` seam so tests never touch the network (NFR-4.1). */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface FileStat {
  isFile(): boolean;
  readonly mode: number;
}

/** The subset of `node:fs/promises` doc-sync uses (NFR-4.1). */
export interface FileSystemLike {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(
    path: string,
    data: string,
    options: { readonly encoding: 'utf8'; readonly mode: number },
  ): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { readonly force: true }): Promise<void>;
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<FileStat>;
}

/** A validated target file, as returned by `readTarget` (DR-5, DR-6). */
export interface TargetFile {
  readonly realPath: string;
  readonly content: string;
  readonly mode: number;
}

export interface SyncDeps {
  readonly fetch: FetchLike;
  readonly fs: FileSystemLike;
  readonly now: () => Date;
  readonly token: string | undefined;
  readonly cwd: string;
}
