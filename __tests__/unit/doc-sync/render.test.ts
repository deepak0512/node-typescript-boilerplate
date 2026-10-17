import { describe, expect, it } from 'vitest';
import {
  escapeMarkdownText,
  NOT_FOUND,
  renderCode,
  renderLink,
  renderSection,
  renderTimestamp,
} from '../../../src/doc-sync/render.js';
import { parseRepoMetadata } from '../../../src/doc-sync/repo-metadata.js';
import type { RepoMetadata } from '../../../src/doc-sync/types.js';
import {
  EMPTY_REPO_RESPONSE,
  FIXED_NOW,
  FULL_REPO_RESPONSE,
} from '../../fixtures/doc-sync.js';

const full = parseRepoMetadata(FULL_REPO_RESPONSE);
const render = (meta: RepoMetadata): string =>
  renderSection(meta, { now: FIXED_NOW, eol: '\n' });
const rowValue = (section: string, field: string): string | undefined =>
  section
    .split('\n')
    .find((line) => line.startsWith(`| ${field} |`))
    ?.slice(`| ${field} | `.length, -' |'.length);

describe('renderSection', () => {
  it('renders the full table in the FR-4 order', () => {
    expect(render(full)).toBe(
      [
        '_Last synced: 2026-10-13T09:30:00Z_',
        '',
        '| Field | Value |',
        '| --- | --- |',
        '| Name | node-typescript-boilerplate |',
        '| Full Name | jsynowiec/node-typescript-boilerplate |',
        '| Description | Minimalistic project template to jump start a Node.js back-end application in TypeScript. |',
        '| URL | [github.com/jsynowiec/node-typescript-boilerplate](https://github.com/jsynowiec/node-typescript-boilerplate) |',
        '| Default Branch | `main` |',
        '| License | Apache License 2.0 (Apache-2.0) |',
        '| Topics | `boilerplate`, `nodejs`, `typescript`, `vitest` |',
        '| Homepage | [example.com/docs](https://example.com/docs) |',
        '| Created | 2017-02-18 |',
      ].join('\n'),
    );
  });

  it('renders "Not Found" for every missing optional field (FR-5, FR-6)', () => {
    const section = render({
      ...parseRepoMetadata(EMPTY_REPO_RESPONSE),
      defaultBranch: null,
      createdAt: null,
    });
    for (const field of [
      'Description',
      'Default Branch',
      'License',
      'Topics',
      'Homepage',
      'Created',
    ]) {
      expect(rowValue(section, field)).toBe(NOT_FOUND);
    }
    expect(rowValue(section, 'Name')).toBe('empty');
  });

  it('renders a license without an SPDX id by name only', () => {
    const section = render({
      ...full,
      license: { name: 'Other', spdxId: null },
    });
    expect(rowValue(section, 'License')).toBe('Other');
  });

  it('sorts and de-duplicates topics', () => {
    const section = render({ ...full, topics: ['b', 'a', 'B', 'a'] });
    expect(rowValue(section, 'Topics')).toBe('`B`, `a`, `b`');
  });

  it('renders "Not Found" for an unparseable date even if parsing was bypassed', () => {
    expect(rowValue(render({ ...full, createdAt: 'garbage' }), 'Created')).toBe(
      NOT_FOUND,
    );
  });

  it('uses the requested line ending (CRLF)', () => {
    const section = renderSection(full, { now: FIXED_NOW, eol: '\r\n' });
    expect(section.split('\r\n')).toHaveLength(13);
    expect(section.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('is deterministic for identical input (NFR-2.4)', () => {
    expect(render(full)).toBe(render(parseRepoMetadata(FULL_REPO_RESPONSE)));
  });

  describe('hostile API data (NFR-1.2, NFR-1.3, DR-1, DR-7)', () => {
    it.each([
      '<!-- doc-sync:end -->',
      'x -->\n<!-- doc-sync:start -->',
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[click](javascript:alert(1))',
      'a | b | c',
      'line1\nline2\r\nline3',
    ])('neutralizes description %j', (description) => {
      const section = render({ ...full, description });
      const lines = section.split('\n');

      expect(lines).toHaveLength(13);
      expect(section).not.toMatch(/<|>/);
      // An escaped `\]` cannot close link text, so only an unescaped `](` would form a link.
      expect(section).not.toMatch(/(?<!\\)\]\(javascript/);
      const descriptionRow = rowValue(section, 'Description') ?? '';
      expect(descriptionRow.replace(/\\\|/g, '')).not.toContain('|');
    });

    it('does not link a javascript: homepage', () => {
      const section = render({ ...full, homepage: 'javascript:alert(1)' });
      expect(rowValue(section, 'Homepage')).toBe('javascript:alert(1)');
    });

    it('falls back to text for a branch containing a backtick', () => {
      const section = render({ ...full, defaultBranch: 'feat`x' });
      expect(rowValue(section, 'Default Branch')).toBe('feat\\`x');
    });
  });
});

describe('escapeMarkdownText', () => {
  it.each([
    ['plain text', 'plain text'],
    ['a\n\tb   c', 'a b c'],
    ['  trim  ', 'trim'],
    ['bell\u0007char', 'bell char'],
    ['a & b', 'a &amp; b'],
    ['<b>', '&lt;b&gt;'],
    ['<!-- x -->', '&lt;!-- x --&gt;'],
    ['*bold* _it_', '\\*bold\\* \\_it\\_'],
    ['[a](b)', '\\[a\\](b)'],
    ['a|b', 'a\\|b'],
    ['`code`', '\\`code\\`'],
    ['~~s~~ #h', '\\~\\~s\\~\\~ \\#h'],
    ['back\\slash', 'back\\\\slash'],
  ])('%j → %j', (input, expected) => {
    expect(escapeMarkdownText(input)).toBe(expected);
  });
});

describe('renderLink', () => {
  it('renders an https link with the scheme stripped from the text', () => {
    expect(renderLink('https://example.com/a_b')).toBe(
      '[example.com/a\\_b](https://example.com/a_b)',
    );
  });

  it('accepts http', () => {
    expect(renderLink('http://example.com')).toBe(
      '[example.com](http://example.com/)',
    );
  });

  it('percent-encodes characters that would break the link or table', () => {
    expect(renderLink('https://example.com/a (b)|c')).toBe(
      '[example.com/a%20(b)\\|c](https://example.com/a%20%28b%29%7Cc)',
    );
  });

  // Regression CR-2: a backslash in the query/fragment escaped the closing parenthesis.
  it.each([
    ['query', 'https://a.com/?x=\\', 'https://a.com/?x=%5C'],
    ['fragment', 'https://a.com/#x\\', 'https://a.com/#x%5C'],
  ])('percent-encodes a backslash in the %s', (_label, value, href) => {
    expect(renderLink(value).endsWith(`](${href})`)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'ftp://example.com',
    'example.com',
    'not a url',
  ])('renders %j as escaped text', (value) => {
    const rendered = renderLink(value);
    expect(rendered).not.toMatch(/\]\(/);
    expect(rendered).toBe(escapeMarkdownText(value));
  });
});

describe('renderCode', () => {
  it('wraps a value in a code span', () => {
    expect(renderCode('main')).toBe('`main`');
  });

  it('escapes pipes inside the code span', () => {
    expect(renderCode('a|b')).toBe('`a\\|b`');
  });

  it('collapses whitespace inside the code span', () => {
    expect(renderCode('a\nb')).toBe('`a b`');
  });
});

describe('renderTimestamp (FR-8)', () => {
  it('uses UTC with second precision', () => {
    expect(renderTimestamp(new Date('2026-01-02T03:04:05.999Z'))).toBe(
      '_Last synced: 2026-01-02T03:04:05Z_',
    );
  });
});
