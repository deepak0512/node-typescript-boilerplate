# Requirements: Automated Documentation Sync (`doc-sync`)

> SDLC Step 1 · Source story: [user-story.md](user-story.md) · Status: **Approved (2026-10-13), amended by [design review](design-review.md) (DR-1, DR-3) and [code review](code-review.md) (CR-1)**

## 1. Overview

`doc-sync` is a Node.js/TypeScript command-line tool. It fetches core metadata for one GitHub repository from the GitHub REST API and renders it as a Markdown table. The table goes inside a marked section of an existing Markdown file, and everything outside the markers is left alone. A `--check` mode lets CI fail when the documented metadata no longer matches GitHub. The tool lives in this repository and follows its toolchain and `AGENTS.md` rules.

## 2. Clarifications Log

| #   | Question                         | Answer                                                                                                                                          | Decided by |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Q1  | Where is output written?         | Only inside a marked section (`<!-- doc-sync:start -->` … `<!-- doc-sync:end -->`) of an existing file                                           | User       |
| Q2  | Which fields?                    | Core repo info only: name, full name, description, URL, default branch, license, topics, homepage, created date                                 | User       |
| Q3  | Authentication?                  | Optional `GITHUB_TOKEN` env var; unauthenticated access is allowed for public repos                                                             | User       |
| Q4  | Invocation?                      | CLI with `--repo` and `--out`, plus a `--check` mode for CI                                                                                     | User       |
| Q5  | File is missing, or markers are missing? | Fail with a clear error; never create or modify a file that does not contain the markers                                                | User       |
| Q6  | Timestamp?                       | Include a "Last synced" timestamp. `--check` therefore ignores the timestamp line                                                               | User       |
| Q7  | Hosts?                           | github.com only (`https://api.github.com`)                                                                                                      | User       |
| Q8  | Format?                          | Two-column Markdown table (`Field` / `Value`) in a fixed field order                                                                            | User       |

## 3. Functional Requirements

### FR-1 CLI arguments

The tool MUST accept `--repo <owner/repo>` (required), `--out <path>` (required), `--check` (optional flag) and `--help`.

- **Given** `--repo` or `--out` is missing, **when** the tool runs, **then** it prints usage to stderr and exits with code `2`.
- **Given** an unknown flag, **when** the tool runs, **then** it prints usage to stderr and exits with code `2`.
- **Given** `--help`, **when** the tool runs, **then** it prints usage to stdout and exits with code `0`.

### FR-2 Repository identifier validation

`--repo` MUST match `owner/repo`. The owner must be 1–39 characters of letters, digits and hyphens, and must not start with a hyphen. The repo name must be 1–100 characters of letters, digits, `.`, `_` and `-`, and must not be `.` or `..`.

- **Given** `--repo "foo"`, `"foo/bar/baz"`, `"../x"` or `"foo/.."`, **when** the tool runs, **then** it exits with code `2`, prints a validation message, and makes no network call.

### FR-3 Fetch repository metadata

The tool MUST fetch `GET https://api.github.com/repos/{owner}/{repo}` and send the `Accept: application/vnd.github+json`, `X-GitHub-Api-Version` and `User-Agent` headers.

- **Given** a valid public repository, **when** the tool runs, **then** it retrieves the metadata needed for FR-4.

### FR-4 Rendered fields

The generated table MUST contain exactly these rows, in this order:

| Field          | Source (API)                    | Rendering                                                        |
| -------------- | ------------------------------- | ---------------------------------------------------------------- |
| Name           | `name`                          | plain text                                                       |
| Full Name      | `full_name`                     | plain text                                                       |
| Description    | `description`                   | plain text                                                       |
| URL            | `html_url`                      | Markdown link                                                    |
| Default Branch | `default_branch`                | inline code                                                      |
| License        | `license.name` (+ `spdx_id`)    | e.g. `Apache License 2.0 (Apache-2.0)`                           |
| Topics         | `topics[]`                      | comma-separated inline code, alphabetical order                  |
| Homepage       | `homepage`                      | Markdown link                                                    |
| Created        | `created_at`                    | date only, `YYYY-MM-DD` (UTC)                                    |

### FR-5 "Not Found" for missing fields

- **Given** a field that is `null`, absent, an empty string, an empty array, or whitespace only (for example no license, no description, no topics, or no homepage), **when** the table is rendered, **then** the value MUST be the literal `Not Found` and the tool MUST still succeed.
- **Given** the license is GitHub's placeholder `NOASSERTION` with name `Other`, **when** it is rendered, **then** the value is `Other`.

### FR-6 Empty repositories

- **Given** a repository with no commits, **when** the tool runs, **then** it MUST succeed and render every field it can. Fields that are unavailable show `Not Found`.

### FR-7 Marked-section update

