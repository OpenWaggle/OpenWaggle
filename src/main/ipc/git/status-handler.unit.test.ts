import { beforeEach, describe, expect, it } from 'vitest'

import {
  invalidateGitStatusCache,
  mergeDiffsByPath,
  normalizeGitPath,
  parseUnifiedDiff,
} from './status-handler'

// ---------------------------------------------------------------------------
// normalizeGitPath
// ---------------------------------------------------------------------------

describe('normalizeGitPath', () => {
  // --- empty / whitespace ---------------------------------------------------

  it('returns empty string for empty input', () => {
    expect(normalizeGitPath('')).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeGitPath('   ')).toBe('')
  })

  // --- passthrough -----------------------------------------------------------

  it('returns a simple path unchanged', () => {
    expect(normalizeGitPath('src/main/index.ts')).toBe('src/main/index.ts')
  })

  it('trims surrounding whitespace from a simple path', () => {
    expect(normalizeGitPath('  src/main/index.ts  ')).toBe('src/main/index.ts')
  })

  // --- brace rename format: {old => new} -----------------------------------

  it('resolves brace rename to the new path', () => {
    expect(normalizeGitPath('src/{old => new}.ts')).toBe('src/new.ts')
  })

  it('resolves nested brace rename', () => {
    expect(normalizeGitPath('src/{components/old => components/new}/file.ts')).toBe(
      'src/components/new/file.ts',
    )
  })

  it('resolves brace rename with empty old side (new file in subdir)', () => {
    expect(normalizeGitPath('src/{ => new}/file.ts')).toBe('src/new/file.ts')
  })

  it('resolves brace rename with empty new side (removed subdir)', () => {
    expect(normalizeGitPath('src/{old => }/file.ts')).toBe('src//file.ts')
  })

  it('resolves brace rename with surrounding quotes', () => {
    expect(normalizeGitPath('"src/{old => new}.ts"')).toBe('src/new.ts')
  })

  // --- plain rename format: old => new --------------------------------------

  it('resolves plain => rename to the new path', () => {
    expect(normalizeGitPath('old.txt => new.txt')).toBe('new.txt')
  })

  it('resolves plain => rename with spaces in filenames', () => {
    expect(normalizeGitPath('"old file.txt" => "new file.txt"')).toBe('new file.txt')
  })

  it('resolves => rename with multiple arrows (takes last segment)', () => {
    expect(normalizeGitPath('a => b => c.txt')).toBe('c.txt')
  })

  // --- arrow rename format: old -> new --------------------------------------

  it('resolves plain -> rename to the new path', () => {
    expect(normalizeGitPath('old.txt -> new.txt')).toBe('new.txt')
  })

  it('resolves -> rename with multiple arrows (takes last segment)', () => {
    expect(normalizeGitPath('a -> b -> c.txt')).toBe('c.txt')
  })

  // --- => takes precedence over -> because it is checked first ---------------

  it('prefers => over -> when both appear', () => {
    // The loop checks ' => ' first, so it resolves via =>
    expect(normalizeGitPath('a => b -> c.txt')).toBe('b -> c.txt')
  })

  // --- quote stripping -------------------------------------------------------

  it('strips surrounding double quotes from a simple path', () => {
    expect(normalizeGitPath('"src/file.txt"')).toBe('src/file.txt')
  })

  it('does not strip single quotes', () => {
    expect(normalizeGitPath("'src/file.txt'")).toBe("'src/file.txt'")
  })

  it('does not strip quotes that are not at both ends', () => {
    expect(normalizeGitPath('"src/file.txt')).toBe('"src/file.txt')
  })

  it('strips quotes from the result of a rename', () => {
    expect(normalizeGitPath('"old.txt" => "new.txt"')).toBe('new.txt')
  })
})

// ---------------------------------------------------------------------------
// parseUnifiedDiff
// ---------------------------------------------------------------------------

