import { parseCliArgs, USAGE } from './args.js';
import { type Env, readConfig } from './config.js';
import { DocSyncError, exitCodeFor, UsageError } from './errors.js';
import { syncDocs } from './sync.js';
import type {
  CliOptions,
  ExitCode,
  FetchLike,
  FileSystemLike,
  SyncResult,
} from './types.js';

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export interface CliDeps {
  readonly fetch: FetchLike;
  readonly fs: FileSystemLike;
  readonly now: () => Date;
  readonly cwd: string;
}

/**
 * The doc-sync command (FR-1, FR-9, FR-10, NFR-2.3). Never rejects: every outcome becomes an exit
 * code plus a message on the injected streams.
 */
export async function runCli(
  argv: ReadonlyArray<string>,
  env: Env,
  io: CliIo,
  deps: CliDeps,
): Promise<ExitCode> {
  let token: string | undefined;
  // Defense in depth (NFR-1.1): messages are token-free by construction, but redact anyway.
  const print = (write: (text: string) => void, message: string): void => {
    const safe =
      token === undefined ? message : message.split(token).join('***');
    write(`${safe}\n`);
  };

  try {
    const parsed = parseCliArgs(argv, deps.cwd);
    if (parsed.kind === 'help') {
      print(io.stdout, USAGE);
      return 0;
    }
    token = readConfig(env).token;
    const result = await syncDocs(parsed.options, { ...deps, token });
    const outcome = describeResult(result, parsed.options);
    print(outcome.code === 0 ? io.stdout : io.stderr, outcome.message);
    return outcome.code;
  } catch (error: unknown) {
    if (error instanceof DocSyncError) {
      const hint =
        error instanceof UsageError ? "\nRun 'doc-sync --help' for usage." : '';
      print(io.stderr, `doc-sync: ${error.message}${hint}`);
      return exitCodeFor(error);
    }
    // Unknown failures are bugs; their details may contain anything, so they are not printed.
    print(io.stderr, 'doc-sync: unexpected internal error');
    return 3;
  }
}

function describeResult(
  result: SyncResult,
  { outArg, repo }: CliOptions,
): { readonly code: ExitCode; readonly message: string } {
  const source = `${repo.owner}/${repo.name}`;
  switch (result.kind) {
    case 'updated':
      return { code: 0, message: `Updated ${outArg} from ${source}` };
    case 'unchanged':
      return {
        code: 0,
        message: `${outArg} is already up to date with ${source}; not modified`,
      };
    case 'up-to-date':
      return { code: 0, message: `${outArg} is up to date with ${source}` };
    case 'out-of-date':
      return {
        code: 1,
        message: `${outArg} is out of date with ${source}; run without --check to update it`,
      };
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}