The tool MUST replace only the content between the first `<!-- doc-sync:start -->` line and the next `<!-- doc-sync:end -->` line. The markers themselves and all content outside them MUST be preserved byte-for-byte, including the file's line endings (LF or CRLF).

- **Given** a file that does not exist, **when** the tool runs, **then** it exits with code `3` and an error that names the path.
- **Given** a file that has no start marker, no end marker, the markers in the wrong order, or more than one start or end marker, **when** the tool runs, **then** it exits with code `3`, explains how to add the markers, and leaves the file unchanged.

### FR-8 Sync timestamp

The generated section MUST start with the line `_Last synced: <ISO-8601 UTC timestamp, second precision>_`, for example `_Last synced: 2026-10-13T09:30:00Z_`.

### FR-9 Write mode (default)

- **Given** valid input and a successful API response, **when** the tool runs without `--check`, **then** it rewrites the marked section, prints a one-line summary to stdout (for example `Updated README.md from owner/repo`), and exits with code `0`.

### FR-10 Check mode

- **Given** `--check`, **when** the section content matches what would be generated, ignoring the `Last synced` line, **then** the tool exits with code `0` and writes nothing.
- **Given** `--check` and differing content, **when** the tool runs, **then** it exits with code `1`, prints a message saying the doc is out of date, and writes nothing.

### FR-11 API error handling

The tool MUST map failures to clear messages, exit with code `3`, and leave the target file unchanged:

| Condition                                                           | Message intent                                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `404`                                                               | Repository not found, or not accessible with the current credentials   |
| `401`                                                               | Token is invalid or expired                                            |
| `403`/`429` with `x-ratelimit-remaining: 0` or a `retry-after` header | Rate limit exceeded; include the reset time if known; suggest `GITHUB_TOKEN` |
| other `403`                                                         | Access forbidden                                                       |
| `5xx`                                                               | GitHub API unavailable, including the status code                      |
| any other non-2xx status (e.g. `410`, `422`, `451`) | Unexpected status, including the status code *(design review DR-3)* |
| network error / timeout                                             | Could not reach the GitHub API                                         |
| `2xx` with a malformed or unexpected body                           | Unexpected API response                                                |

## 4. Non-Functional Requirements

### NFR-1 Security

- **NFR-1.1** The token MUST NOT appear in stdout, stderr, the output file, or error messages, including messages wrapped as error causes.
- **NFR-1.2** API-sourced values MUST be sanitized before rendering, so that data cannot break the table, inject or close markers, or inject HTML, links or formatting. Collapse whitespace (including newlines) to single spaces, HTML-encode `&`, `<` and `>`, and backslash-escape the Markdown punctuation ``\ ` * _ [ ] | ~ #``. *(Widened by design review DR-1.)* Bare URLs, `www.` hosts and e-mail addresses in API text MAY still be auto-linked by GFM renderers: the visible text is the URL itself, so the link is not deceptive *(accepted in code review CR-1)*.
- **NFR-1.3** Rendered links MUST use only `http:`/`https:` URLs. Any other scheme (for example `javascript:`) renders as plain escaped text, not as a link.
- **NFR-1.4** `--out` MUST resolve to a regular file inside the current working directory. Paths outside it, including paths that escape through `..` or absolute paths, are rejected with exit code `2`.
- **NFR-1.5** The token is sent only to `https://api.github.com`.

### NFR-2 Reliability

- **NFR-2.1** The file is written atomically (write a temporary file in the same directory, then rename), so a crash never leaves it half-written.
- **NFR-2.2** HTTP requests time out after 10 s.
- **NFR-2.3** Exit codes are fixed: `0` success / up to date, `1` check found drift, `2` usage or validation error, `3` runtime error (API or file system).
- **NFR-2.4** Apart from the timestamp line, the output is deterministic: the same API data always produces identical bytes.

### NFR-3 Maintainability and compatibility

- **NFR-3.1** No new runtime dependencies. Use Node built-ins (`fetch`, `node:util` `parseArgs`, `node:fs/promises`).
- **NFR-3.2** Supports Node `>= 24.11 < 25`, as set in `package.json` `engines`.
- **NFR-3.3** Follows `AGENTS.md`: strict TypeScript, no `any`, named exports, errors keep their `cause`, no logging in library modules (only the CLI entry point writes to stdout/stderr), and environment variables are read at runtime in one place.
- **NFR-3.4** Typecheck, lint, Prettier and the Vitest suite all pass in the existing CI workflow.

### NFR-4 Testability

- **NFR-4.1** The HTTP client, clock and file system can be injected so that tests make no real network calls and run deterministically.
- **NFR-4.2** Tests cover the happy path, every FR-5 "Not Found" case, every FR-7 marker error, every FR-11 error condition, and the NFR-1 sanitization and secret-leak cases.

## 5. Out of Scope

