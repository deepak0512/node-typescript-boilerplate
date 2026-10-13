# Architecture: Automated Documentation Sync (`doc-sync`)

> SDLC Step 2 · Input: [requirements.md](requirements.md) (approved) · Status: **Approved (2026-10-13), revised after [design review](design-review.md) (see §11)**

## 1. Context and Goals

`doc-sync` is a small, dependency-free CLI inside this boilerplate. It turns one GitHub REST call into a Markdown table and places it between markers in an existing file. The design follows three goals:

1. **Pure core, I/O at the edges.** Argument validation, response parsing, rendering and marker handling are pure functions, so most requirements can be tested without a network or a file system (NFR-4.1).
2. **One process boundary.** Only the CLI entry point touches `process.env`, stdout/stderr and the exit code (NFR-3.3).
3. **Fail before side effects.** Inputs and the target file are validated before the network call, and nothing is written until the new content is fully computed (FR-7, FR-11, NFR-2.1).

## 2. Components

```mermaid
flowchart LR
    subgraph Process boundary
        BIN["bin.ts<br/>(entry, side effects)"]
    end
    subgraph Application
        CLI["cli.ts<br/>runCli()"]
        ARGS["args.ts<br/>parseCliArgs()"]
        CFG["config.ts<br/>readConfig()"]
        SYNC["sync.ts<br/>syncDocs()"]
        ERR["errors.ts<br/>error classes + exit codes"]
    end
    subgraph Pure core
        META["repo-metadata.ts<br/>parseRepoMetadata()"]
        REND["render.ts<br/>renderSection()"]
        MARK["markers.ts<br/>locate / replace / normalize"]
    end
    subgraph Adapters
        GH["github-client.ts<br/>fetchRepository()"]
        FILE["target-file.ts<br/>readTarget() / writeAtomic()"]
    end
    API[("api.github.com")]
    FS[("Target .md file")]

    BIN --> CLI
    CLI --> ARGS
    CLI --> CFG
    CLI --> SYNC
    CLI --> ERR
    SYNC --> FILE
    SYNC --> MARK
    SYNC --> GH
    SYNC --> REND
    GH --> META
    GH --> API
    FILE --> FS
```

All modules live in `src/doc-sync/`.

