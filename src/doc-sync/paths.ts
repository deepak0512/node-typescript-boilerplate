import path from 'node:path';

/** The parts of `node:path` needed for containment checks; injectable for cross-platform tests. */
export type PathApi = Pick<
  path.PlatformPath,
  'relative' | 'isAbsolute' | 'sep'
>;

/**
 * Returns `true` when `candidate` is strictly inside `root` (the root itself is not "inside").
 *
 * Uses `path.relative` rather than string prefixes so that `/repo-evil` is not treated as
 * inside `/repo`, Windows drive-letter case is ignored, and a different drive (which yields an
 * absolute relative path) is rejected (design review DR-5).
 */
export function isInside(
  root: string,
  candidate: string,
  pathApi: PathApi = path,
): boolean {
  const rel = pathApi.relative(root, candidate);
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(rel)
  );
}
