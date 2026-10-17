import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isInside } from '../../../src/doc-sync/paths.js';

describe('isInside', () => {
  describe('posix', () => {
    const root = '/repo';
    const inside = (p: string): boolean => isInside(root, p, path.posix);

    it.each(['/repo/README.md', '/repo/docs/a.md', '/repo/..hidden.md'])(
      'accepts %s',
      (p) => {
        expect(inside(p)).toBe(true);
      },
    );

    it.each([
      ['the root itself', '/repo'],
      ['the parent', '/'],
      ['a sibling', '/other/a.md'],
      ['a same-prefix sibling', '/repo-evil/a.md'],
      ['a traversal', '/repo/../etc/passwd'],
    ])('rejects %s', (_label, p) => {
      expect(inside(p)).toBe(false);
    });
  });

  describe('win32', () => {
    const root = 'C:\\repo';
    const inside = (p: string): boolean => isInside(root, p, path.win32);

    it('accepts a child regardless of drive-letter or directory case', () => {
      expect(inside('c:\\Repo\\README.md')).toBe(true);
    });

    it.each([
      ['a different drive', 'D:\\repo\\a.md'],
      ['a same-prefix sibling', 'C:\\repo-evil\\a.md'],
      ['the parent', 'C:\\'],
      ['the root itself', 'C:\\repo'],
    ])('rejects %s', (_label, p) => {
      expect(inside(p)).toBe(false);
    });
  });

  it('defaults to the platform path module', () => {
    const root = path.resolve('some-root');
    expect(isInside(root, path.join(root, 'a.md'))).toBe(true);
    expect(isInside(root, path.dirname(root))).toBe(false);
  });
});