| Module              | Responsibility                                                                                                                                                                                                              | Requirements                | Side effects                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------- |
| `bin.ts`            | The only module with top-level code. Calls `runCli(process.argv.slice(2), process.env, …)` and sets `process.exitCode`, with a last-resort rejection handler that sets exit `3` (DR-12). It is intentionally tiny and excluded from coverage | NFR-3.3                     | **Yes, intentional**: reads argv/env, sets the exit code          |
| `cli.ts`            | Composition root. Wires in the real dependencies, calls `syncDocs`, turns the `SyncResult` or an error into stdout/stderr lines and an `ExitCode`, and prints usage. Messages show `--out` exactly as the user gave it (DR-13) | FR-1, FR-9, FR-10, NFR-2.3  | Writes only to the injected `stdout`/`stderr` streams           |
| `args.ts`           | Wraps `util.parseArgs` (`strict: true`), validates `--repo` (FR-2), rejects an absolute `--out`, and lexically checks `isInside(cwd, path.resolve(cwd, out))` (DR-5) | FR-1, FR-2, NFR-1.4         | None (pure; `cwd` is passed in)                                  |
| `config.ts`         | Central env validation: `readConfig(env)` returns `{ token?: string }`. Trims the value and treats an empty one as absent; rejects a token containing whitespace or control characters (header-injection guard), using a fixed message that never echoes the value (DR-10) | FR-3, NFR-1.1, NFR-3.3      | None (env object is passed in)                                   |
| `github-client.ts`  | `fetchRepository(ref, deps)` builds the URL from the fixed base `https://api.github.com` with `encodeURIComponent` segments, sets the headers and `AbortSignal.timeout(10_000)`, maps status codes to `GitHubApiError` (unmatched statuses become `unexpected-status`, DR-3), asserts the final `response.url` origin is `https://api.github.com` (DR-2), and passes the JSON to `parseRepoMetadata` | FR-3, FR-11, NFR-1.1, NFR-1.5, NFR-2.2 | Network, through the injected `fetch` |
| `repo-metadata.ts`  | `parseRepoMetadata(json: unknown)` narrows the body with type guards into `RepoMetadata` and maps "missing" values (`null`, `""`, whitespace, `[]`) to `null`. A body that is not an object, or that lacks `name`/`full_name`/`html_url`, is reported as malformed. `created_at` is kept only if `Date.parse` succeeds; otherwise it is `null` (DR-8) | FR-4, FR-5, FR-6, FR-11 | None (pure) |
| `render.ts`         | `renderSection(meta, { now, eol })` produces the timestamp line plus the table in a fixed row order. Every API string goes through `escapeMarkdownText`, which collapses whitespace, HTML-encodes `& < >` and backslash-escapes ``\ ` * _ [ ] \| ~ #`` (DR-1). Links are built only for `http(s)` URLs, using a percent-encoded `href` and escaped text. Inline code is used only when the value contains no backtick (DR-7). Missing values render as `Not Found` | FR-4, FR-5, FR-8, NFR-1.2, NFR-1.3, NFR-2.4 | None (pure; the clock is passed in) |
| `markers.ts`        | `locateSection(content)` scans line by line, **ignoring fenced code blocks** (DR-4), and finds exactly one start-marker line followed by exactly one end-marker line, or throws a `TargetFileError`. `replaceSection` splices in a new body. `normalizeForCompare` drops the `_Last synced:_` line and normalizes EOLs. `detectEol` returns CRLF or LF | FR-7, FR-10, A2 | None (pure) |
| `target-file.ts`    | `readTarget(path, fs)` checks `isInside(realpath(cwd), realpath(target))` (DR-5), checks the target is a regular file, and returns `{ realPath, content, mode }`. `writeAtomic(realPath, content, mode, fs)` writes `.<basename>.doc-sync-<randomUUID>.tmp` in the same directory, applies the original `mode`, renames it over the **real** path so symlinks are preserved, and removes the temp file if anything fails (DR-6) | FR-7, NFR-1.4, NFR-2.1 | File system, through the injected `fs` |
| `sync.ts`           | `syncDocs(options, deps)` orchestrates the run: read, locate, fetch, render, compare, then write or skip. Returns a `SyncResult`                                                                                              | FR-6–FR-10, A2              | Only through the injected adapters                              |
| `errors.ts`         | `DocSyncError` (abstract) and its subclasses `UsageError`, `GitHubApiError`, `TargetFileError`, each with a typed `reason` and an optional `cause`; `exitCodeFor(error)`                                                     | FR-11, NFR-2.3, NFR-3.3     | None                                                            |

## 3. Data Flow

```mermaid
sequenceDiagram
    autonumber
    participant B as bin.ts
    participant C as cli.ts
    participant A as args/config
    participant S as sync.ts
    participant F as target-file
    participant M as markers
    participant G as github-client
    participant R as render

    B->>C: runCli(argv, env, io, deps)
    C->>A: parseCliArgs(argv, cwd) / readConfig(env)
    A-->>C: CliOptions + Config  (or UsageError → exit 2)
    C->>S: syncDocs(options, deps)
    S->>F: readTarget(outPath)
    F-->>S: content  (or TargetFileError → exit 3)
    S->>M: locateSection(content)
    M-->>S: { start, end, body }  (or TargetFileError → exit 3)
    Note over S,G: No network call until the file is known to be valid
    S->>G: fetchRepository(repo, { fetch, token })
    G-->>S: RepoMetadata  (or GitHubApiError → exit 3)
    S->>R: renderSection(meta, { now, eol })
    R-->>S: newBody
    S->>M: normalizeForCompare(body) vs normalizeForCompare(newBody)
    alt --check
        S-->>C: up-to-date (exit 0) | out-of-date (exit 1)
    else write mode, content unchanged (A2)
        S-->>C: unchanged (exit 0, no write)
    else write mode, content changed
        S->>F: writeAtomic(outPath, replaceSection(...))
        S-->>C: updated (exit 0)
    end
    C-->>B: ExitCode
