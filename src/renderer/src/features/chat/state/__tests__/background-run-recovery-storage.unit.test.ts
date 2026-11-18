// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  BACKGROUND_RUN_RECOVERY_STORAGE_KEY,
  loadRecoverableBackgroundRuns,
  persistRecoverableBackgroundRuns,
} from '../background-run-recovery-storage'

const LEGACY_KEY = 'openwaggle:background-run-recovery:v1'

const recovery = {
  sessionId: 'session-b',
  payload: { text: 'Keep me', thinkingLevel: 'medium', attachments: [] },
  waggleConfig: null,
  model: 'openai/gpt-5',
}

describe('background run recovery storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('keeps the other entries when one launch cannot be decoded', () => {
    window.localStorage.setItem(
      BACKGROUND_RUN_RECOVERY_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        launches: [
          { sessionId: 'session-a', launch: { status: 'running', stage: 'from-the-future' } },
        ],
        recoveries: [recovery],
      }),
    )

    const loaded = loadRecoverableBackgroundRuns()

    expect(loaded.launches.size).toBe(0)
    expect([...loaded.recoveries.keys()].map(String)).toEqual(['session-b'])
  })

  it('migrates the version-1 key and stops writing it', () => {
    window.localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ version: 1, launches: [], recoveries: [recovery] }),
    )

    const loaded = loadRecoverableBackgroundRuns()
    expect(loaded.recoveries.size).toBe(1)
    persistRecoverableBackgroundRuns(loaded)

    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(
      JSON.parse(window.localStorage.getItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY) ?? '{}'),
    ).toMatchObject({ version: 2 })
  })
})
