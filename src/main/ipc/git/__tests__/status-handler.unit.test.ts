import { describe, expect, it, vi } from 'vitest'

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn(),
}))

import { parseUnifiedDiff } from '../status-handler'

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

  it('handles diff with only additions', () => {
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

  it('handles diff with only deletions', () => {
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

  it('handles diff with no additions or deletions', () => {
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
