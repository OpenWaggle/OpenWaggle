import { describe, expect, it } from 'vitest'
import {
  buildFencedCodeMarkdown,
  buildTailPreview,
  getEditUnifiedDiff,
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

  it('parses edit diffs from normalized tool result details', () => {
    const diff = getEditUnifiedDiff(
      {
        kind: 'json',
        data: {
          details: {
            diff: '@@ -1 +1 @@\n-old\n+new',
          },
        },
      },
      'edit',
    )

    expect(diff?.additions).toBe(1)
    expect(diff?.deletions).toBe(1)
    expect(diff?.lines.map((line) => line.type)).toEqual(['meta', 'remove', 'add'])
  })

  it('returns the last visible output lines for long command output', () => {
    expect(buildTailPreview('one\ntwo\nthree\nfour\nfive\nsix\nseven')).toBe(
      'two\nthree\nfour\nfive\nsix\nseven',
    )
  })
})
