import { describe, expect, it } from 'vitest';
import {
  detectEol,
  END_MARKER,
  locateSection,
  normalizeForCompare,
  replaceSection,
  START_MARKER,
} from '../../../src/doc-sync/markers.js';

const BOM = String.fromCharCode(0xfeff);
const S = START_MARKER;
const E = END_MARKER;
const locate = (content: string): ReturnType<typeof locateSection> =>
  locateSection(content, 'README.md');

describe('locateSection', () => {
  it('splits the file around the section', () => {
    const content = `# Title\n${S}\nold\n${E}\nfooter\n`;
    const section = locate(content);

    expect(section).toEqual({
      before: `# Title\n${S}\n`,
      body: 'old\n',
      after: `${E}\nfooter\n`,
      eol: '\n',
    });
    expect(section.before + section.body + section.after).toBe(content);
  });

  it('handles an empty section (first run)', () => {
    expect(locate(`${S}\n${E}\n`).body).toBe('');
  });

  it('recognizes markers with surrounding whitespace', () => {
    expect(locate(`  ${S}  \nx\n\t${E}\t\n`).body).toBe('x\n');
  });

  it('preserves a UTF-8 BOM before the start marker', () => {
    const content = `${BOM}${S}\nx\n${E}`;
    const section = locate(content);
    expect(section.before).toBe(`${BOM}${S}\n`);
    expect(section.after).toBe(E);
  });

  it('handles a file without a trailing newline', () => {
    expect(locate(`${S}\nx\n${E}`).after).toBe(E);
  });

  it('detects CRLF line endings', () => {
    const section = locate(`a\r\n${S}\r\nx\r\n${E}\r\n`);
    expect(section.eol).toBe('\r\n');
    expect(section.body).toBe('x\r\n');
  });

  it('does not treat a marker followed by text as a marker', () => {
    expect(() => locate(`${S} extra\n${E}\n`)).toThrow(
      expect.objectContaining({ reason: 'missing-start-marker' }),
    );
  });

  describe('fenced code blocks (DR-4)', () => {
    it.each([
      ['backtick', '```md', '```'],
      ['tilde', '~~~', '~~~'],
      ['indented', '   ```', '   ```'],
      ['longer closing fence', '```', '`````'],
    ])('ignores markers inside a %s fence', (_label, open, close) => {
      const content = `${open}\n${S}\n${E}\n${close}\n${S}\nreal\n${E}\n`;
      expect(locate(content).body).toBe('real\n');
    });

    it('does not close a fence with a different fence character', () => {
      const content = `\`\`\`\n~~~\n${S}\n${E}\n\`\`\`\n${S}\nreal\n${E}\n`;
      expect(locate(content).body).toBe('real\n');
    });

    it('does not close a fence with a shorter fence', () => {
      const content = `\`\`\`\`\n\`\`\`\n${S}\n${E}\n\`\`\`\`\n${S}\nreal\n${E}\n`;
      expect(locate(content).body).toBe('real\n');
    });

    it('treats an unclosed fence as running to the end of the file', () => {
      expect(() => locate(`\`\`\`\n${S}\n${E}\n`)).toThrow(
        expect.objectContaining({ reason: 'missing-start-marker' }),
      );
    });

    it('does not treat 4-space-indented backticks as a fence', () => {
      expect(locate(`    \`\`\`\n${S}\nx\n${E}\n`).body).toBe('x\n');
    });

    it('does not treat a backtick line with backticks in the info string as a fence', () => {
      expect(locate(`\`\`\` a\`b\n${S}\nx\n${E}\n`).body).toBe('x\n');
    });
  });

  describe('marker errors (FR-7)', () => {
    it.each([
      ['missing-start-marker', `# no markers\n`],
      ['missing-start-marker', `${E}\n`],
      ['missing-end-marker', `${S}\nx\n`],
      ['duplicate-markers', `${S}\n${S}\n${E}\n`],
      ['duplicate-markers', `${S}\n${E}\n${E}\n`],
      ['duplicate-markers', `${S}\n${E}\n${S}\n${E}\n`],
      ['markers-out-of-order', `${E}\nx\n${S}\n`],
      ['missing-start-marker', ''],
    ])('throws %s', (reason, content) => {
      expect(() => locate(content)).toThrow(
        expect.objectContaining({ name: 'TargetFileError', reason }),
      );
    });

    it('names the file and explains how to add markers', () => {
      expect(() => locate('nothing')).toThrow(
        `README.md: no "${S}" marker found. Add these two lines where the generated section should go:\n  ${S}\n  ${E}`,
      );
    });
  });
});

describe('replaceSection', () => {
  it('replaces only the body and keeps everything else byte-for-byte', () => {
    const content = `${BOM}# T  \n\n${S}\nold\nlines\n${E}\n  tail without newline`;
    const result = replaceSection(locate(content), 'new');
    expect(result).toBe(
      `${BOM}# T  \n\n${S}\nnew\n${E}\n  tail without newline`,
    );
  });

  it('uses the file line ending after the body', () => {
    const result = replaceSection(locate(`${S}\r\n${E}\r\n`), 'a\r\nb');
    expect(result).toBe(`${S}\r\na\r\nb\r\n${E}\r\n`);
  });
});

describe('normalizeForCompare', () => {
  it('ignores the timestamp line', () => {
    expect(
      normalizeForCompare('_Last synced: 2026-01-01T00:00:00Z_\n\n| a |\n'),
    ).toBe(normalizeForCompare('_Last synced: 2027-12-31T23:59:59Z_\n\n| a |'));
  });

  it('ignores line-ending differences and trailing blank lines', () => {
    expect(normalizeForCompare('a\r\nb\r\n\r\n')).toBe('a\nb');
  });

  it('detects real content changes', () => {
    expect(normalizeForCompare('| a |')).not.toBe(normalizeForCompare('| b |'));
  });

  it('treats an empty body as different from a rendered one', () => {
    expect(normalizeForCompare('')).not.toBe(normalizeForCompare('| a |'));
  });
});

describe('detectEol', () => {
  it.each([
    ['a\nb', '\n'],
    ['a\r\nb', '\r\n'],
    ['single line', '\n'],
    ['mixed\nand\r\n', '\r\n'],
  ])('%j → %j', (content, eol) => {
    expect(detectEol(content)).toBe(eol);
  });
});
