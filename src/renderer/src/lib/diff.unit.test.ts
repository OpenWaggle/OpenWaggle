import { describe, expect, it } from 'vitest'
import { computeDiff } from './diff'

describe('computeDiff', () => {
  it('counts additions and deletions and includes line numbers', () => {
    const oldContent = `${['line 1', 'line 2', 'line 3'].join('\n')}\n`
    const newContent = `${['line 1', 'line 2 updated', 'line 3', 'line 4'].join('\n')}\n`

    const result = computeDiff(oldContent, newContent, 'notes.txt')

    expect(result.additions).toBe(2)
    expect(result.deletions).toBe(1)
    expect(result.lines.some((line) => line.type === 'remove' && line.content === 'line 2')).toBe(
      true,
    )
    expect(
      result.lines.some((line) => line.type === 'add' && line.content === 'line 2 updated'),
    ).toBe(true)
    expect(result.lines.some((line) => line.type === 'add' && line.content === 'line 4')).toBe(true)
  })

  it('returns empty change lists for identical content', () => {
    const content = 'same\ncontent'
    const result = computeDiff(content, content, 'same.txt')

    expect(result.additions).toBe(0)
    expect(result.deletions).toBe(0)
    expect(result.lines.every((line) => line.type === 'context')).toBe(true)
  })
})
