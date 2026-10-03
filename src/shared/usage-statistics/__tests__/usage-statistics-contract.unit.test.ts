import { describe, expect, it } from 'vitest'
import { USAGE_STATISTICS_MAX_EVENT_AGE_DAYS } from '../contract'
import { resolveUsageStatisticsEnablement } from '../enablement'
import {
  usageStatisticsDay,
  usageStatisticsEpochDay,
  validateUsageStatisticsContext,
  validateUsageStatisticsEvent,
} from '../validation'

const TODAY = '2026-10-01'
const TODAY_EPOCH_DAY = usageStatisticsEpochDay(TODAY) ?? Number.NaN

const context = {
  version: '1.0.0-beta.4',
  build_channel: 'beta',
  update_channel: 'alpha',
  os: 'darwin',
  arch: 'arm64',
}

const runFinished = {
  name: 'run.finished',
  day: TODAY,
  properties: {
    entry_point: 'cli',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    thinking_level: 'high',
    access_mode: 'yolo',
    waggle: false,
    result: 'completed',
    duration_s: 42,
    input_tokens: 1200,
    output_tokens: 300,
  },
}

describe('usage statistics days', () => {
  it('round-trips UTC days and rejects impossible dates', () => {
    expect(usageStatisticsDay(Date.parse('2026-10-01T23:59:59.000Z'))).toBe(TODAY)
    expect(usageStatisticsEpochDay('2026-02-31')).toBeUndefined()
    expect(usageStatisticsEpochDay('2026-10-01T00:00')).toBeUndefined()
  })
})

describe('validateUsageStatisticsContext', () => {
  it('accepts a complete context', () => {
    expect(validateUsageStatisticsContext(context)).toEqual({ ok: true, value: context })
  })

  it('accepts only release version shapes', () => {
    expect(validateUsageStatisticsContext({ ...context, version: '1.0.0' })).toMatchObject({
      ok: true,
    })
    for (const version of ['1.0.0-hello.world', '1.0.0-beta.4.extra', '1.0.0-BETA.4']) {
      expect(validateUsageStatisticsContext({ ...context, version })).toMatchObject({
        ok: false,
        field: 'version',
      })
    }
  })

  it('rejects unknown fields and dev builds', () => {
    expect(validateUsageStatisticsContext({ ...context, hostname: 'laptop' })).toMatchObject({
      ok: false,
      field: 'hostname',
    })
    expect(validateUsageStatisticsContext({ ...context, build_channel: 'dev' })).toMatchObject({
      ok: false,
      field: 'build_channel',
    })
  })
})

describe('validateUsageStatisticsEvent', () => {
  it('accepts a published event', () => {
    expect(validateUsageStatisticsEvent(runFinished, TODAY_EPOCH_DAY)).toMatchObject({ ok: true })
  })

  it('rejects unknown properties, missing properties and free text', () => {
    const extra = { ...runFinished, properties: { ...runFinished.properties, prompt: 'hi' } }
    expect(validateUsageStatisticsEvent(extra, TODAY_EPOCH_DAY)).toMatchObject({
      ok: false,
      field: 'prompt',
    })
    const { model: _model, ...withoutModel } = runFinished.properties
    expect(
      validateUsageStatisticsEvent({ ...runFinished, properties: withoutModel }, TODAY_EPOCH_DAY),
    ).toMatchObject({ ok: false, field: 'model' })
    const spaced = { ...runFinished, properties: { ...runFinished.properties, model: 'my model' } }
    expect(validateUsageStatisticsEvent(spaced, TODAY_EPOCH_DAY)).toMatchObject({
      ok: false,
      field: 'model',
    })
  })

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'rejects the prototype-named property %s instead of throwing',
    (key) => {
      const event = JSON.parse(`{"name":"run.finished","day":"${TODAY}","properties":{"${key}":1}}`)
      expect(validateUsageStatisticsEvent(event, TODAY_EPOCH_DAY)).toMatchObject({
        ok: false,
        field: key,
      })
    },
  )

  it('rejects times of day and days outside the window', () => {
    expect(
      validateUsageStatisticsEvent(
        { ...runFinished, day: '2026-10-01T10:00:00Z' },
        TODAY_EPOCH_DAY,
      ),
    ).toMatchObject({ ok: false, field: 'day' })
    const old = usageStatisticsDay(
      (TODAY_EPOCH_DAY - USAGE_STATISTICS_MAX_EVENT_AGE_DAYS - 1) * 86_400_000,
    )
    expect(
      validateUsageStatisticsEvent({ ...runFinished, day: old }, TODAY_EPOCH_DAY),
    ).toMatchObject({
      ok: false,
      field: 'day',
    })
  })

  it('treats install.active feature fields as optional but validates them', () => {
    const active = {
      name: 'install.active',
      day: TODAY,
      properties: {
        first_this_week: true,
        first_this_month: false,
        install_age: '8-30d',
        entry_points: ['app', 'cli'],
        extensions_enabled: '0',
      },
    }
    expect(validateUsageStatisticsEvent(active, TODAY_EPOCH_DAY)).toMatchObject({ ok: true })
    const withFlags = {
      ...active,
      properties: { ...active.properties, terminal: true, mcp_servers: ['github', 'custom'] },
    }
    expect(validateUsageStatisticsEvent(withFlags, TODAY_EPOCH_DAY)).toMatchObject({ ok: true })
    const badEntry = { ...active, properties: { ...active.properties, entry_points: ['web'] } }
    expect(validateUsageStatisticsEvent(badEntry, TODAY_EPOCH_DAY)).toMatchObject({
      ok: false,
      field: 'entry_points',
    })
  })
})

describe('resolveUsageStatisticsEnablement', () => {
  const enabled = { settingEnabled: true, buildChannel: 'stable', env: {} } as const

  it('is on by default for released builds', () => {
    expect(resolveUsageStatisticsEnablement(enabled)).toEqual({ enabled: true })
  })

  it.each([
    [{ ...enabled, buildChannel: 'dev' }, 'dev-build'],
    [{ ...enabled, settingEnabled: false }, 'setting'],
    [{ ...enabled, env: { DO_NOT_TRACK: '1' } }, 'do-not-track'],
    [{ ...enabled, env: { PI_TELEMETRY: 'no' } }, 'pi-telemetry'],
    [{ ...enabled, env: { CI: 'true' } }, 'ci'],
    [{ ...enabled, env: { OPENWAGGLE_AUTOMATION: '1' } }, 'automation'],
  ] as const)('turns off for %o', (input, reason) => {
    expect(resolveUsageStatisticsEnablement(input)).toEqual({ enabled: false, reason })
  })

  it.each(['', '2', 'off', ' true', 'no'])('follows Pi: PI_TELEMETRY=%j opts out', (value) => {
    expect(resolveUsageStatisticsEnablement({ ...enabled, env: { PI_TELEMETRY: value } })).toEqual({
      enabled: false,
      reason: 'pi-telemetry',
    })
  })

  it.each(['1', 'TRUE', 'yes'])('follows Pi: PI_TELEMETRY=%j keeps statistics on', (value) => {
    expect(resolveUsageStatisticsEnablement({ ...enabled, env: { PI_TELEMETRY: value } })).toEqual({
      enabled: true,
    })
  })

  it('ignores false-like DO_NOT_TRACK and CI values', () => {
    expect(
      resolveUsageStatisticsEnablement({ ...enabled, env: { DO_NOT_TRACK: '0', CI: 'false' } }),
    ).toEqual({ enabled: true })
  })
})
