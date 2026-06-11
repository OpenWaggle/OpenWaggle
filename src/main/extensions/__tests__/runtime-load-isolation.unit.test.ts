import { describe, expect, it, vi } from 'vitest'
import { loadWithRuntimeFailureIsolation } from '../runtime-load-isolation'

interface TestSelection {
  readonly id: string
  readonly packagePath: string
}

type RecordFailure = (selection: TestSelection, error: unknown) => void

const FIRST_SELECTION: TestSelection = { id: 'first', packagePath: '/tmp/first' }
const SECOND_SELECTION: TestSelection = { id: 'second', packagePath: '/tmp/second' }
const DUPLICATE_FIRST_SELECTION: TestSelection = {
  id: 'first-duplicate',
  packagePath: FIRST_SELECTION.packagePath,
}

function pathSet(paths: readonly string[]) {
  return new Set(paths)
}

describe('loadWithRuntimeFailureIsolation', () => {
  it('passes each package path to the runtime loader only once', async () => {
    const load = vi.fn(async (paths: readonly string[]) => paths.join(','))
    const recordFailure = vi.fn<RecordFailure>()

    const result = await loadWithRuntimeFailureIsolation({
      selections: [FIRST_SELECTION, DUPLICATE_FIRST_SELECTION],
      load,
      recordFailure: async (selection, error) => {
        recordFailure(selection, error)
      },
    })

    expect(result).toBe(FIRST_SELECTION.packagePath)
    expect(load).toHaveBeenCalledWith([FIRST_SELECTION.packagePath])
    expect(recordFailure).not.toHaveBeenCalled()
  })

  it('does not disable a package when the loader isolates contribution failures itself', async () => {
    const recordFailure = vi.fn<RecordFailure>()

    const result = await loadWithRuntimeFailureIsolation({
      selections: [FIRST_SELECTION],
      load: async () => ({
        loadedPackagePaths: [FIRST_SELECTION.packagePath],
        disabledContributionIds: ['first.bad-contribution'],
      }),
      recordFailure: async (selection, error) => {
        recordFailure(selection, error)
      },
    })

    expect(result).toEqual({
      loadedPackagePaths: [FIRST_SELECTION.packagePath],
      disabledContributionIds: ['first.bad-contribution'],
    })
    expect(recordFailure).not.toHaveBeenCalled()
  })

  it('returns the baseline load and records the failing package when a single extension breaks startup', async () => {
    const failure = new Error('extension failed')
    const recordFailure = vi.fn<RecordFailure>()

    const result = await loadWithRuntimeFailureIsolation({
      selections: [FIRST_SELECTION],
      load: async (paths) => {
        if (paths.includes(FIRST_SELECTION.packagePath)) {
          throw failure
        }
        return 'baseline'
      },
      recordFailure: async (selection, error) => {
        recordFailure(selection, error)
      },
    })

    expect(result).toBe('baseline')
    expect(recordFailure).toHaveBeenCalledWith(FIRST_SELECTION, failure)
  })

  it('keeps viable packages enabled when another package fails in isolation', async () => {
    const failure = new Error('first extension failed')
    const recordFailure = vi.fn<RecordFailure>()

    const result = await loadWithRuntimeFailureIsolation({
      selections: [FIRST_SELECTION, SECOND_SELECTION],
      load: async (paths) => {
        if (paths.includes(FIRST_SELECTION.packagePath)) {
          throw failure
        }
        return [...paths].sort().join(',')
      },
      recordFailure: async (selection, error) => {
        recordFailure(selection, error)
      },
    })

    expect(result).toBe(SECOND_SELECTION.packagePath)
    expect(recordFailure).toHaveBeenCalledWith(FIRST_SELECTION, failure)
    expect(recordFailure).not.toHaveBeenCalledWith(SECOND_SELECTION, expect.any(Error))
  })

  it('disables one package when individually valid packages fail together', async () => {
    const combinedFailure = new Error('combined extension failure')
    const recordFailure = vi.fn<RecordFailure>()

    const result = await loadWithRuntimeFailureIsolation({
      selections: [FIRST_SELECTION, SECOND_SELECTION],
      load: async (paths) => {
        const selectedPaths = pathSet(paths)
        if (
          selectedPaths.has(FIRST_SELECTION.packagePath) &&
          selectedPaths.has(SECOND_SELECTION.packagePath)
        ) {
          throw combinedFailure
        }
        return [...paths].sort().join(',')
      },
      recordFailure: async (selection, error) => {
        recordFailure(selection, error)
      },
    })

    expect(result).toBe(SECOND_SELECTION.packagePath)
    expect(recordFailure).toHaveBeenCalledWith(FIRST_SELECTION, combinedFailure)
    expect(recordFailure).not.toHaveBeenCalledWith(SECOND_SELECTION, expect.any(Error))
  })

  it('does not blame extensions when the baseline load fails too', async () => {
    const baselineFailure = new Error('project settings failed')
    const recordFailure = vi.fn()

    await expect(
      loadWithRuntimeFailureIsolation({
        selections: [FIRST_SELECTION],
        load: async () => {
          throw baselineFailure
        },
        recordFailure,
      }),
    ).rejects.toThrow(baselineFailure)

    expect(recordFailure).not.toHaveBeenCalled()
  })

  it('keeps the safe fallback load when recording an isolated failure fails', async () => {
    const loadFailure = new Error('extension failed')
    const recordFailure = vi.fn<RecordFailure>(() => {
      throw new Error('lifecycle repository unavailable')
    })

    const result = await loadWithRuntimeFailureIsolation({
      selections: [FIRST_SELECTION],
      load: async (paths) => {
        if (paths.includes(FIRST_SELECTION.packagePath)) {
          throw loadFailure
        }
        return 'baseline'
      },
      recordFailure: async (selection, error) => {
        recordFailure(selection, error)
      },
    })

    expect(result).toBe('baseline')
    expect(recordFailure).toHaveBeenCalledWith(FIRST_SELECTION, loadFailure)
  })

  it('keeps the safe fallback load when every failure recording side effect fails', async () => {
    const firstFailure = new Error('first extension failed')
    const secondFailure = new Error('second extension failed')
    const recordFailure = vi.fn<RecordFailure>(() => {
      throw new Error('lifecycle repository unavailable')
    })

    const result = await loadWithRuntimeFailureIsolation({
      selections: [FIRST_SELECTION, SECOND_SELECTION],
      load: async (paths) => {
        if (paths.includes(FIRST_SELECTION.packagePath)) {
          throw firstFailure
        }
        if (paths.includes(SECOND_SELECTION.packagePath)) {
          throw secondFailure
        }
        return 'baseline'
      },
      recordFailure: async (selection, error) => {
        recordFailure(selection, error)
      },
    })

    expect(result).toBe('baseline')
    expect(recordFailure).toHaveBeenCalledWith(FIRST_SELECTION, firstFailure)
    expect(recordFailure).toHaveBeenCalledWith(SECOND_SELECTION, secondFailure)
  })
})
