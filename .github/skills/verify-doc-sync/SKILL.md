---
name: verify-doc-sync
description: 'Runs the full doc-sync verification gate (lint, format, types, unit and integration tests, build) and summarizes the results. Use after every implementation task and before review or PR.'
---

# Verify doc-sync

Run these commands from the repository root, in order. Do not stop at the first failure; collect every result.

| # | Command                     | Pass criterion                                                            |
| - | --------------------------- | ------------------------------------------------------------------------- |
| 1 | `npm run lint`              | No errors. Warnings must be listed in the report                          |
| 2 | `npm run prettier:check`    | "All matched files use Prettier code style!"                              |
| 3 | `npm run check-types`       | Exit 0                                                                    |
| 4 | `npm test`                  | All unit tests pass                                                       |
| 5 | `npm run test:integration`  | All pass. Skip only if `__tests__/integration/` does not exist yet, and say so |
| 6 | `npm run build`             | Exit 0, and `build/doc-sync/bin.js` exists once `bin.ts` has been implemented |

When verifying for Step 7 or the PR, also run `npm run test:coverage:all` and report line and branch coverage for `src/doc-sync/**`. The target is ≥ 90 % (DR-9).

## Report format

- A table of each step with ✅/❌ and its key output line (test counts, coverage).
- For each failure: the command, the relevant excerpt of its output, and the likely cause.
- Never mark a step as passed without running it. Never edit tests just to make them pass.
