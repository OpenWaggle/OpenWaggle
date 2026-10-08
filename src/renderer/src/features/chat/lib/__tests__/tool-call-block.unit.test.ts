import { describe, expect, it } from 'vitest'
import {
  buildFencedCodeMarkdown,
  buildTailPreview,
  getEditDiff,
  getResultError,
  getStringArg,
  getToolResultText,
  inferLanguageFromPath,
  shouldHighlightCode,
} from '../tool-call-block'

const LONG_HIGHLIGHT_TEXT = `${'x'.repeat(80_000)}x`
const MANY_LINE_TEXT = Array.from({ length: 1_201 }, () => 'line').join('\n')

describe('tool call block view helpers', () => {
  it('normalizes tool result text from strings, records, and content blocks', () => {
    expect(getToolResultText('plain output')).toBe('plain output')
    expect(getToolResultText({ message: 'message output' })).toBe('message output')
    expect(
      getToolResultText({
        content: [
          { type: 'text', text: 'first' },
          { type: 'image', mimeType: 'image/png' },
          { type: 'text', text: 'second' },
        ],
      }),
    ).toBe('first\nsecond')
    expect(getToolResultText({ content: [], details: 'undefined' })).toBe('')
    expect(getToolResultText({ content: [], message: 'done' })).toBe('done')
    expect(getToolResultText({ content: [], error: 'failed' })).toBe('failed')
    expect(
      getToolResultText({ content: [{ type: 'image', mimeType: 'image/png', data: 'abc' }] }),
    ).toContain('"type": "image"')
  })

  it('extracts explicit and structured error messages', () => {
    expect(getResultError({ state: 'success', content: 'ok', error: 'explicit failure' })).toBe(
      'explicit failure',
    )
    expect(getResultError({ state: 'error', content: 'runtime failure' })).toBe('runtime failure')
    expect(getResultError({ state: 'success', content: { error: 'payload failure' } })).toBe(
      'payload failure',
    )
    expect(getResultError(undefined)).toBeNull()
  })

  it('returns string arguments without coercing other JSON values', () => {
    expect(getStringArg({ path: 'src/app.ts', count: 2 }, 'path')).toBe('src/app.ts')
    expect(getStringArg({ path: 'src/app.ts', count: 2 }, 'count')).toBeNull()
  })

  it('infers syntax highlighting language from known path extensions', () => {
    expect(inferLanguageFromPath('src/app.ts')).toBe('typescript')
    expect(inferLanguageFromPath('script.sh')).toBe('bash')
    expect(inferLanguageFromPath('README')).toBeUndefined()
    expect(inferLanguageFromPath(null)).toBeUndefined()
  })

  it('avoids highlighting excessively large or long outputs', () => {
    expect(shouldHighlightCode('const value = 1')).toBe(true)
    expect(shouldHighlightCode(LONG_HIGHLIGHT_TEXT)).toBe(false)
    expect(shouldHighlightCode(MANY_LINE_TEXT)).toBe(false)
  })

  it('builds a fenced code block with a fence longer than embedded backticks', () => {
    expect(buildFencedCodeMarkdown('const s = ```', 'typescript')).toBe(
      '````typescript\nconst s = ```\n````',
    )
  })

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

  it('has no diff for other tools or edits without details', () => {
    expect(getEditDiff({ details: { patch: '@@ -1 +1 @@\n-a\n+b' } }, 'write')).toBeNull()
    expect(getEditDiff('Successfully replaced 1 block(s).', 'edit')).toBeNull()
    expect(getEditDiff({ details: { diff: '  ' } }, 'edit')).toBeNull()
  })

  it('returns the last visible output lines for long command output', () => {
    expect(buildTailPreview('one\ntwo\nthree\nfour\nfive\nsix\nseven')).toBe(
      'two\nthree\nfour\nfive\nsix\nseven',
    )
  })
})