```

### Marked section format

Markers are only recognized when they sit on their own line; surrounding whitespace is allowed. Marker lines **inside fenced code blocks** (```` ``` ```` or `~~~`, indented 0–3 spaces) are ignored, so a document can show the markers as an example (DR-4). A UTF-8 BOM, a missing trailing newline, and the file's EOL style are preserved (DR-11). Everything between the two marker lines belongs to the tool:

```markdown
<!-- doc-sync:start -->
_Last synced: 2026-10-13T09:30:00Z_

| Field          | Value                                       |
| -------------- | ------------------------------------------- |
| Name           | node-typescript-boilerplate                 |
| Full Name      | jsynowiec/node-typescript-boilerplate       |
| Description    | Minimalistic project template to jump …     |
| URL            | [github.com/jsynowiec/…](https://github.com/jsynowiec/node-typescript-boilerplate) |
| Default Branch | `main`                                      |
| License        | Apache License 2.0 (Apache-2.0)             |
| Topics         | `boilerplate`, `nodejs`, `typescript`       |
| Homepage       | Not Found                                   |
| Created        | 2017-03-02                                  |
<!-- doc-sync:end -->
```

The table is not column-padded. Each row is `| Field | Value |`, which keeps the output deterministic and keeps diffs small (NFR-2.4).

## 4. Key Types (sketch)

```ts
export interface RepoRef {
  readonly owner: string;
  readonly name: string;
}

export interface CliOptions {
  readonly repo: RepoRef;
  readonly outPath: string; // absolute, lexically inside cwd
  readonly check: boolean;
}

export interface RepoMetadata {
  readonly name: string;
  readonly fullName: string;
  readonly htmlUrl: string;
  readonly description: string | null;
  readonly defaultBranch: string | null;
  readonly license: { readonly name: string; readonly spdxId: string | null } | null;
  readonly topics: ReadonlyArray<string>; // empty → "Not Found"
  readonly homepage: string | null;
  readonly createdAt: string | null; // ISO string from API, null if unparseable (DR-8)
}

export type SyncResult =
  | { readonly kind: 'updated' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'up-to-date' }
  | { readonly kind: 'out-of-date' };

export type GitHubApiErrorReason =
  | 'not-found' | 'unauthorized' | 'rate-limited' | 'forbidden'
  | 'server-error' | 'unexpected-status' | 'network' | 'timeout'
  | 'malformed-response'; // includes a response from an unexpected origin (DR-2)

export type TargetFileErrorReason =
  | 'not-found' | 'not-a-file' | 'outside-cwd' | 'read-failed'
  | 'missing-start-marker' | 'missing-end-marker' | 'markers-out-of-order'
  | 'duplicate-markers' | 'write-failed';

// Narrow injectable seams (NFR-4.1)
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export interface FileSystemLike {
  readFile(path: string, enc: 'utf8'): Promise<string>;
  writeFile(path: string, data: string, opts: { encoding: 'utf8'; mode: number }): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, opts: { force: true }): Promise<void>;
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<{ isFile(): boolean; readonly mode: number }>;
}
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
```

`switch` statements over `SyncResult['kind']` and over each `reason` union use `never` checks, so adding a case is a compile error until every switch handles it.

## 5. Error Model and Exit Codes

| Error                                                       | Raised by                              | Exit                    |
| ----------------------------------------------------------- | -------------------------------------- | ----------------------- |
| `UsageError` (bad/missing/unknown flags, invalid repo, `--out` outside cwd, bad token format) | `args.ts`, `config.ts` | `2` |
| `TargetFileError` (any reason)                              | `target-file.ts`, `markers.ts`         | `3`                     |
| `GitHubApiError` (any reason)                               | `github-client.ts`, `repo-metadata.ts` | `3`                     |
| Anything else (bug)                                         | –                                      | `3`, with a generic message |
| `SyncResult` `out-of-date`                                  | `sync.ts`                              | `1`                     |
| `updated` / `unchanged` / `up-to-date` / `--help`           | –                                      | `0`                     |

