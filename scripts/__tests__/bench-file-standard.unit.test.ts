import { describe, expect, it } from 'vitest'
import {
  BENCH_FILE,
  benchContext,
  collectBenchFileViolations,
  currentBranch,
} from '../standards/bench-file'

const WITH_BENCH = new Set(['package.json', BENCH_FILE])

describe('the Performance Gate bench file', () => {
  it('is allowed on a pushed bench branch only', () => {
    for (const branch of ['bench/perf-gate-noise', 'bench/electron-best-nightly-ab']) {
      expect(collectBenchFileViolations(WITH_BENCH, { branch, event: 'push' })).toEqual([])
      expect(collectBenchFileViolations(WITH_BENCH, { branch, event: undefined })).toEqual([])
    }
    expect(
      collectBenchFileViolations(new Set(['package.json']), { branch: 'main', event: undefined }),
    ).toEqual([])
    for (const branch of [
      'main',
      'ow/electron-smaller-faster',
      'bench/other',
      'benchmarks',
      undefined,
    ]) {
      expect(collectBenchFileViolations(WITH_BENCH, { branch, event: undefined })).toEqual([
        expect.objectContaining({
          file: BENCH_FILE,
          detail: `branch ${branch ?? '(detached HEAD)'}`,
        }),
      ])
    }
  })

  it.each(['pull_request', 'pull_request_target', 'merge_group'])(
    'fails the file on any branch in a %s run, since benches run on a push',
    (event) => {
      expect(
        collectBenchFileViolations(WITH_BENCH, { branch: 'bench/perf-gate-noise', event }),
      ).toEqual([
        expect.objectContaining({
          message: expect.stringContaining('remove it before opening a pull request'),
          detail: `branch bench/perf-gate-noise, event ${event}`,
        }),
      ])
    },
  )

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

  it('reads the event beside the branch', () => {
    expect(
      benchContext(
        { GITHUB_HEAD_REF: 'bench/perf-gate-x', GITHUB_EVENT_NAME: 'pull_request' },
        () => '',
      ),
    ).toEqual({ branch: 'bench/perf-gate-x', event: 'pull_request' })
  })
})
