# feat(doc-sync): add GitHub metadata documentation sync CLI

## Summary

This PR adds `doc-sync`, a CLI with no new dependencies. It fetches a repository's core metadata from the GitHub REST API and writes it as a Markdown table between `<!-- doc-sync:start -->` / `<!-- doc-sync:end -->` markers in an existing file. Its `--check` mode can fail CI when the document has gone stale, so project docs stay in sync with GitHub instead of being copy-pasted by hand.

The feature was delivered through an agentic SDLC: requirements → architecture → design review → plan → implementation → review → verification. Each step has a GitHub Copilot agent and prompt, and its record is in `docs/sdlc/`.

## Changes Made

**Product code: `src/doc-sync/` (new)**
- `bin.ts`: the process entry point and the only module with side effects. It wires in the real `fetch`, `fs`, clock and cwd, and sets the exit code.
- `cli.ts`: `runCli`. It maps results and errors to exit codes `0`/`1`/`2`/`3` and messages, redacts the token, and never rejects.
- `args.ts`: strict flag parsing, `owner/repo` validation, and the check that `--out` stays inside the cwd.
- `config.ts`: central `GITHUB_TOKEN` validation (printable ASCII only; the message never echoes the token).
- `github-client.ts`: `GET /repos/{owner}/{repo}` with a fixed origin, a 10 s timeout, a check that redirects stay on the API origin, and the status-to-error mapping.
- `repo-metadata.ts`: type-guarded response parsing. Missing or empty values become `Not Found`.
- `render.ts`: Markdown/HTML-safe rendering of the table cells, links and code spans, plus the timestamp line.
- `markers.ts`: finds and replaces the section between the markers, ignoring fenced code blocks, and preserves the BOM and line endings.
- `target-file.ts`: `realpath` containment check and atomic write (temp file plus rename, with the file mode restored).
- `sync.ts`: orchestration. It validates the file before any network call and writes only when the content changed.
- `errors.ts`, `types.ts`, `paths.ts`: typed errors and exit codes, shared types, and the `isInside` helper.

**Tests (new)**
- `__tests__/unit/doc-sync/*.test.ts` (11 files): one per module, including hostile-input, failure-path and token-leak cases.
- `__tests__/integration/doc-sync.test.ts`: runs `runCli` end to end on a real temp directory with a fake `fetch`.
- `__tests__/integration/project-info.test.ts`: content-quality check of the generated sample document.
- `__tests__/fixtures/{doc-sync,fake-fetch,fake-fs}.ts`: shared fixtures and fakes for the network and file system.

**Config and CI (modified)**
- `package.json`: adds the `doc-sync`, `test:integration` and `test:coverage:all` scripts. No dependency changes.
- `__tests__/vitest.config.ts`: excludes the entry point `bin.ts` from coverage.
- `.github/workflows/nodejs.yml`: runs `npm run test:integration` in the `tests` job.

**Docs**
- `README.md` (modified): new "doc-sync" section and the new scripts.
- `CHANGELOG.md` (new): `[Unreleased]` entry.
- `docs/PROJECT_INFO.md` (new): sample output from a live run against `jsynowiec/node-typescript-boilerplate`.
- `docs/sdlc/` (new): the record for each SDLC step:
  - `user-story.md`
  - `requirements.md` (with traceability)
  - `architecture.md`
  - `design-review.md`
  - `impl-plan.md`
  - `code-review.md`
  - `verification.md`
  - `pull-request.md` (this description)

**GitHub Copilot customizations (new)**
- `.github/agents/*.agent.md`: one agent per step (requirements-analyst, architect, design-reviewer, planner, implementer, code-reviewer, pr-author), linked by handoffs.
- `.github/prompts/{1..8}-*.prompt.md`: one entry prompt per SDLC step.
- `.github/instructions/doc-sync.instructions.md`: module rules applied automatically to doc-sync code and tests.
- `.github/skills/verify-doc-sync/SKILL.md`: the verification gate as a reusable skill.
- `.github/hooks/doc-sync.json` and `scripts/*.mjs`: block agent access to `.env*` files, and run Prettier on TypeScript files the agent edits.

## Test Evidence

Local run at `21adfc9` (Windows 11, Node v24.19.0):

