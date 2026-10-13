import path from 'node:path';
import { parseArgs } from 'node:util';
import { UsageError } from './errors.js';
import { isInside } from './paths.js';
import type { CliOptions, RepoRef } from './types.js';

export const USAGE = `Usage: doc-sync --repo <owner/repo> --out <file> [--check]

Replaces the section between "<!-- doc-sync:start -->" and "<!-- doc-sync:end -->"
in <file> with metadata for the GitHub repository <owner/repo>.

Options:
  --repo <owner/repo>  GitHub repository (required)
  --out <file>         Markdown file, relative to and inside the current directory (required)
  --check              Do not write; exit 1 if the section is out of date
  --help               Show this help

Environment:
  GITHUB_TOKEN         Optional GitHub token (raises the API rate limit)

Exit codes: 0 success, 1 out of date (--check), 2 usage error, 3 runtime error`;

export type ParsedArgs =
  | { readonly kind: 'help' }
  | { readonly kind: 'run'; readonly options: CliOptions };

export type ArgsPathApi = Pick<
  path.PlatformPath,
  'relative' | 'isAbsolute' | 'sep' | 'resolve'
>;

// GitHub limits (FR-2): owners are 1-39 alphanumerics/hyphens, not starting with a hyphen;
// repository names are 1-100 of [A-Za-z0-9._-].
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

/** Parses and validates CLI arguments (FR-1, FR-2, NFR-1.4). */
export function parseCliArgs(
  argv: ReadonlyArray<string>,
  cwd: string,
  pathApi: ArgsPathApi = path,
): ParsedArgs {
  const values = parseFlags(argv);
  if (values.help === true) {
    return { kind: 'help' };
  }
  if (values.repo === undefined) {
    throw new UsageError('Missing required option --repo');
  }
  if (values.out === undefined) {
    throw new UsageError('Missing required option --out');
  }
  return {
    kind: 'run',
    options: {
      repo: parseRepoRef(values.repo),
      outArg: values.out,
      outPath: resolveOutPath(values.out, cwd, pathApi),
      check: values.check === true,
    },
  };
}

interface Flags {
  readonly repo?: string | undefined;
  readonly out?: string | undefined;
  readonly check?: boolean | undefined;
  readonly help?: boolean | undefined;
}

function parseFlags(argv: ReadonlyArray<string>): Flags {
  try {
    return parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        repo: { type: 'string' },
        out: { type: 'string' },
        check: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    }).values;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'invalid arguments';
    throw new UsageError(detail, { cause: error });
  }
}

/** Validates `owner/repo` before any network call (FR-2). */
export function parseRepoRef(value: string): RepoRef {
  const parts = value.split('/');
  const [owner, name] = parts;
  if (
    parts.length !== 2 ||
    owner === undefined ||
    name === undefined ||
    !OWNER_PATTERN.test(owner) ||
    !NAME_PATTERN.test(name) ||
    name === '.' ||
    name === '..'
  ) {
    throw new UsageError(
      `Invalid --repo ${JSON.stringify(value)}: expected "owner/repo"`,
    );
  }
  return { owner, name };
}

function resolveOutPath(
  out: string,
  cwd: string,
  pathApi: ArgsPathApi,
): string {
  const message = `Invalid --out ${JSON.stringify(out)}: must be a relative path inside the current directory`;
  if (out.trim() === '' || pathApi.isAbsolute(out)) {
    throw new UsageError(message);
  }
  const resolved = pathApi.resolve(cwd, out);
  if (!isInside(cwd, resolved, pathApi)) {
    throw new UsageError(message);
  }
  return resolved;
}
