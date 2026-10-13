import { TargetFileError } from './errors.js';

export const START_MARKER = '<!-- doc-sync:start -->';
export const END_MARKER = '<!-- doc-sync:end -->';
/** First line of every generated section; ignored when comparing content (FR-10, A2). */
export const TIMESTAMP_PREFIX = '_Last synced: ';

export type Eol = '\n' | '\r\n';

/** The target file split around the generated section. `before + body + after === content`. */
export interface Section {
  /** Everything up to and including the start-marker line and its line terminator. */
  readonly before: string;
  /** The current generated content (whole lines, including terminators). */
  readonly body: string;
  /** The end-marker line and everything after it. */
  readonly after: string;
  readonly eol: Eol;
}

interface Line {
  readonly text: string;
  readonly start: number;
  /** Offset just past the line terminator. */
  readonly end: number;
}

function splitLines(content: string): ReadonlyArray<Line> {
  const lines: Line[] = [];
  const terminator = /\r?\n/g;
  let start = 0;
  for (const match of content.matchAll(terminator)) {
    lines.push({
      text: content.slice(start, match.index),
      start,
      end: match.index + match[0].length,
    });
    start = match.index + match[0].length;
  }
  if (start < content.length) {
    lines.push({ text: content.slice(start), start, end: content.length });
  }
  return lines;
}

// CommonMark fences: up to 3 spaces of indent, then 3+ backticks or 3+ tildes (DR-4).
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

function opensFence(text: string): string | undefined {
  const match = FENCE_OPEN.exec(text);
  const fence = match?.[1];
  // A backtick fence's info string may not contain backticks.
  if (
    fence === undefined ||
    (fence.startsWith('`') && match?.[2]?.includes('`'))
  ) {
    return undefined;
  }
  return fence;
}

function closesFence(text: string, open: string): boolean {
  const fence = FENCE_CLOSE.exec(text)?.[1];
  return (
    fence !== undefined && fence[0] === open[0] && fence.length >= open.length
  );
}

// Built from a char code so the source file never contains an invisible BOM character.
const BOM = String.fromCharCode(0xfeff);

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

/**
 * Locates the single generated section in `content` (FR-7). Marker lines must stand alone
 * (surrounding whitespace allowed) and are ignored inside fenced code blocks (DR-4).
 *
 * @param displayPath - `--out` as given by the user, used in error messages (DR-13).
 */
export function locateSection(content: string, displayPath: string): Section {
  const starts: Line[] = [];
  const ends: Line[] = [];
  let openFence: string | undefined;

  for (const line of splitLines(content)) {
    const text = stripBom(line.text);
    if (openFence !== undefined) {
      if (closesFence(text, openFence)) {
        openFence = undefined;
      }
      continue;
    }
    openFence = opensFence(text);
    if (openFence !== undefined) {
      continue;
    }
    const trimmed = text.trim();
    if (trimmed === START_MARKER) {
      starts.push(line);
    } else if (trimmed === END_MARKER) {
      ends.push(line);
    }
  }

  const [start] = starts;
  const [end] = ends;
  const hint = `Add these two lines where the generated section should go:\n  ${START_MARKER}\n  ${END_MARKER}`;
  if (start === undefined) {
    throw new TargetFileError(
      'missing-start-marker',
      `${displayPath}: no "${START_MARKER}" marker found. ${hint}`,
    );
  }
  if (end === undefined) {
    throw new TargetFileError(
      'missing-end-marker',
      `${displayPath}: no "${END_MARKER}" marker found. ${hint}`,
    );
  }
  if (starts.length > 1 || ends.length > 1) {
    throw new TargetFileError(
      'duplicate-markers',
      `${displayPath}: expected exactly one "${START_MARKER}" and one "${END_MARKER}" marker`,
    );
  }
  if (end.start < start.end) {
    throw new TargetFileError(
      'markers-out-of-order',
      `${displayPath}: "${END_MARKER}" must come after "${START_MARKER}"`,
    );
  }

  return {
    before: content.slice(0, start.end),
    body: content.slice(start.end, end.start),
    after: content.slice(end.start),
    eol: detectEol(content),
  };
}

/** CRLF if the file uses it anywhere, otherwise LF. */
export function detectEol(content: string): Eol {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/** Rebuilds the file with `body` (no trailing terminator) between the markers. */
export function replaceSection(section: Section, body: string): string {
  return `${section.before}${body}${section.eol}${section.after}`;
}

/**
 * Canonical form of a section body for drift detection: LF line endings, timestamp line
 * removed, trailing blank lines dropped (FR-10, A2).
 */
export function normalizeForCompare(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(TIMESTAMP_PREFIX))
    .join('\n')
    .trimEnd();
}
