// preToolUse: deny any tool call whose arguments reference a `.env` / `.env.*`
// file, so secrets never enter the agent's context (requirements NFR-1.1).
import process from 'node:process';
import { collectStrings, readHookInput, toolArgsOf } from './read-hook-input.mjs';

const ENV_FILE = /(^|[\s"'`=/\\])\.env(\.[\w.-]+)?(?=$|[\s"'`/\\;|&])/;

const input = await readHookInput();
if (input === undefined) {
  process.stderr.write('deny-env-access: unreadable hook input; allowing\n');
} else if (collectStrings(toolArgsOf(input)).some((s) => ENV_FILE.test(s))) {
  process.stdout.write(
    JSON.stringify({
      permissionDecision: 'deny',
      permissionDecisionReason:
        'Access to .env files is blocked by the doc-sync hook (secrets policy).',
    }),
  );
}
