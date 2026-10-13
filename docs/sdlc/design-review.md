# Design Review: Automated Documentation Sync (`doc-sync`)

> SDLC Step 3 · Reviewed: [architecture.md](architecture.md) against [requirements.md](requirements.md) · Status: **Agreed (2026-10-13)** — DR-4 option (a) chosen

## 1. Verdict

**Approve with changes.** The structure is sound: the core is pure, there is a single process boundary, the tool fails before side effects, and it adds no dependencies. Every FR and NFR maps to a component. However, the review found **2 High** and **6 Medium** gaps. Most are in output sanitization, path/redirect safety and unmapped HTTP statuses, and each would otherwise surface as a security or correctness bug during implementation. All of them are fixable at design level without changing the component structure.

## 2. Findings

| ID   | Lens            | Sev    | Finding                                                                                                                                                                                                                                                                 | Proposed decision | Arch § |
| ---- | --------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| F1   | Security        | High   | NFR-1.2 only escapes `\|`, newlines and `<!--`/`-->`. API text such as the description is user-controlled on GitHub, so Markdown like `[x](javascript:…)`, `<img onerror>`, or `*`/`_`/backtick runs can still inject links, HTML or formatting into the rendered doc  | DR-1              | 2, 3   |
| F2   | Security        | High   | `fetch` follows redirects by default (R6). The design never checks where the response finally came from, so NFR-1.5 ("token sent only to api.github.com") relies on undici's internal behavior rather than being enforced                                                  | DR-2              | 2, 5   |
| F3   | Error handling  | Medium | FR-11 and the `GitHubApiErrorReason` union do not cover other `4xx` statuses (e.g. `410`, `422`, `451`) or unexpected `3xx`/`1xx`. Their behavior is undefined                                                                                                              | DR-3              | 4, 5   |
| F4   | Edge cases      | Medium | Marker detection is line-based but not fence-aware. A README that **documents** the markers inside a code block (as this repo's README will, per §8.4) triggers `duplicate-markers`, which makes the tool unusable on its own README                                       | DR-4 (user decision) | 3    |
| F5   | Security        | Medium | The cwd containment check compares `realpath(target)` with the **lexical** cwd. If the cwd itself contains a symlink, valid files are rejected; on Windows, case differences can mis-compare. A plain `startsWith` check also accepts `/repo-evil` for cwd `/repo`          | DR-5              | 2      |
| F6   | Data integrity  | Medium | `writeAtomic` with a temp file + `rename` (a) replaces a symlinked target with a regular file, (b) drops the original file mode, and (c) leaves the temp name format unspecified, so collisions are possible                                                                 | DR-6              | 2      |
| F7   | Security        | Medium | Links: `html_url` and `homepage` can contain `(`, `)` or spaces, which break `[text](url)` syntax, and nothing escapes the link text. Inline-code fields (branch) can contain backticks, which break the code span                                                          | DR-7              | 2, 3   |
| F8   | Data integrity  | Medium | `created_at` is assumed to be valid ISO. If it is not, `toISOString()` throws `RangeError`, an unhandled bug path (exit 3 with a generic message) rather than `Not Found`                                                                                                     | DR-8              | 2      |
| F9   | Testability     | Low    | `test:coverage` runs only `unit`, so integration coverage is invisible. No coverage target is stated                                                                                                                                                                       | DR-9              | 7, 8   |
| F10  | Security        | Low    | `UsageError` for a malformed token must not echo the token. The architecture says "bad token format" without saying what the message contains                                                                                                                              | DR-10             | 2, 5   |
| F11  | Edge cases      | Low    | A UTF-8 BOM, a missing trailing newline, and an empty section between the markers (first run) are not called out. They are handled implicitly, but need explicit tests                                                                                                    | DR-11             | 3, 7   |
| F12  | Simplicity      | Info   | `bin.ts` should not need a `try/catch`, because `runCli` never rejects. A last-resort `.catch` is still cheap insurance against a bug becoming an unhandled rejection                                                                                                      | DR-12             | 2      |
| F13  | Requirements    | Info   | The `stdout` summary should echo `--out` **as given** (relative), not the resolved absolute path, to avoid leaking local directory layout into CI logs                                                                                                                    | DR-13             | 2      |
| F14  | Edge cases      | Info   | Repeated flags (`--out a --out b`): `parseArgs` silently takes the last value                                                                                                                                                                                             | Accepted (§4)     | –      |
| F15  | Data integrity  | Info   | R3 (read/write race) and R4 (Windows `EPERM` on rename)                                                                                                                                                                                                                    | Accepted (§4)     | 10     |
| F16  | Fit             | Info   | The existing `start` script path mismatch (`build/src/main.js` vs `build/main.js`)                                                                                                                                                                                         | Deferred (§4)     | 8      |
| F17  | Coverage        | Info   | Every FR/NFR traces to a component (§9); no contradictions found between the requirements and the architecture                                                                                                                                                             | No action         | 9      |

## 3. Agreed Design Decisions

- **DR-1 (F1) Markdown/HTML-safe cell escaping.** `render.ts` gets one `escapeMarkdownText(value)` function, applied to **every** API-sourced string before any formatting. It:
  1. collapses `\r`, `\n` and tabs (any whitespace run) to a single space and trims;
  2. replaces `&` with `&amp;`, `<` with `&lt;` and `>` with `&gt;`, which also neutralizes `<!--`/`-->` and raw HTML;
  3. backslash-escapes ``\ ` * _ [ ] | ~ #``.

  This supersedes the narrower rule in NFR-1.2. The requirement's intent is unchanged and its scope widens.
- **DR-2 (F2) Enforce the API origin.** Requests use `redirect: 'follow'` so renamed repos keep working. After the response arrives, `github-client.ts` asserts `new URL(response.url).origin === 'https://api.github.com'`; anything else is a `malformed-response` error. The `Authorization` header is set only when a token is present, and only on the request built from the constant base URL.
- **DR-3 (F3) Catch-all status reason.** Add the `unexpected-status` reason to `GitHubApiErrorReason`. Every non-2xx status not matched by FR-11 maps to it with the message `GitHub API returned unexpected status <code>` and exit `3`. The status-mapping `switch` stays exhaustive.
- **DR-4 (F4) Fence-aware marker scanning** *(user decision: option (a) agreed)*. `markers.ts` ignores marker lines inside fenced code blocks. A fence is a line starting with up to 3 spaces followed by at least 3 backticks or at least 3 tildes; it closes on a line with the same fence character repeated at least as many times. Indented (4-space) code blocks are **not** treated specially, which keeps the rule small. *Alternative:* keep naive line matching, and document that README examples must not contain literal marker lines.
- **DR-5 (F5) Robust containment check.** Containment is defined as `isInside(root, p)`: `rel = path.relative(root, p)`, and the path is inside when `rel !== ''`, `!rel.startsWith('..')` and `!path.isAbsolute(rel)`. `args.ts` applies it lexically to `path.resolve(cwd, out)`. `target-file.ts` applies it again to `realpath(target)` against **`realpath(cwd)`**. `path.relative` handles case-insensitivity on Windows, and a different drive yields an absolute `rel`, which is rejected.
- **DR-6 (F6) Write safety.**
  - (a) `writeAtomic` operates on the **real path** returned by `readTarget`, so a symlink inside the cwd is preserved and its target is updated.
  - (b) It reads `stat(real).mode` and applies it to the temp file before the `rename` (`writeFile(..., { mode })` and then `chmod`). On Windows `chmod` is close to a no-op, which is acceptable.
  - (c) The temp name is `.<basename>.doc-sync-<crypto.randomUUID()>.tmp` in the same directory.

  `FileSystemLike` gains `chmod`, and `stat` returns `{ isFile(): boolean; mode: number }`.
- **DR-7 (F7) Safe links and code spans.**
  - Link targets are `new URL(value).href` with `(`, `)` and spaces percent-encoded, and only when the protocol is `http:`/`https:`. Otherwise the value renders as escaped text per DR-1.
  - Link text is the escaped URL without its scheme.
  - Inline code is used only when the value contains no backtick. Otherwise it falls back to escaped plain text.
  - GitHub topics are already restricted to `[a-z0-9-]`, but they go through the same function.
- **DR-8 (F8) Defensive date parsing.** `repo-metadata.ts` keeps `createdAt` only when `!Number.isNaN(Date.parse(value))`, and otherwise sets it to `null` (rendered as `Not Found`). `render.ts` slices the UTC ISO date from a `Date` it has already validated.
- **DR-9 (F9) Coverage.** Add `"test:coverage:all": "vitest run --config __tests__/vitest.config.ts --coverage.enabled --coverage.all"` to run unit and integration tests together. The **target** is ≥ 90 % line and branch coverage for `src/doc-sync/**`, excluding `bin.ts`. It is measured in Step 7 and not enforced as a CI threshold (that would be a config change beyond scope).
- **DR-10 (F10) Token-free messages.** The token-format `UsageError` message is fixed: `GITHUB_TOKEN contains whitespace or control characters`. No part of the value is included. The integration test asserts that the token never appears in stdout or stderr for **every** error path, including this one.
- **DR-11 (F11) Explicit edge-case tests.** Tests must cover:
  - a BOM before the start marker, which is preserved;
  - a file without a trailing newline, which is preserved;
  - an empty section on the first run, which is reported as out-of-date in check mode and updated in write mode;
  - a CRLF file, where the output is CRLF;
  - a marker line with trailing spaces, which is still recognized;
  - a marker line followed by other text, which is not recognized.
- **DR-12 (F12) Last-resort handler.** `bin.ts`: `runCli(...).then(code => { process.exitCode = code; }, () => { process.exitCode = 3; })`. The handler is not logged with the error object, to avoid printing causes.
- **DR-13 (F13) Relative path in output.** The summary and error messages use the `--out` value as given by the user, not the resolved path.

## 4. Accepted / Deferred

| Item      | Disposition | Reason                                                                                                                                                                              |
| --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F14       | Accepted    | `parseArgs` last-wins is conventional CLI behavior; rejecting duplicates adds code for no stated requirement                                                                          |
| F15 / R3  | Accepted    | A short-lived process with an atomic rename. A concurrent edit is an operator error, and the worst case is that the other edit is overwritten, never a corrupt file                    |
| F15 / R4  | Accepted    | It surfaces as `write-failed` (exit 3) with the path. Retries are out of scope by the requirements                                                                                    |
| F16       | Deferred    | Pre-existing and unrelated to doc-sync; AGENTS.md says to make minimal, targeted changes. Can be raised as a separate issue                                                           |
| R7        | Decided     | Use a new **`docs/PROJECT_INFO.md`** containing the markers as the Step 7 sample target. This avoids rewriting the upstream README content, and with DR-4 the README can still document the markers safely |

## 5. Changes Applied to architecture.md

The changes are recorded in the architecture's change log (§11): DR-1 to DR-13 are reflected in the §2 component table, the §3 section format notes, the §4 types, the §5 error model, §7 testing, §8 scripts, and the §10 risk dispositions.