- Writing to GitHub (commits, PRs, wiki edits). In CI, any commit is left to the workflow author.
- GitHub Enterprise Server or other hosts (GitLab, Bitbucket).
- Activity fields (commits, contributors, issues, stars, forks), languages, and releases.
- Creating the target file or inserting the markers automatically.
- Retries and backoff.
- Publishing as an npm package or `bin`. The tool runs through an npm script.
- A GitHub Actions workflow that runs `doc-sync` itself.

## 6. Assumptions and Open Questions

| #   | Item                                                                                                                                                                             | Status                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| A1  | Exit-code scheme (NFR-2.3) and the `--out` working-directory restriction (NFR-1.4) were proposed by the analyst                                                                  | Confirmed by user            |
| A2  | **In write mode, the file is rewritten (and the timestamp refreshed) only if the content excluding the timestamp has changed.** This stops no-op commits in scheduled CI runs     | Confirmed by user            |
| A3  | The tool is added under `src/` and run with `npm run doc-sync -- --repo … --out …` after a build                                                                                  | Assumed – detailed in Step 2  |
| A4  | The existing boilerplate example (`src/main.ts`, `greeter`) is left as it is                                                                                                       | Assumed                      |

## 7. Traceability

Filled in during the Step 6 code review.

| Requirement | Test(s) |
| ----------- | ------- |
| FR-1 | __tests__/unit/doc-sync/args.test.ts (parseCliArgs, USAGE); __tests__/unit/doc-sync/cli.test.ts (--help, usage errors exit 2) |
| FR-2 | __tests__/unit/doc-sync/args.test.ts (parseRepoRef accepts/rejects); __tests__/unit/doc-sync/cli.test.ts (no fetch on invalid repo) |
| FR-3 | __tests__/unit/doc-sync/github-client.test.ts (request: URL, encoding, headers, token) |
| FR-4 | __tests__/unit/doc-sync/render.test.ts (full table in order); __tests__/unit/doc-sync/repo-metadata.test.ts (full response); __tests__/integration/doc-sync.test.ts (exact file bytes) |
| FR-5 | __tests__/unit/doc-sync/repo-metadata.test.ts (missing optional fields, license, topics); __tests__/unit/doc-sync/render.test.ts (Not Found rows); __tests__/integration/doc-sync.test.ts (empty repository) |
| FR-6 | __tests__/unit/doc-sync/repo-metadata.test.ts (empty repository); __tests__/integration/doc-sync.test.ts (empty repository) |
| FR-7 | __tests__/unit/doc-sync/markers.test.ts (locate/replace, marker errors, fences, BOM/CRLF); __tests__/unit/doc-sync/target-file.test.ts; __tests__/integration/doc-sync.test.ts (missing markers/file, directory) |
| FR-8 | __tests__/unit/doc-sync/render.test.ts (renderTimestamp, section header) |
| FR-9 | __tests__/unit/doc-sync/sync.test.ts (write mode); __tests__/unit/doc-sync/cli.test.ts (Updated message); __tests__/integration/doc-sync.test.ts (writes section, second run not modified) |
| FR-10 | __tests__/unit/doc-sync/sync.test.ts (check mode); __tests__/unit/doc-sync/cli.test.ts (exit 1 / 0); __tests__/integration/doc-sync.test.ts (--check drift and clean) |
| FR-11 | __tests__/unit/doc-sync/github-client.test.ts (failures table, network, timeout, malformed); __tests__/unit/doc-sync/cli.test.ts (runtime errors exit 3); __tests__/integration/doc-sync.test.ts (failures leave file untouched) |
| NFR-1 | __tests__/unit/doc-sync/config.test.ts; __tests__/unit/doc-sync/render.test.ts (hostile data, links); __tests__/unit/doc-sync/github-client.test.ts (token absent, DR-2 origin); __tests__/unit/doc-sync/args.test.ts + __tests__/unit/doc-sync/paths.test.ts (containment); __tests__/unit/doc-sync/target-file.test.ts (outside-cwd); __tests__/unit/doc-sync/cli.test.ts (redaction); __tests__/integration/doc-sync.test.ts (per-run token check, symlink escape) |
| NFR-2 | __tests__/unit/doc-sync/target-file.test.ts (atomic write, cleanup); __tests__/unit/doc-sync/github-client.test.ts (10 s timeout); __tests__/unit/doc-sync/errors.test.ts (exit codes); __tests__/unit/doc-sync/render.test.ts (determinism); __tests__/integration/doc-sync.test.ts (no temp files, file mode) |
| NFR-3 | Verified by lint, check-types, prettier:check, npm ls --depth=0 (no new dependencies) — see code-review.md |
| NFR-4 | __tests__/fixtures/fake-fetch.ts, fake-fs.ts; no test performs network I/O; coverage 99.3 % lines / 98.4 % branches (code-review.md) |
