import { fetchRepository } from './github-client.js';
import {
  locateSection,
  normalizeForCompare,
  replaceSection,
} from './markers.js';
import { renderSection } from './render.js';
import { readTarget, writeAtomic } from './target-file.js';
import type { CliOptions, SyncDeps, SyncResult } from './types.js';

/**
 * Runs one sync (FR-6 to FR-10). The target file and its markers are validated before the
 * network call, and the file is written only when the content (ignoring the timestamp) changed.
 */
export async function syncDocs(
  options: CliOptions,
  deps: SyncDeps,
): Promise<SyncResult> {
  const target = await readTarget(options.outPath, options.outArg, deps);
  const section = locateSection(target.content, options.outArg);

  const meta = await fetchRepository(options.repo, deps);
  const body = renderSection(meta, { now: deps.now(), eol: section.eol });
  const changed =
    normalizeForCompare(section.body) !== normalizeForCompare(body);

  if (options.check) {
    return { kind: changed ? 'out-of-date' : 'up-to-date' };
  }
  if (!changed) {
    return { kind: 'unchanged' };
  }
  await writeAtomic(
    target,
    replaceSection(section, body),
    options.outArg,
    deps.fs,
  );
  return { kind: 'updated' };
}
