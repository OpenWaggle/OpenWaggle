import { describe, expect, it, vi } from 'vitest'

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn(),
}))

import { mergeDiffsByPath, parseUnifiedDiff } from '../status-handler'

describe('mergeDiffsByPath', () => {
  it('returns empty array for empty input', () => {
    expect(mergeDiffsByPath([])).toEqual([])
  })

  it('returns a single entry unchanged', () => {
    const input = [{ path: 'a.ts', diff: 'diff content', additions: 3, deletions: 1 }]
    expect(mergeDiffsByPath(input)).toEqual(input)
  })

  it('passes through entries with unique paths', () => {
    const input = [
      { path: 'a.ts', diff: 'diff a', additions: 1, deletions: 0 },
      { path: 'b.ts', diff: 'diff b', additions: 0, deletions: 2 },
    ]
    const result = mergeDiffsByPath(input)

    expect(result).toHaveLength(2)
    expect(result[0]?.path).toBe('a.ts')
    expect(result[1]?.path).toBe('b.ts')
  })

  it('merges entries with the same path', () => {
    const input = [
      { path: 'a.ts', diff: 'first diff', additions: 2, deletions: 1 },
      { path: 'a.ts', diff: 'second diff', additions: 3, deletions: 4 },
    ]
    const result = mergeDiffsByPath(input)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      path: 'a.ts',
      diff: 'first diff\nsecond diff',
      additions: 5,
      deletions: 5,
    })
  })

  it('merges three entries with the same path', () => {
    const input = [
      { path: 'x.ts', diff: 'd1', additions: 1, deletions: 0 },
      { path: 'x.ts', diff: 'd2', additions: 2, deletions: 0 },
      { path: 'x.ts', diff: 'd3', additions: 0, deletions: 3 },
    ]
    const result = mergeDiffsByPath(input)

    expect(result).toHaveLength(1)
    expect(result[0]?.additions).toBe(3)
    expect(result[0]?.deletions).toBe(3)
    expect(result[0]?.diff).toBe('d1\nd2\nd3')
  })

  it('sorts merged output by path', () => {
    const input = [
      { path: 'z.ts', diff: 'z', additions: 0, deletions: 0 },
      { path: 'a.ts', diff: 'a', additions: 0, deletions: 0 },
      { path: 'm.ts', diff: 'm', additions: 0, deletions: 0 },
    ]
    const result = mergeDiffsByPath(input)

    expect(result.map((d) => d.path)).toEqual(['a.ts', 'm.ts', 'z.ts'])
  })

  it('merges duplicates and sorts together', () => {
    const input = [
      { path: 'z.ts', diff: 'z1', additions: 1, deletions: 0 },
      { path: 'a.ts', diff: 'a1', additions: 0, deletions: 1 },
      { path: 'z.ts', diff: 'z2', additions: 2, deletions: 0 },
      { path: 'a.ts', diff: 'a2', additions: 0, deletions: 2 },
    ]
    const result = mergeDiffsByPath(input)

    expect(result).toHaveLength(2)
    expect(result[0]?.path).toBe('a.ts')
    expect(result[0]?.additions).toBe(0)
    expect(result[0]?.deletions).toBe(3)
    expect(result[1]?.path).toBe('z.ts')
    expect(result[1]?.additions).toBe(3)
    expect(result[1]?.deletions).toBe(0)
  })

  it('handles entries with zero additions and deletions', () => {
    const input = [
      { path: 'a.ts', diff: 'mode change', additions: 0, deletions: 0 },
      { path: 'a.ts', diff: 'content change', additions: 1, deletions: 1 },
    ]
    const result = mergeDiffsByPath(input)

    expect(result).toHaveLength(1)
    expect(result[0]?.additions).toBe(1)
    expect(result[0]?.deletions).toBe(1)
  })
})

describe('parseUnifiedDiff + mergeDiffsByPath integration', () => {
  it('parses and merges a combined worktree+cached diff correctly', () => {
    const worktreeDiff = [
      'diff --git a/shared.ts b/shared.ts',
      '--- a/shared.ts',
      '+++ b/shared.ts',
      '@@ -1 +1,2 @@',
      '-old worktree',
      '+new worktree line 1',
      '+new worktree line 2',
    ].join('\n')

    const cachedDiff = [
      'diff --git a/shared.ts b/shared.ts',
      '--- a/shared.ts',
      '+++ b/shared.ts',
      '@@ -5 +5 @@',
      '-old cached',
      '+new cached',
    ].join('\n')

    const parsed = [...parseUnifiedDiff(worktreeDiff), ...parseUnifiedDiff(cachedDiff)]
    const merged = mergeDiffsByPath(parsed)

    expect(merged).toHaveLength(1)
    expect(merged[0]?.path).toBe('shared.ts')
    expect(merged[0]?.additions).toBe(3)
    expect(merged[0]?.deletions).toBe(2)
  })

  it('keeps separate files distinct through merge', () => {
    const input = [
      'diff --git a/alpha.ts b/alpha.ts',
      '+++ b/alpha.ts',
      '+line',
      'diff --git a/beta.ts b/beta.ts',
      '+++ b/beta.ts',
      '-removed',
    ].join('\n')

    const parsed = parseUnifiedDiff(input)
    const merged = mergeDiffsByPath(parsed)

    expect(merged).toHaveLength(2)
    expect(merged[0]?.path).toBe('alpha.ts')
    expect(merged[0]?.additions).toBe(1)
    expect(merged[1]?.path).toBe('beta.ts')
    expect(merged[1]?.deletions).toBe(1)
  })
})
