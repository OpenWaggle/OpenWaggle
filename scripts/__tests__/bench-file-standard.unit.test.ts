import { describe, expect, it } from 'vitest'
import { BENCH_FILE, collectBenchFileViolations, currentBranch } from '../standards/bench-file'

const WITH_BENCH = new Set(['package.json', BENCH_FILE])

describe('the Performance Gate bench file', () => {
  it('is allowed on a bench branch only', () => {
    expect(collectBenchFileViolations(WITH_BENCH, 'bench/perf-gate-noise')).toEqual([])
    expect(collectBenchFileViolations(new Set(['package.json']), 'main')).toEqual([])
    for (const branch of ['main', 'ow/electron-smaller-faster', 'benchmarks', undefined]) {
      expect(collectBenchFileViolations(WITH_BENCH, branch)).toEqual([
        expect.objectContaining({
          file: BENCH_FILE,
          detail: `branch ${branch ?? '(detached HEAD)'}`,
        }),
      ])
    }
  })

  it("reads a pull request's head branch, a pushed branch, then the local one", () => {
    const local = () => 'ow/local'
    expect(
      currentBranch({ GITHUB_HEAD_REF: 'ow/pr', GITHUB_REF: 'refs/pull/1/merge' }, local),
    ).toBe('ow/pr')
    expect(currentBranch({ GITHUB_HEAD_REF: '', GITHUB_REF: 'refs/heads/main' }, local)).toBe(
      'main',
    )
    expect(currentBranch({ GITHUB_REF: 'refs/tags/v1.0.0' }, local)).toBe('ow/local')
    expect(currentBranch({}, () => '')).toBeUndefined()
  })
})
