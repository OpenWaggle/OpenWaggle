import { describe, expect, it } from 'vitest'
import { getEditDiff, getEditExtraOutput } from '../edit-tool-result'

describe('edit tool result', () => {
  it('reads the unified patch Pi records for an edit', () => {
    const patch = [
      '--- src/a.ts',
      '+++ src/a.ts',
      '@@ -10,4 +10,4 @@',
      ' const one = 1',
      ' const two = 2',
      '-const old = 3',
      '+const next = 3',
      ' export {}',
      '',
    ].join('\n')
    const diff = getEditDiff(
      { kind: 'json', data: { details: { diff: 'display diff', patch } } },
      'edit',
    )

    expect(diff).toEqual({
      patch,
      text: patch,
      additions: 1,
      deletions: 1,
      firstChangedLine: 12,
    })
  })

  it('prefers the first changed line Pi reports', () => {
    const diff = getEditDiff(
      { details: { patch: '--- a\n+++ a\n@@ -1 +1 @@\n-x\n+y', firstChangedLine: 7 } },
      'edit',
    )

    expect(diff?.firstChangedLine).toBe(7)
  })

  it('falls back to the display diff for edits recorded without a patch', () => {
    const diff = getEditDiff(
      { kind: 'json', data: { details: { diff: ' 1 keep\n-2 old\n+2 new\n+3 added' } } },
      'edit',
    )

    expect(diff).toEqual({
      patch: null,
      text: ' 1 keep\n-2 old\n+2 new\n+3 added',
      additions: 2,
      deletions: 1,
      firstChangedLine: null,
    })
  })

  it('derives the first changed line when Pi reports an invalid one', () => {
    const patch = '--- a\n+++ a\n@@ -3,3 +3,3 @@\n keep\n\n-x\n+y'
    for (const firstChangedLine of [0, -1, 1.5, '7', null]) {
      expect(getEditDiff({ details: { patch, firstChangedLine } }, 'edit')?.firstChangedLine).toBe(
        5,
      )
    }
  })

  it('treats text without a hunk header as a display diff, not a patch', () => {
    expect(getEditDiff({ details: { patch: 'not a patch' } }, 'edit')).toEqual({
      patch: null,
      text: 'not a patch',
      additions: 0,
      deletions: 0,
      firstChangedLine: null,
    })
    expect(
      getEditDiff({ details: { patch: '--- a\n+++ a\n', diff: '+1 new' } }, 'edit')?.text,
    ).toBe('+1 new')
    expect(getEditDiff({ details: { patch: '   ', diff: '-1 old' } }, 'edit')?.patch).toBeNull()
    expect(getEditDiff({ details: { patch: '--- a\n+++ a\n-old\n+new' } }, 'edit')).toMatchObject({
      patch: null,
      additions: 1,
      deletions: 1,
    })
  })

  it('has no diff for other tools or edits without details', () => {
    expect(getEditDiff({ details: { patch: '@@ -1 +1 @@\n-a\n+b' } }, 'write')).toBeNull()
    expect(getEditDiff('Successfully replaced 1 block(s).', 'edit')).toBeNull()
    expect(getEditDiff({ details: { diff: '  ' } }, 'edit')).toBeNull()
  })

  describe('getEditExtraOutput', () => {
    const PI_LINE = 'Successfully replaced 1 block(s) in src/a.(b).ts.'
    const blocks = (...texts: string[]) => ({
      content: texts.map((text) => ({ type: 'text', text })),
      details: { patch: '@@ -1 +1 @@\n-a\n+b' },
    })

    it("has nothing beyond Pi's own line", () => {
      expect(getEditExtraOutput(blocks(PI_LINE), 'src/a.(b).ts')).toBe('')
      expect(getEditExtraOutput(PI_LINE, 'src/a.(b).ts')).toBe('')
    })

    it('keeps text an extension appended, in the same block or its own', () => {
      expect(getEditExtraOutput(blocks(`${PI_LINE}\n\nLSP: 2 errors`), 'src/a.(b).ts')).toBe(
        'LSP: 2 errors',
      )
      expect(
        getEditExtraOutput(blocks(`${PI_LINE} LSP: 2 errors in src/a.ts.`), 'src/a.(b).ts'),
      ).toBe('LSP: 2 errors in src/a.ts.')
      expect(getEditExtraOutput(blocks(PI_LINE, 'lint: ok'), 'src/a.(b).ts')).toBe('lint: ok')
    })

    it("keeps text that replaced Pi's line", () => {
      expect(getEditExtraOutput(blocks('Formatted and saved.'), 'src/a.(b).ts')).toBe(
        'Formatted and saved.',
      )
    })

    it('keeps the indentation of aligned diagnostics', () => {
      const frame = '    10 | const x: number = "a"\n       |       ^ TS2322'
      expect(getEditExtraOutput(blocks(PI_LINE, frame), 'src/a.(b).ts')).toBe(frame)
      expect(getEditExtraOutput(blocks(`${PI_LINE}\n${frame}`), 'src/a.(b).ts')).toBe(frame)
    })

    it("removes Pi's line once wherever an extension moved it", () => {
      expect(getEditExtraOutput(blocks('LSP: 2 errors', PI_LINE), 'src/a.(b).ts')).toBe(
        'LSP: 2 errors',
      )
      expect(getEditExtraOutput(blocks(`LSP: 2 errors\n${PI_LINE}`), 'src/a.(b).ts')).toBe(
        'LSP: 2 errors',
      )
      const rewrittenPath = 'Successfully replaced 1 block(s) in /abs/src/a.(b).ts.'
      expect(getEditExtraOutput(blocks(rewrittenPath, 'lint: ok'), 'src/a.(b).ts')).toBe('lint: ok')
      expect(getEditExtraOutput(blocks(PI_LINE, PI_LINE), 'src/a.(b).ts')).toBe(PI_LINE)
    })

    it("keeps text appended to Pi's line wherever the line is", () => {
      const appended = `${PI_LINE} Formatted with prettier.`
      expect(getEditExtraOutput(blocks('LSP: 0 errors', appended), 'src/a.(b).ts')).toBe(
        'LSP: 0 errors\nFormatted with prettier.',
      )
    })

    it("prefers Pi's line for the edited path over one for another file", () => {
      const other = 'Successfully replaced 2 block(s) in src/b.ts.'
      expect(getEditExtraOutput(blocks(other, PI_LINE), 'src/a.(b).ts')).toBe(other)
      expect(getEditExtraOutput(blocks(`LSP ok\n${other}\n${PI_LINE}`), 'src/a.(b).ts')).toBe(
        `LSP ok\n${other}`,
      )
    })

    it('leaves a line it cannot attribute when the path is unknown', () => {
      const ambiguous = 'Successfully replaced 1 block(s) in notes/Ch. 1.md.'
      expect(getEditExtraOutput(blocks(ambiguous), null)).toBe(ambiguous)
      expect(getEditExtraOutput(blocks(`${PI_LINE}\nlint: ok`), null)).toBe('lint: ok')
    })

    it('handles CRLF results and paths too long for a pattern', () => {
      expect(getEditExtraOutput(blocks(`${PI_LINE}\r\nlint: ok\r\n`), 'src/a.(b).ts')).toBe(
        'lint: ok',
      )
      const longPath = `src/${'d/'.repeat(20_000)}a.ts`
      const longLine = `Successfully replaced 1 block(s) in ${longPath}.`
      expect(getEditExtraOutput(blocks(longLine, 'lint: ok'), longPath)).toBe('lint: ok')
    })

    it('never serializes non-text content', () => {
      const image = { content: [{ type: 'image', data: 'iVBOR' }], details: { patch: 'x' } }
      expect(getEditExtraOutput(image, 'src/a.ts')).toBe('')
      expect(getEditExtraOutput(blocks(''), 'src/a.ts')).toBe('')
      expect(getEditExtraOutput({ kind: 'json', data: { details: {} } }, 'src/a.ts')).toBe('')
    })
  })
})
