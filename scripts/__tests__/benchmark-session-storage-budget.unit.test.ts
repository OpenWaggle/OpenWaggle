import { describe, expect, it } from 'vitest'
import { sessionDiscoveryDatabaseSizePassed } from '../benchmark-session-discovery-assertions'
import {
  sessionDiscoveryBenchmarkMode,
  sessionDiscoveryDatabaseSizeLimitMb,
} from '../benchmark-session-discovery-mode'

describe('Session discovery storage benchmark', () => {
  it('uses a linear database-size envelope for every corpus mode', () => {
    const smoke = sessionDiscoveryBenchmarkMode(['--smoke'])
    const migration = sessionDiscoveryBenchmarkMode(['--migration-scale'])
    const standard = sessionDiscoveryBenchmarkMode([])

    expect(smoke.databaseSizeLimitMb).toBe(
      sessionDiscoveryDatabaseSizeLimitMb(
        smoke.sessionCount,
        smoke.messageCount + smoke.skewedSessionMessageCount,
      ),
    )
    expect(migration.databaseSizeLimitMb).toBeLessThan(standard.databaseSizeLimitMb)
  })

  it('fails non-finite, negative, and over-budget database measurements', () => {
    const mode = sessionDiscoveryBenchmarkMode(['--smoke'])

    expect(sessionDiscoveryDatabaseSizePassed(mode.databaseSizeLimitMb - 1, mode)).toBe(true)
    expect(sessionDiscoveryDatabaseSizePassed(mode.databaseSizeLimitMb, mode)).toBe(false)
    expect(sessionDiscoveryDatabaseSizePassed(Number.NaN, mode)).toBe(false)
    expect(sessionDiscoveryDatabaseSizePassed(Number.POSITIVE_INFINITY, mode)).toBe(false)
    expect(sessionDiscoveryDatabaseSizePassed(-1, mode)).toBe(false)
  })
})
