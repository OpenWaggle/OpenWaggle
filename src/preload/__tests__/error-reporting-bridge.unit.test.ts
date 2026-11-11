import { beforeEach, describe, expect, it, vi } from 'vitest'

const sentryPreload = vi.hoisted(() => ({ hookupIpc: vi.fn() }))
const exposed = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@sentry/electron/preload-namespaced', () => sentryPreload)
// The Electrobun bridge reaches the page through the preload transport, here Electron's.
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, value: unknown) => exposed.set(key, value) },
  ipcRenderer: { invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  webUtils: { getPathForFile: vi.fn() },
}))

import { exposeErrorReportingBridge as exposeElectrobunBridge } from '../electrobun-error-reporting-bridge'
import { exposeErrorReportingBridge } from '../error-reporting-bridge'

const WITHOUT_SWITCH = ['/Applications/OpenWaggle.app', '--type=renderer']
const WITH_SWITCH = ['/Applications/OpenWaggle.app', '--openwaggle-error-reporting']

describe('error reporting preload bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    exposed.clear()
  })

  it('exposes nothing unless the main process passed the error-reporting switch', () => {
    expect(exposeErrorReportingBridge(WITHOUT_SWITCH)).toBe(false)
    expect(exposeElectrobunBridge(WITHOUT_SWITCH)).toBe(false)
    expect(sentryPreload.hookupIpc).not.toHaveBeenCalled()
    expect(exposed.size).toBe(0)
  })

  it("exposes the SDK's IPC bridge when the main process reports errors", () => {
    expect(exposeErrorReportingBridge(WITH_SWITCH)).toBe(true)
    expect(sentryPreload.hookupIpc).toHaveBeenCalledOnce()
  })

  it('marks the Electrobun page as one that sends envelopes over the app IPC', () => {
    expect(exposeElectrobunBridge(WITH_SWITCH)).toBe(true)
    expect([...exposed]).toEqual([['__OPENWAGGLE_ERROR_REPORT_ENVELOPES__', true]])
    expect(sentryPreload.hookupIpc).not.toHaveBeenCalled()
  })
})
