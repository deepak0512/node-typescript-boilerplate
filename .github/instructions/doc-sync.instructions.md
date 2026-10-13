---
applyTo: 'src/doc-sync/**,__tests__/unit/doc-sync/**,__tests__/integration/doc-sync*.test.ts'
---

# doc-sync module rules

These rules apply on top of `AGENTS.md`.

- **Process boundary:** only `bin.ts` may touch `process` (argv, env, exitCode). `cli.ts` writes only to the injected `stdout`/`stderr`. Every other module is pure, or does I/O only through injected `FetchLike` and `FileSystemLike` dependencies.
- **Errors:** throw `UsageError`, `GitHubApiError` or `TargetFileError` from `errors.ts` with a typed `reason`, and pass `{ cause }` when wrapping. Build messages from fixed templates. Never include response bodies, request headers or the token.
- **Rendering:** every string from the API must go through `escapeMarkdownText` (DR-1). Build links only through `renderLink` and code spans only through `renderCode` (DR-7).
- **Unions:** use exhaustive `switch` statements with a `never` default for `SyncResult['kind']` and for every error `reason`.
- **Shared shapes:** put them in `types.ts` (types only). Put path containment in `paths.ts`.
- **Tests:** use a fake `fetch` returning `new Response(...)` and a fixed `now`. Make no real network calls. Integration tests use `fs.mkdtemp` and clean up in `afterEach`. Use `path.posix` or `path.win32` explicitly when testing path logic.
