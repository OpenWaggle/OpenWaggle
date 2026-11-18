import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const env: Record<string, string | undefined> = {}
  return { switchSet: false, env, info: vi.fn() }
})

vi.mock('electron', () => ({
  app: {
    commandLine: {
      hasSwitch: (name: string) => mocks.switchSet && name === 'openwaggle-startup-timings',
    },
  },
}))
vi.mock('../env', () => ({
  readEnvironmentVariables: (names: readonly string[]) =>
    Object.fromEntries(names.flatMap((name) => (mocks.env[name] ? [[name, mocks.env[name]]] : []))),
}))
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: mocks.info, warn: vi.fn(), error: vi.fn() }),
}))

async function loadStartupTiming() {
  vi.resetModules()
  return import('../startup-timing')
}

describe('startup timing marks', () => {
  beforeEach(() => {
    mocks.switchSet = false
    mocks.env = {}
    mocks.info.mockClear()
  })

  it('logs nothing unless startup timings were asked for', async () => {
    const { createStartupMark } = await loadStartupTiming()
    createStartupMark('test')('bootstrap-start')

    expect(mocks.info).not.toHaveBeenCalled()
  })

  it('logs a mark with its label and time when the GUI was started with the switch', async () => {
    mocks.switchSet = true
    const { createStartupMark } = await loadStartupTiming()
    createStartupMark('test')('bootstrap-start')

    expect(mocks.info).toHaveBeenCalledWith(
      expect.stringMatching(/^Startup timing at [\d.]+ ms uptime$/),
      { label: 'bootstrap-start', elapsedMs: expect.any(Number) },
    )
  })

  it('logs marks in a Host launched by a measuring GUI, which passes a variable instead', async () => {
    mocks.env = { OPENWAGGLE_STARTUP_TIMINGS: '1' }
    const { createStartupMark } = await loadStartupTiming()
    createStartupMark('test')('host-listening')

    expect(mocks.info).toHaveBeenCalledOnce()
  })
})
