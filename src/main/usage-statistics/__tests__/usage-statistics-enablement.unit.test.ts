import { describe, expect, it } from 'vitest'
import { createUsageStatisticsEnablementState } from '../usage-statistics-enablement'

function releasedState(
  env: Parameters<typeof createUsageStatisticsEnablementState>[0]['env'] = {},
) {
  return createUsageStatisticsEnablementState({ buildChannel: 'beta', env })
}

describe('Usage statistics enablement', () => {
  it('stays off until the settings store publishes the Setting', () => {
    const state = releasedState()

    expect(state.isEnabled()).toBe(false)
    expect(state.current()).toEqual({ enabled: false, reason: 'settings-unavailable' })

    state.publishSetting(true)
    expect(state.isEnabled()).toBe(true)
  })

  it('follows the Setting and turns off again when Settings become unavailable', () => {
    const state = releasedState()
    state.publishSetting(true)

    state.publishSetting(false)
    expect(state.current()).toEqual({ enabled: false, reason: 'setting' })

    state.publishSetting(true)
    state.publishSetting(undefined)
    expect(state.isEnabled()).toBe(false)
  })

  it.each([
    [{ DO_NOT_TRACK: '1' }, 'do-not-track'],
    [{ PI_TELEMETRY: '0' }, 'pi-telemetry'],
    [{ CI: 'true' }, 'ci'],
    [{ OPENWAGGLE_AUTOMATION: '1' }, 'automation'],
  ] as const)('an environment opt-out %o wins over the Setting', (env, reason) => {
    const state = releasedState(env)
    state.publishSetting(true)

    expect(state.current()).toEqual({ enabled: false, reason })
  })

  it('never enables a Dev build', () => {
    const state = createUsageStatisticsEnablementState({ buildChannel: 'dev', env: {} })
    state.publishSetting(true)

    expect(state.current()).toEqual({ enabled: false, reason: 'dev-build' })
  })

  it('notifies listeners only when the effective value flips', () => {
    const state = releasedState()
    const seen: boolean[] = []
    const unsubscribe = state.onChange((enabled) => seen.push(enabled))

    state.publishSetting(true)
    state.publishSetting(true)
    state.publishSetting(false)
    state.publishSetting(undefined)
    unsubscribe()
    state.publishSetting(true)

    expect(seen).toEqual([true, false])
  })

  it('never notifies when the environment already opts out', () => {
    const state = releasedState({ DO_NOT_TRACK: 'yes' })
    const seen: boolean[] = []
    state.onChange((enabled) => seen.push(enabled))

    state.publishSetting(true)
    state.publishSetting(false)

    expect(seen).toEqual([])
  })

  it('keeps notifying other listeners when one throws', () => {
    const state = releasedState()
    const seen: boolean[] = []
    state.onChange(() => {
      throw new Error('listener failed')
    })
    state.onChange((enabled) => seen.push(enabled))

    state.publishSetting(true)

    expect(seen).toEqual([true])
  })
})
