import { describe, expect, it } from 'vitest'
import { probePersistenceProblems } from '../electrobun-probe-persistence'

function summary(...runs: { launchPort: string | null; cookie?: string; previous?: string }[]) {
  return {
    runs: runs.map((run) => ({
      result: {
        checks: {
          launchPort: run.launchPort,
          ...(run.cookie === undefined ? {} : { cookieValue: run.cookie }),
          ...(run.previous === undefined ? {} : { previousLaunchCookie: run.previous }),
        },
      },
    })),
  }
}

describe('adapter probe persistence', () => {
  it('passes when the second launch reads the first launch’s cookie on a new port', () => {
    expect(
      probePersistenceProblems(
        summary(
          { launchPort: '50001', cookie: 'one', previous: 'none' },
          { launchPort: '50002', cookie: 'two', previous: 'one' },
        ),
      ),
    ).toEqual([])
  })

  it('reports a lost cookie, a reused port and a missing launch', () => {
    expect(
      probePersistenceProblems(
        summary(
          { launchPort: '50001', cookie: 'one', previous: 'none' },
          { launchPort: '50001', cookie: 'two', previous: 'none' },
        ),
      ),
    ).toHaveLength(2)
    expect(probePersistenceProblems(summary({ launchPort: '1', cookie: 'one' }))).toEqual([
      'The probe needs two launches.',
    ])
  })
})
