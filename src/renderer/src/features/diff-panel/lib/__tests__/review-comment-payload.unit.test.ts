import { describe, expect, it } from 'vitest'
import {
  extractDiffSnippet,
  formatFence,
  formatLineRange,
  formatReviewCommentBlock,
  formatReviewSubmission,
  readPatchLines,
} from '../review-comment-payload'

const PATCH = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  'index 1111111..2222222 100644',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -10,6 +10,7 @@',
  ' const a = 1',
  ' const b = 2',
  '-const c = 3',
  '+const c = 4',
  '+const d = 5',
  ' const e = 6',
  ' const f = 7',
].join('\n')

function comment(overrides: Partial<Parameters<typeof formatReviewCommentBlock>[0]> = {}) {
  return {
    id: 'c1',
    filePath: 'src/foo.ts',
    startLine: 12,
    endLine: 12,
    content: 'use the helper',
    createdAt: 0,
    diff: '+const c = 4',
    ...overrides,
  }
}

describe('review comment payload', () => {
  it('drops patch headers and tracks both line numberings', () => {
    const lines = readPatchLines(PATCH)
    expect(lines.map((l) => l.raw)).toEqual([
      ' const a = 1',
      ' const b = 2',
      '-const c = 3',
      '+const c = 4',
      '+const d = 5',
      ' const e = 6',
      ' const f = 7',
    ])
    // An addition has no old-side number; a deletion has no new-side number.
    expect(lines[3]).toMatchObject({ raw: '+const c = 4', oldLine: null, newLine: 12 })
    expect(lines[2]).toMatchObject({ raw: '-const c = 3', newLine: null, oldLine: 12 })
  })

  it('extracts the commented range with surrounding context', () => {
    const snippet = extractDiffSnippet(PATCH, 12, 13, 1)
    expect(snippet).toContain('+const c = 4')
    expect(snippet).toContain('+const d = 5')
    // one line of context on each side, not the whole hunk
    expect(snippet).toContain('-const c = 3')
    expect(snippet).not.toContain('const a = 1')
  })

  it('returns empty string when the range is not in the patch', () => {
    expect(extractDiffSnippet(PATCH, 900, 901)).toBe('')
  })

  it('grows the fence past backticks in the content', () => {
    // The bug this guards: a diff of a markdown file containing a fenced block
    // would terminate the fence early and corrupt the rest of the message.
    const withFence = '+```ts\n+const x = 1\n+```'
    const out = formatFence('diff', withFence)
    expect(out.startsWith('````diff')).toBe(true)
    expect(out.endsWith('````')).toBe(true)
  })

  it('escapes attributes so a quote in a path cannot break the tag', () => {
    const block = formatReviewCommentBlock(comment({ filePath: 'src/we"ird.ts' }))
    expect(block).toContain('filePath="src/we&quot;ird.ts"')
    expect(block).not.toContain('"we"ird"')
  })

  it('formats single and multi line ranges', () => {
    expect(formatLineRange(4, 4)).toBe('L4')
    expect(formatLineRange(4, 9)).toBe('L4-L9')
  })

  it('omits the fence when no snippet is available', () => {
    const block = formatReviewCommentBlock(comment({ diff: '' }))
    expect(block).not.toContain('```')
    expect(block).toContain('use the helper')
  })

  it('submits summary and every comment as one message', () => {
    const out = formatReviewSubmission('focus on error handling', [
      comment(),
      comment({ id: 'c2', startLine: 20, endLine: 22, content: 'needs a test' }),
    ])
    expect(out.startsWith('**Code review**')).toBe(true)
    expect(out).toContain('focus on error handling')
    expect(out.match(/<review_comment/g)).toHaveLength(2)
    expect(out).toContain('range="L20-L22"')
  })

  it('submits without a summary when none was written', () => {
    const out = formatReviewSubmission('   ', [comment()])
    expect(out).toContain('<review_comment')
    expect(out.split('\n\n')[1]?.startsWith('<review_comment')).toBe(true)
  })
})