**Secret safety (NFR-1.1).** Error messages are built from fixed templates plus the status code, the repo ref and reset times. Response bodies and request headers are never included. `cli.ts` prints only `error.message`, never `cause` or stacks. As defense in depth, it also redacts any occurrence of the token from its output before writing.

**Status mapping (DR-3).** The order is: `401`, then `404`, then rate-limited (below), then other `403`, then `5xx`, then any other non-2xx as `unexpected-status`. A `2xx` response whose final URL is not on `https://api.github.com` is `malformed-response` (DR-2).

**Token-format error (DR-10).** The message is fixed: `GITHUB_TOKEN contains whitespace or control characters`.

**Rate limit detection.** A response counts as rate-limited when the status is `429`, or the status is `403` and either `x-ratelimit-remaining: 0` or a `retry-after` header is present. If `x-ratelimit-reset` exists, it is shown as an ISO time.

## 6. Technology Choices

| Concern         | Choice                                    | Alternatives considered                    | Why                                                                                     |
| --------------- | ----------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| HTTP            | Global `fetch` (Node 24) + `AbortSignal.timeout` | `@octokit/rest`, `undici`, `axios`  | One endpoint does not justify a dependency (NFR-3.1); `fetch` is easy to inject          |
| Arg parsing     | `node:util` `parseArgs` (`strict: true`)  | `commander`, `yargs`                       | Built in; strict mode already rejects unknown flags (FR-1)                               |
| File I/O        | `node:fs/promises` + temp-file `rename`   | `write-file-atomic`                        | Same atomicity guarantee without a dependency                                           |
| Rendering       | String building in `render.ts`            | Handlebars or other template engines       | 9 fixed rows; a template engine adds a dependency and an injection surface              |
| Clock           | Injected `now: () => Date`                | `vi.setSystemTime` only                    | Deterministic tests without global fake timers                                          |
| Validation      | Hand-written type guards                  | `zod`                                      | The schema is small; no dependency needed                                               |

## 7. Testing Strategy

| Level       | Location                                     | What                                                                                                                                                       | Fakes                                                       |
| ----------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Unit        | `__tests__/unit/doc-sync/<module>.test.ts`   | One file per pure module: args, config, repo-metadata, render, markers, errors; github-client with a fake `fetch`; sync with a fake `fs` and `fetch`       | `fetch` returns `new Response(...)`; in-memory `fs` object  |
| Integration | `__tests__/integration/doc-sync.test.ts`     | `runCli` end to end with the **real** file system in an `fs.mkdtemp` directory and a fake `fetch`. Asserts exit codes, stdout/stderr, file bytes (including CRLF), that a failure leaves the file untouched, and that the token never appears in any output | Only `fetch` and `now`                                      |
| Manual smoke (Step 7) | –                                  | A real run against a public repo, for the content-quality check of the generated document                                                                  | None                                                        |

No test makes a real network call. The integration tests clean up their temp directories in `afterEach`.

**Required edge cases (DR-11):**
- a BOM before the start marker;
- no trailing newline;
- an empty section on the first run;
- CRLF line endings;
- a marker line with trailing spaces (recognized);
- a marker line followed by text (not recognized);
- markers inside a fenced code block (ignored).

**Required security cases (DR-1, DR-2, DR-7, DR-10):**
- hostile description values (`<!-- doc-sync:end -->`, `<script>`, `[x](javascript:…)`, `|`, newlines);
- a `javascript:` homepage;
- a URL containing `(`, `)` or spaces;
- a branch name containing a backtick;
- a redirect to a foreign origin;
- the token never appearing in stdout or stderr on any path.

**Coverage target (DR-9):** ≥ 90 % lines and branches for `src/doc-sync/**` (excluding `bin.ts`), measured with `test:coverage:all` in Step 7. Not enforced as a threshold.

## 8. File Layout and Build/CI Changes

```text
src/doc-sync/
  bin.ts  cli.ts  args.ts  config.ts  errors.ts
  github-client.ts  repo-metadata.ts
  render.ts  markers.ts  target-file.ts  sync.ts
__tests__/unit/doc-sync/*.test.ts
__tests__/integration/doc-sync.test.ts
```

Proposed changes:

