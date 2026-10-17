import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { locateSection } from '../../src/doc-sync/markers.js';

// Content-quality check for the committed sample output (Step 7). It validates structure and
// formats rather than live values, so it stays deterministic when upstream metadata changes.

const DOC_URL = new URL('../../docs/PROJECT_INFO.md', import.meta.url);
const FIELDS = [
  'Name',
  'Full Name',
  'Description',
  'URL',
  'Default Branch',
  'License',
  'Topics',
  'Homepage',
  'Created',
] as const;
const NOT_FOUND = 'Not Found';

/** Splits a table row on pipes that are not backslash-escaped. */
function cells(row: string): ReadonlyArray<string> {
  return row
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim());
}

async function loadRows(): Promise<{
  readonly lines: ReadonlyArray<string>;
  readonly values: ReadonlyMap<string, string>;
}> {
  const content = await readFile(DOC_URL, 'utf8');
  const section = locateSection(content, 'docs/PROJECT_INFO.md');
  const lines = section.body.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const values = new Map<string, string>();
  for (const row of lines.slice(4)) {
    const [field, value] = cells(row);
    if (field !== undefined && value !== undefined) {
      values.set(field, value);
    }
  }
  return { lines, values };
}

function valueOf(values: ReadonlyMap<string, string>, field: string): string {
  const value = values.get(field);
  if (value === undefined) {
    throw new Error(`missing row: ${field}`);
  }
  return value;
}

describe('docs/PROJECT_INFO.md content quality', () => {
  it('has exactly one generated section with the expected layout (FR-4, FR-8)', async () => {
    const { lines } = await loadRows();

    expect(lines[0]).toMatch(
      /^_Last synced: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z_$/,
    );
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('| Field | Value |');
    expect(lines[3]).toBe('| --- | --- |');
    expect(lines).toHaveLength(4 + FIELDS.length);
  });

  it('lists every field once, in the FR-4 order, as two-cell rows', async () => {
    const { lines } = await loadRows();
    const rows = lines.slice(4);

    expect(rows.map((row) => cells(row)[0])).toEqual([...FIELDS]);
    for (const row of rows) {
      expect(cells(row)).toHaveLength(2);
    }
  });

  it('has no empty values; missing data says "Not Found" (FR-5)', async () => {
    const { values } = await loadRows();
    for (const field of FIELDS) {
      expect(valueOf(values, field)).not.toBe('');
    }
  });

  it('contains no raw HTML, comments, or non-http(s) links (NFR-1.2, NFR-1.3)', async () => {
    const { lines } = await loadRows();
    const body = lines.join('\n');

    expect(body).not.toMatch(/<|>/);
    for (const [, href] of body.matchAll(/\]\(([^)]*)\)/g)) {
      expect(href).toMatch(/^https?:\/\//);
    }
  });

  it('formats each field as specified', async () => {
    const { values } = await loadRows();
    const name = valueOf(values, 'Name');
    const fullName = valueOf(values, 'Full Name');

    expect(fullName.endsWith(`/${name}`)).toBe(true);
    expect(valueOf(values, 'URL')).toMatch(
      /^\[github\.com\/[^\]]+\]\(https:\/\/github\.com\/[^)]+\)$/,
    );
    expect(valueOf(values, 'Default Branch')).toMatch(
      new RegExp(`^(\`[^\`]+\`|${NOT_FOUND})$`),
    );
    // "Name (SPDX-ID)", a bare name without parentheses (e.g. "Other"), or "Not Found".
    expect(valueOf(values, 'License')).toMatch(
      /^([^()]+ \([A-Za-z0-9.+-]+\)|[^()]+)$/,
    );
    expect(valueOf(values, 'Homepage')).toMatch(
      new RegExp(`^(\\[[^\\]]+\\]\\(https?://[^)]+\\)|${NOT_FOUND})$`),
    );
    expect(valueOf(values, 'Created')).toMatch(
      new RegExp(`^(\\d{4}-\\d{2}-\\d{2}|${NOT_FOUND})$`),
    );
  });

  it('renders topics as sorted, unique code spans (FR-4)', async () => {
    const { values } = await loadRows();
    const topics = valueOf(values, 'Topics');
    if (topics === NOT_FOUND) {
      return;
    }
    const names = topics.split(', ').map((topic) => {
      expect(topic).toMatch(/^`[a-z0-9-]+`$/);
      return topic.slice(1, -1);
    });
    expect(names).toEqual([...new Set(names)].sort());
  });
});
