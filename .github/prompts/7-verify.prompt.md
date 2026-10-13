---
agent: implementer
description: 'SDLC Step 7 – Run the full verification suite and the output content-quality check; record verification.md'
---

Run the `verify-doc-sync` skill in **full** mode, including `npm run test:coverage:all`. Then run these extra checks:

1. **CI-equivalent run.** Use a clean clone with `core.autocrlf=false` and run every command from `.github/workflows/nodejs.yml`, in order.
2. **Content quality.** Run `__tests__/integration/project-info.test.ts` against [PROJECT_INFO.md](../../docs/PROJECT_INFO.md).
3. **Live cross-check (needs network).** Compare each row of `docs/PROJECT_INFO.md` with a fresh `GET /repos/jsynowiec/node-typescript-boilerplate`, then run `npm run doc-sync -- --repo jsynowiec/node-typescript-boilerplate --out docs/PROJECT_INFO.md --check`.

Record every command, its result, and the coverage figures in `docs/sdlc/verification.md`. That includes a requirement-by-requirement verification matrix and any limitations. Do not mark anything as passed unless you ran it.
