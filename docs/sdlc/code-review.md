# Code Review: Automated Documentation Sync (`doc-sync`)

> SDLC Step 6 · Scope: `git diff main...feature/doc-sync` · Contracts: [requirements.md](requirements.md), [architecture.md](architecture.md), [design-review.md](design-review.md) · Status: **Fixes applied (2026-10-13)** – see §5

## 1. Verdict

**Approve with fixes.** There are no High or Medium findings. The design decisions (DR-1 to DR-13) are implemented and tested.

The review found:
- **4 Low correctness and hardening defects** (CR-2 to CR-5), each reproduced with a probe against the build;
- **2 places where the docs disagree with the code** (CR-6, CR-7);
- **1 policy question** about bare-URL autolinks (CR-1);
- **4 Nits**, including a documentation note;
- **dependency advisories inherited from `main`** (CR-11, development tooling only).

**How the review was done:** two reviewers worked independently. One was a fresh reviewer agent with no implementation context, which read every changed file and wrote probe scripts against `build/`. The other was the implementer, who ran the checklist and `npm audit`. Every Low finding below was reproduced by both.

## 2. Checklist

| Area              | Result | Evidence |
| ----------------- | ------ | -------- |
| Correctness       | ⚠️ | All FR/NFR trace to code and tests (§5). Deviations: CR-2 (link with a backslash), CR-5 (Created date depends on the machine's time zone for non-`Z` inputs), CR-6/CR-7 (docs disagree with the code) |
| Security          | ✅ / ⚠️ | **Token:** sent only to `https://api.github.com`. Error messages come from fixed templates, and the CLI redacts the token from all output. Tests check every status code, network failures, and every integration run. **Redirects:** checked against the API origin (DR-2); lookalike hosts and `http:` are rejected. **Input checks:** `--repo` is validated before any I/O. `--out` checks are lexical plus `realpath` on both the file and the cwd. HTML, pipes, newlines, markers and `javascript:` are neutralized. **Open:** CR-1 (bare-URL autolinks), CR-4 (non-ASCII token gives a misleading error), CR-9 (invisible format characters) |
| Error Handling    | ⚠️ | **Failure modes:** all FR-11 conditions are mapped. A missing file, missing markers, a directory target and an empty repo all fail or degrade cleanly. **Never-reject:** `runCli` never rejects, and `bin.ts` has a last-resort handler. **Open:** CR-3, where a malformed `x-ratelimit-reset` header escapes as an "unexpected internal error" |
| Test Coverage     | ✅ | **Counts:** 281 tests (267 unit, 14 integration, plus 2 skips that only apply on Windows). **Coverage of `src/doc-sync/**`:** 99.3 % lines, 98.4 % branches (target ≥ 90 %, DR-9). **Paths covered:** the happy path; "Not Found" for each missing field; the empty-repo, NOASSERTION and invalid-date cases; every marker error; every HTTP status class; atomic-write failure paths; and token leakage on every path |
| Code Clarity      | ✅ | Small single-purpose modules; names describe intent (`locateSection`, `normalizeForCompare`, `isInside`); comments explain *why*. There is no `any`, no non-null assertions (`!`), and no type assertions in `src`. All switches over unions are exhaustive |
| DRY Principle     | ✅ | Path containment is shared (`paths.ts`), the timestamp prefix is defined once (`markers.ts`), and the escaping helpers are reused across the cells. CR-10 (a repeated type) is a Nit |
| Dependency Safety | ⚠️ | **No dependencies added**: `package.json` dependencies and the lockfile are unchanged from `main`, and runtime uses only Node built-ins. **`npm audit`:** 7 advisories (4 high, 3 moderate). They are **pre-existing**, **development-only**, and `npm audit --omit=dev` reports 0. See CR-11 |

## 3. Findings

| ID    | Sev | Area | Location | Issue | Failure scenario (reproduced) | Proposed fix |
| ----- | --- | ---- | -------- | ----- | ----------------------------- | ------------ |
| CR-1  | Low | Security / NFR-1.2 | [render.ts:18-24](../../src/doc-sync/render.ts#L18-L24) | GitHub's Markdown auto-links bare URLs, `www.` hosts and e-mail addresses. Escaping does not defuse them | `description: "see https://evil.example"` becomes a clickable link in the Description cell | **User decision:** (a) amend NFR-1.2. The visible text *is* the URL, so the link is not deceptive, and "defusing" it (`https\://…`) would make descriptions harder to read *(recommended)*; or (b) defuse autolinks |
| CR-2  | Low | Correctness / DR-7 | [render.ts:31-35](../../src/doc-sync/render.ts#L31-L35) | `URL.href` leaves `\` unencoded in the query and fragment, so it escapes the closing `)` of the link | `https://a.com/?x=\` → `[a.com/?x=\\](https://a.com/?x=\)`, an unterminated link shown as raw text | Add `'\\': '%5C'` to `LINK_UNSAFE` and its regex, with a regression test |
| CR-3  | Low | Error handling | [github-client.ts:117-128](../../src/doc-sync/github-client.ts#L117-L128) | `x-ratelimit-reset: 1e20` makes `toISOString()` throw a `RangeError`, which surfaces as "unexpected internal error". An empty header reads as `0`, giving "resets at 1970-01-01" | 403 with remaining `0` and reset `1e20` → `RangeError` | Use the detail only for a non-empty header that yields a valid date; otherwise omit it. Add regression tests for both headers |
| CR-4  | Low | Validation | [config.ts:9-10](../../src/doc-sync/config.ts#L9-L10) | A token containing characters above 0xFF passes validation, then makes `Headers` throw a `TypeError`. That is reported as "Could not reach the GitHub API… check your network connection" (exit 3) | `GITHUB_TOKEN='tök€'` → misleading network error | Reject anything outside printable ASCII (`/[^\x21-\x7E]/`) with the existing fixed message (exit 2), and add a regression test |
| CR-5  | Low | Determinism / NFR-2.4 | [repo-metadata.ts:41-44](../../src/doc-sync/repo-metadata.ts#L41-L44) | `Date.parse` treats ISO strings without an offset, and non-ISO forms, as local time | `2017-03-02T00:30:00` renders `2017-03-01` in UTC+5:30 but `2017-03-02` in UTC. GitHub always sends `Z`, so this only affects unusual data | Accept only ISO-8601 with `Z` or an explicit `±hh:mm` offset; otherwise `null` (rendered as `Not Found`). Add a regression test |
| CR-6  | Low | Spec deviation / FR-1 | [cli.ts:53-58](../../src/doc-sync/cli.ts#L53-L58) | FR-1 says missing or unknown flags print *usage* to stderr. The code prints `doc-sync: <message>` and "Run 'doc-sync --help' for usage." | Running with `--force` shows a one-line error, not the usage block | Amend FR-1 to match the code. The specific error plus a hint is clearer than a usage dump, and it is already tested *(recommended)* |
| CR-7  | Low | Spec deviation / NFR-1.4 | [target-file.ts:50-63](../../src/doc-sync/target-file.ts#L50-L63) | NFR-1.4 says paths outside the cwd exit `2`. A *symlink* that escapes the cwd, and a non-file target, exit `3`. The architecture §5 table and the tests say `3` | `--out link.md`, where the link points outside → exit 3 | Amend NFR-1.4: lexical violations give `2` (usage), and violations found only on the file system give `3` (runtime), matching architecture §5 *(recommended)* |
| CR-8  | Nit | Documentation / DR-4 | [markers.ts:47-48](../../src/doc-sync/markers.ts#L47-L48) | Fence detection only covers top-level fences. Fences inside list items or block quotes, and multi-line HTML comments, are not recognized | A marker inside a `<!--\n…\n-->` block gives `duplicate-markers` | Document the limitation in the README. This was deliberately accepted in DR-4 |
| CR-9  | Nit | Security | [render.ts:7](../../src/doc-sync/render.ts#L7) | Invisible format characters (`\p{Cf}`: U+202E right-to-left override, U+200B zero-width space) pass through, which allows display spoofing | A description containing U+202E renders reversed text | Add `\p{Cf}` to the stripped set, with a test |
| CR-10 | Nit | DRY | [args.ts:27-30](../../src/doc-sync/args.ts#L27-L30) | `ArgsPathApi` restates `PathApi` | – | `PathApi & Pick<path.PlatformPath, 'resolve'>` |
| CR-11 | Low | Dependency safety | `package-lock.json` (unchanged) | 7 `npm audit` advisories, all inherited from `main` and development-only. **High:** `postcss` ≤ 8.5.22 and `source-map-js` 1.2.1 (via `vite`/`vitest`), `nanoid` ≤ 3.3.17, `brace-expansion` 3.0.0–5.0.11. **Moderate:** `vitest` / `@vitest/mocker` / `@vitest/coverage-v8` ≤ 4.1.10 | Affects contributors running the test toolchain on untrusted input, not doc-sync users; production audit reports 0 | **User decision:** (a) a separate PR that runs `npm audit fix` *(recommended: unrelated lockfile churn stays out of this feature, per AGENTS.md)*; or (b) fix it in this branch |

## 4. Checked and Clean

- **Token safety.** The `Authorization` header is set only on the fixed-base request. No cause, stack or response body is ever printed. The CLI redacts the token, and every integration run asserts the token is absent from the output.
- **Redirect origin check (DR-2).** It runs before status mapping and rejects lookalike hosts and `http:`.
- **Timeouts.** A real `AbortSignal.timeout` rejects with a `TimeoutError`, which is caught both during the request and during the body read.
- **Status order (DR-3).** The order is 401, then 404, then rate limit, then 403, then 5xx, then the catch-all.
- **Repo validation (FR-2).** It runs before any I/O. `.` and `..` are rejected, and path segments are URL-encoded.
- **`--out`.** Empty, absolute, `..` and other-drive values are rejected, and drive-relative paths resolve safely. `realpath` is applied to both the file and the cwd.
- **Writes.** They are atomic: a UUID-named temp file, a restored file mode, and a rename onto the real path. The temp file is cleaned up on failure, and the original error is kept.
- **Markers.** Exactly one ordered pair is required. A BOM, a missing trailing newline and CRLF are preserved. A file with mixed line endings changes only inside the section. Every generated row starts with `| `, so API data cannot inject a marker line.
- **Check mode (FR-10, A2).** Comparison ignores the timestamp and line endings, and no-op writes are skipped (the integration test checks the file's modification time).
- **Process boundary.** There are no top-level side effects outside `bin.ts`, and errors preserve their `cause`.
- **Test hygiene.** There is no `.only`. The two skips are Windows-only and are commented.

## 5. Resolution

These decisions were made by the user. Each code fix has a regression test, and each of those tests was confirmed to **fail on the pre-fix code and pass after the fix**.

| ID    | Outcome | Change |
| ----- | ------- | ------ |
| CR-1  | Accepted, spec amended | NFR-1.2 now allows visible bare-URL autolinks |
| CR-2  | **Fixed** | `render.ts`: `\` → `%5C` in link targets. Tests: `render.test.ts` "percent-encodes a backslash in the query/fragment" |
| CR-3  | **Fixed** | `github-client.ts`: `numericHeader` ignores blank or non-finite values, and an invalid reset date is omitted. Tests: `github-client.test.ts` "omits … reset header" ×3 |
| CR-4  | **Fixed** | `config.ts`: tokens must be printable ASCII (`[!-~]`). The message is now "GITHUB_TOKEN contains whitespace, control, or non-ASCII characters" (still fixed and token-free). Tests: `config.test.ts` "non-ASCII characters" |
| CR-5  | **Fixed** | `repo-metadata.ts`: `created_at` must be ISO-8601 with `Z` or an `±hh:mm` offset. Tests: `repo-metadata.test.ts` "without / with an explicit time zone" ×6 |
| CR-6  | Not fixed (user decision) | Known deviation: FR-1 says usage text is printed on usage errors; the CLI prints the error and a `--help` hint instead. Listed under Known Limitations |
| CR-7  | Not fixed (user decision) | Known deviation: a symlink escape or non-file target exits 3, where NFR-1.4 says 2. This matches architecture §5. Listed under Known Limitations |
| CR-8  | Not fixed (user decision) | Known limitation: fences nested in lists or block quotes, and multi-line HTML comments, are not recognized by marker scanning |
| CR-9  | Not fixed (user decision) | Known limitation: invisible `p{Cf}` characters are not stripped |
| CR-10 | Not fixed (user decision) | Nit; no behavior impact |
| CR-11 | Deferred to a separate PR (user decision) | Pre-existing development-only advisories; `npm audit --omit=dev` reports 0 |

## 6. Traceability

The "Test(s)" column of [requirements.md §7](requirements.md#7-traceability) has been filled in as part of this review.
