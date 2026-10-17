import { TIMESTAMP_PREFIX, type Eol } from './markers.js';
import type { RepoMetadata } from './types.js';

export const NOT_FOUND = 'Not Found';

// Control characters and whitespace runs (including newlines) collapse to one space.
const WHITESPACE_OR_CONTROL = /[\s\p{Cc}]+/gu;
const MARKDOWN_PUNCTUATION = /[\\`*_[\]|~#]/g;

function collapseWhitespace(value: string): string {
  return value.replace(WHITESPACE_OR_CONTROL, ' ').trim();
}

/**
 * Makes API-sourced text inert inside a Markdown table cell (NFR-1.2, DR-1): no line breaks,
 * no raw HTML or comments (so data can never open or close markers), no links or emphasis.
 */
export function escapeMarkdownText(value: string): string {
  return collapseWhitespace(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(MARKDOWN_PUNCTUATION, (char) => `\\${char}`);
}

// URL.href already percent-encodes spaces, quotes, and angle brackets; these remaining
// characters would end the link destination or split the table cell (DR-7). A backslash
// survives in the query/fragment and would escape the closing parenthesis (CR-2).
const LINK_UNSAFE: Readonly<Record<string, string>> = {
  '(': '%28',
  ')': '%29',
  '|': '%7C',
  '\\': '%5C',
};

/**
 * Renders an `http(s)` URL as a Markdown link; anything else (including `javascript:` or
 * unparseable values) becomes escaped plain text (NFR-1.3, DR-7).
 */
export function renderLink(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return escapeMarkdownText(value);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return escapeMarkdownText(value);
  }
  const href = url.href.replace(
    /[()|\\]/g,
    (char) => LINK_UNSAFE[char] ?? char,
  );
  const text = escapeMarkdownText(
    url.href.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  );
  return `[${text}](${href})`;
}

/**
 * Renders a value as inline code, or as escaped text if it contains a backtick, which would
 * otherwise terminate the code span (DR-7). Pipes are escaped because GFM splits table cells
 * on them even inside code spans.
 */
export function renderCode(value: string): string {
  if (value.includes('`')) {
    return escapeMarkdownText(value);
  }
  return `\`${collapseWhitespace(value).replace(/\|/g, '\\|')}\``;
}

function renderLicense(license: RepoMetadata['license']): string {
  if (license === null) {
    return NOT_FOUND;
  }
  return escapeMarkdownText(
    license.spdxId === null
      ? license.name
      : `${license.name} (${license.spdxId})`,
  );
}

function renderTopics(topics: ReadonlyArray<string>): string {
  if (topics.length === 0) {
    return NOT_FOUND;
  }
  // Default sort compares UTF-16 code units, so the order is locale-independent (NFR-2.4).
  return [...new Set(topics)].sort().map(renderCode).join(', ');
}

function renderDate(isoTimestamp: string | null): string {
  const time = isoTimestamp === null ? Number.NaN : Date.parse(isoTimestamp);
  return Number.isNaN(time)
    ? NOT_FOUND
    : new Date(time).toISOString().slice(0, 10);
}

function orNotFound(
  value: string | null,
  render: (present: string) => string,
): string {
  return value === null ? NOT_FOUND : render(value);
}

/** `_Last synced: 2026-10-13T09:30:00Z_` (FR-8: UTC, second precision). */
export function renderTimestamp(now: Date): string {
  return `${TIMESTAMP_PREFIX}${now.toISOString().replace(/\.\d{3}Z$/, 'Z')}_`;
}

export interface RenderOptions {
  readonly now: Date;
  readonly eol: Eol;
}

/**
 * Renders the generated section body (without markers or a trailing line terminator).
 * Rows and order are fixed by FR-4; missing values render as "Not Found" (FR-5).
 */
export function renderSection(
  meta: RepoMetadata,
  { now, eol }: RenderOptions,
): string {
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['Name', escapeMarkdownText(meta.name)],
    ['Full Name', escapeMarkdownText(meta.fullName)],
    ['Description', orNotFound(meta.description, escapeMarkdownText)],
    ['URL', renderLink(meta.htmlUrl)],
    ['Default Branch', orNotFound(meta.defaultBranch, renderCode)],
    ['License', renderLicense(meta.license)],
    ['Topics', renderTopics(meta.topics)],
    ['Homepage', orNotFound(meta.homepage, renderLink)],
    ['Created', renderDate(meta.createdAt)],
  ];
  return [
    renderTimestamp(now),
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...rows.map(([field, value]) => `| ${field} | ${value} |`),
  ].join(eol);
}