1. **`package.json` scripts**
   - `"doc-sync": "node build/doc-sync/bin.js"`. The current `tsconfig.json` has `rootDir: src` and `outDir: build`, so `src/doc-sync/bin.ts` compiles to `build/doc-sync/bin.js`.
   - `"test:integration": "vitest run integration --config __tests__/vitest.config.ts"`. The existing `test` script filters on `unit`, so integration tests would not otherwise run.
   - `"test:coverage:all": "vitest run --config __tests__/vitest.config.ts --coverage.enabled --coverage.all"` (DR-9).
2. **`.github/workflows/nodejs.yml`**: add `npm run test:integration` to the `tests` job.
3. **`__tests__/vitest.config.ts`**: exclude `src/doc-sync/bin.ts` from coverage.
4. **`README.md`**: add a short "doc-sync" usage section. Because of DR-4, it can show the markers inside a code fence.
5. **`docs/PROJECT_INFO.md`** (new): the sample target with the markers, used for the Step 7 content check (R7).
6. No changes to `tsconfig*.json`, ESLint or Prettier config. No new dependencies.

> Observation, out of scope: the existing `"start": "node build/src/main.js"` does not match `rootDir: src` (which outputs `build/main.js`). It is not touched; the design review deferred it (F16).

## 9. Requirement Traceability

| Requirement | Component(s)                                     |
| ----------- | ------------------------------------------------ |
| FR-1        | `args.ts`, `cli.ts`                              |
| FR-2        | `args.ts`                                        |
| FR-3        | `github-client.ts`, `config.ts`                  |
| FR-4        | `repo-metadata.ts`, `render.ts`                  |
| FR-5        | `repo-metadata.ts`, `render.ts`                  |
| FR-6        | `repo-metadata.ts`, `sync.ts`                    |
| FR-7        | `markers.ts`, `target-file.ts`                   |
| FR-8        | `render.ts`                                      |
| FR-9        | `sync.ts`, `cli.ts`                              |
| FR-10       | `sync.ts`, `markers.ts`, `cli.ts`                |
| FR-11       | `github-client.ts`, `errors.ts`, `cli.ts`        |
| NFR-1       | `config.ts`, `render.ts`, `args.ts`, `target-file.ts`, `github-client.ts`, `cli.ts` |
| NFR-2       | `target-file.ts`, `github-client.ts`, `errors.ts`, `render.ts` |
| NFR-3       | all; `bin.ts` is the only side-effect module     |
| NFR-4       | `SyncDeps` seams; test strategy (§7)             |

## 10. Risks and Open Questions

Dispositions are taken from the [design review](design-review.md).

| #   | Item                                                                                          | Disposition                                                                                        |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| R1  | Unauthenticated rate limit (60 req/h) on shared CI runners                                    | Mitigated: clear `rate-limited` message suggesting `GITHUB_TOKEN`                                   |
| R2  | GitHub response shape changes                                                                 | Mitigated: type guards; only `name`/`full_name`/`html_url` are required, everything else degrades to `Not Found` |
| R3  | Race between reading and writing (the file is edited while the tool runs)                     | Accepted (F15)                                                                                     |
| R4  | `rename` over an open file on Windows can fail with `EPERM`                                   | Accepted (F15): surfaces as `write-failed`                                                         |
| R5  | A symlinked `--out` that points outside the cwd                                               | Mitigated: DR-5 (`realpath` of both the cwd and the target)                                        |
| R6  | Redirects for renamed repos                                                                   | Mitigated: DR-2 (follow redirects, then assert the final origin)                                   |
| R7  | Sample target for the Step 7 content check                                                    | Decided: new `docs/PROJECT_INFO.md`                                                                |

## 11. Change Log

| Date       | Change                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-13 | Initial architecture approved (Step 2)                                                                                                       |
| 2026-10-13 | Design review applied (Step 3): DR-1 escaping, DR-2 origin check, DR-3 `unexpected-status`, DR-4 fence-aware markers, DR-5 containment, DR-6 write safety, DR-7 links/code spans, DR-8 dates, DR-9 coverage script, DR-10 token message, DR-11 edge-case tests, DR-12 bin handler, DR-13 relative path; R1–R7 dispositions |