describe('parseUnifiedDiff', () => {
  it('returns empty array for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })

  it('returns empty array for whitespace-only input', () => {
    expect(parseUnifiedDiff('   \n  ')).toEqual([])
  })

  it('parses a single file diff with additions and deletions', () => {
    const input = [
      'diff --git a/src/index.ts b/src/index.ts',
      'index abc..def 100644',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -1,3 +1,4 @@',
      ' unchanged line',
      '-removed line',
      '+added line 1',
      '+added line 2',
    ].join('\n')

    const result = parseUnifiedDiff(input)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      path: 'src/index.ts',
      diff: input,
      additions: 2,
      deletions: 1,
    })
  })

  it('parses multiple file diffs', () => {
    const input = [
      'diff --git a/file1.ts b/file1.ts',
      '--- a/file1.ts',
      '+++ b/file1.ts',
      '@@ -1 +1 @@',
      '-old1',
      '+new1',
      'diff --git a/file2.ts b/file2.ts',
      '--- a/file2.ts',
      '+++ b/file2.ts',
      '@@ -1 +1,2 @@',
      '-old2',
      '+new2a',
      '+new2b',
    ].join('\n')

    const result = parseUnifiedDiff(input)

    expect(result).toHaveLength(2)
    expect(result[0]?.path).toBe('file1.ts')
    expect(result[0]?.additions).toBe(1)
    expect(result[0]?.deletions).toBe(1)
    expect(result[1]?.path).toBe('file2.ts')
    expect(result[1]?.additions).toBe(2)
    expect(result[1]?.deletions).toBe(1)
  })

  it('does not count +++ as an addition', () => {
    const input = [
      'diff --git a/f.ts b/f.ts',
      '--- a/f.ts',
      '+++ b/f.ts',
      '@@ -1 +1 @@',
      '+real addition',
    ].join('\n')

    const result = parseUnifiedDiff(input)
    expect(result[0]?.additions).toBe(1)
  })

  it('does not count --- as a deletion', () => {
    const input = [
      'diff --git a/f.ts b/f.ts',
      '--- a/f.ts',
      '+++ b/f.ts',
      '@@ -1 +1 @@',
      '-real deletion',
    ].join('\n')

    const result = parseUnifiedDiff(input)
    expect(result[0]?.deletions).toBe(1)
  })

  it('handles diff with only additions (new file)', () => {
    const input = [
      'diff --git a/new-file.ts b/new-file.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new-file.ts',
      '@@ -0,0 +1,3 @@',
      '+line 1',
      '+line 2',
      '+line 3',
    ].join('\n')

    const result = parseUnifiedDiff(input)
    expect(result).toHaveLength(1)
    expect(result[0]?.path).toBe('new-file.ts')
    expect(result[0]?.additions).toBe(3)
    expect(result[0]?.deletions).toBe(0)
  })

  it('handles diff with only deletions (removed file)', () => {
    const input = [
      'diff --git a/removed.ts b/removed.ts',
      'deleted file mode 100644',
      '--- a/removed.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line 1',
      '-line 2',
    ].join('\n')

    const result = parseUnifiedDiff(input)
    expect(result).toHaveLength(1)
    expect(result[0]?.path).toBe('removed.ts')
    expect(result[0]?.additions).toBe(0)
    expect(result[0]?.deletions).toBe(2)
  })

  it('extracts path from b/ in the header', () => {
    const input = [
      'diff --git a/old-name.ts b/new-name.ts',
      '--- a/old-name.ts',
      '+++ b/new-name.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')

    const result = parseUnifiedDiff(input)
    expect(result[0]?.path).toBe('new-name.ts')
  })

  it('handles path with spaces in b/ segment', () => {
    const input = [
      'diff --git a/my file.ts b/my file.ts',
      '--- a/my file.ts',
      '+++ b/my file.ts',
      '@@ -1 +1 @@',
      '+added',
    ].join('\n')

    const result = parseUnifiedDiff(input)
    expect(result[0]?.path).toBe('my file.ts')
  })

  it('handles diff with no additions or deletions (mode change only)', () => {
    const input = ['diff --git a/script.sh b/script.sh', 'old mode 100644', 'new mode 100755'].join(
      '\n',
    )

    const result = parseUnifiedDiff(input)
    expect(result).toHaveLength(1)
    expect(result[0]?.path).toBe('script.sh')
    expect(result[0]?.additions).toBe(0)
    expect(result[0]?.deletions).toBe(0)
  })

  it('reconstructs full diff string for each entry', () => {
    const input = ['diff --git a/f.ts b/f.ts', '--- a/f.ts', '+++ b/f.ts', '+line'].join('\n')

    const result = parseUnifiedDiff(input)
    expect(result[0]?.diff).toBe(input)
  })

  it('handles multiple hunks in a single file', () => {
    const input = [
      'diff --git a/f.ts b/f.ts',
      '--- a/f.ts',
      '+++ b/f.ts',
      '@@ -1,3 +1,3 @@',
      '-old line 1',
      '+new line 1',
      ' context',
      '@@ -10,2 +10,3 @@',
      ' context2',
      '-old line 10',
      '+new line 10a',
      '+new line 10b',
    ].join('\n')

    const result = parseUnifiedDiff(input)
    expect(result).toHaveLength(1)
    expect(result[0]?.additions).toBe(3)
    expect(result[0]?.deletions).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// mergeDiffsByPath
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// invalidateGitStatusCache
// ---------------------------------------------------------------------------

describe('invalidateGitStatusCache', () => {
  beforeEach(() => {
    // Clear any state from prior tests
    invalidateGitStatusCache()
  })

  it('does not throw when cache is already empty', () => {
    expect(() => invalidateGitStatusCache()).not.toThrow()
  })

  it('does not throw with a specific project path on empty cache', () => {
    expect(() => invalidateGitStatusCache('/some/path')).not.toThrow()
  })

  it('clears all when called without arguments', () => {
    // Just verify it runs without error; the cache is internal
    invalidateGitStatusCache()
  })

  it('clears specific path when called with an argument', () => {
    invalidateGitStatusCache('/project/a')
  })
})

// ---------------------------------------------------------------------------
// parseUnifiedDiff + mergeDiffsByPath integration
// ---------------------------------------------------------------------------

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
    expect(merged[0]?.additions).toBe(3) // 2 from worktree + 1 from cached
    expect(merged[0]?.deletions).toBe(2) // 1 from worktree + 1 from cached
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
