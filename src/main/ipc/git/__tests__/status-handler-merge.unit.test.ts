import { describe, expect, it } from 'vitest'
import { mergeDiffsByPath, parseUnifiedDiff } from '../status-parse'

const file = (path: string, diff: string, additions: number, deletions: number) => ({
  path,
  diff,
  additions,
  deletions,
})

describe('mergeDiffsByPath', () => {
  it.each([
    ['nothing', [], []],
    ['one entry', [file('a.ts', 'diff content', 3, 1)], [file('a.ts', 'diff content', 3, 1)]],
    [
      'entries with distinct paths',
      [file('a.ts', 'diff a', 1, 0), file('b.ts', 'diff b', 0, 2)],
      [file('a.ts', 'diff a', 1, 0), file('b.ts', 'diff b', 0, 2)],
    ],
    [
      'two entries for one path',
      [file('a.ts', 'first diff', 2, 1), file('a.ts', 'second diff', 3, 4)],
      [file('a.ts', 'first diff\nsecond diff', 5, 5)],
    ],
    [
      'three entries for one path',
      [file('x.ts', 'd1', 1, 0), file('x.ts', 'd2', 2, 0), file('x.ts', 'd3', 0, 3)],
      [file('x.ts', 'd1\nd2\nd3', 3, 3)],
    ],
    [
      'unsorted paths',
      [file('z.ts', 'z', 0, 0), file('a.ts', 'a', 0, 0), file('m.ts', 'm', 0, 0)],
      [file('a.ts', 'a', 0, 0), file('m.ts', 'm', 0, 0), file('z.ts', 'z', 0, 0)],
    ],
    [
      'interleaved duplicates',
      [
        file('z.ts', 'z1', 1, 0),
        file('a.ts', 'a1', 0, 1),
        file('z.ts', 'z2', 2, 0),
        file('a.ts', 'a2', 0, 2),
      ],
      [file('a.ts', 'a1\na2', 0, 3), file('z.ts', 'z1\nz2', 3, 0)],
    ],
  ])('merges %s into one sorted entry per path', (_label, input, expected) => {
    expect(mergeDiffsByPath(input)).toEqual(expected)
  })

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

    const merged = mergeDiffsByPath([
      ...parseUnifiedDiff(worktreeDiff),
      ...parseUnifiedDiff(cachedDiff),
    ])

    expect(merged).toEqual([file('shared.ts', `${worktreeDiff}\n${cachedDiff}`, 3, 2)])
  })
})