```text
$ npm run lint            → no problems
$ npm run check-types     → exit 0
$ npm test
 Test Files  12 passed (12)
      Tests  279 passed (279)
$ npm run test:integration
 Test Files  2 passed (2)
      Tests  20 passed | 2 skipped (22)
$ npm run test:coverage:all -- --coverage.include='src/doc-sync/**'
File              | % Stmts | % Branch | % Funcs | % Lines
All files         |   99.28 |    98.48 |     100 |   99.28
$ npm audit --omit=dev    → found 0 vulnerabilities
```

**Other evidence:**
- **CI-equivalent run:** a clean clone with LF line endings, running all 7 `nodejs.yml` steps. Every step exited 0, including `prettier:check`.
- **Live check:** the API cross-check matched all 9 rows of `docs/PROJECT_INFO.md`, and `--check` exited 0.
- **Regression tests:** the tests for the code-review fixes (CR-2 to CR-5) were shown to fail before the fix and pass after it.

Full details are in [`docs/sdlc/verification.md`](docs/sdlc/verification.md).

**CI:** _the GitHub Actions run for this PR will be linked here once the branch is pushed._ The 2 integration tests skipped on Windows (POSIX file mode, symlink escape) **run for the first time on the Linux CI runner**, so please confirm they pass.

## Known Limitations

- **"Not Found" fields.** In the sample, `Homepage` is `Not Found` because the upstream repo has none. Any field GitHub returns as null, empty, or (for dates) without an explicit time zone renders as `Not Found`. A `NOASSERTION` license renders as `Other`.
- **Out of scope (requirements §5):**
  - writing to GitHub (commits, PRs, wiki);
  - GitHub Enterprise and other hosts;
  - activity data (stars, forks, issues, contributors, languages, releases);
  - creating the target file or inserting markers automatically;
  - retries and backoff;
  - npm `bin` publishing;
  - a workflow that runs `doc-sync` itself.
- **Accepted deviations and limitations from the code review:**
  - CR-1: GitHub may still auto-link bare URLs in a description. Accepted, and NFR-1.2 was amended.
  - CR-6: usage errors print the error plus a `--help` hint, not the full usage text.
  - CR-7: a symlink escape or non-file target exits 3 (as in the architecture), not 2 as NFR-1.4 states.
  - CR-8: marker scanning does not recognize fences nested in lists or block quotes, or multi-line HTML comments.
  - CR-9: invisible format characters (e.g. U+202E) are not stripped.
- **Deferred:** CR-11, the 7 `npm audit` advisories in development tooling (`vitest`/`vite`, `brace-expansion`). They are pre-existing on `main` and do not affect runtime (`--omit=dev` reports 0). They will be fixed in a separate PR.
- **Rate limits:** unauthenticated use is limited to 60 requests per hour. Set `GITHUB_TOKEN` in CI.
- **Copilot hook format:** `.github/hooks/doc-sync.json` follows GitHub's Copilot hooks format as I understand it, but it has not yet been loaded in a Copilot session.
- **Pre-existing and not touched:**
  - The `start` script points to `build/src/main.js`, while the build outputs `build/main.js` (design review F16).
  - With `core.autocrlf=true`, `prettier:check` fails locally on CRLF checkouts. CI is unaffected.

## Reviewer Checklist

- [ ] CI is green on this PR, **including** the two integration tests that are skipped on Windows (file mode and symlink escape)
- [ ] The behavior matches [`requirements.md`](docs/sdlc/requirements.md). Spot-check the traceability table (§7) against the tests
- [ ] The accepted deviations CR-1, CR-6, CR-7, CR-8 and CR-9 are acceptable to you
- [ ] No new runtime or dev dependencies (`package.json` dependency blocks and `package-lock.json` are unchanged)
- [ ] Secrets: `GITHUB_TOKEN` appears in no output, fixture or doc; it is sent only to `https://api.github.com`
- [ ] Input validation: `--repo` and `--out` (including traversal and symlinks) and API data escaping in `render.ts`
- [ ] Only `src/doc-sync/bin.ts` has top-level side effects; library modules do no logging
- [ ] Error paths: every `GitHubApiError`/`TargetFileError` reason has a test, and failures leave the target file unchanged
- [ ] No `.only`; the only skips are the two commented Windows-only cases
- [ ] Try it locally: `npm run build && npm run doc-sync -- --repo <owner/repo> --out docs/PROJECT_INFO.md --check`
- [ ] The README "doc-sync" section and `CHANGELOG.md` read correctly
- [ ] The Copilot customizations in `.github/` contain no secrets and do not grant broad tool access
- [ ] You agree that CR-11 (dev-dependency advisories) is tracked as a follow-up PR

🤖 Generated with [Claude Code](https://claude.com/claude-code)
