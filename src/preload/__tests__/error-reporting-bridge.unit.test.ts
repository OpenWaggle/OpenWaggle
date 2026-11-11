import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../transport', async () =>
  (await import('./fake-preload-transport')).fakePreloadTransport(),
)

import { exposeErrorReportingBridge } from '../error-reporting-bridge'
import { exposedInMainWorld } from './fake-preload-transport'

describe('error reporting preload bridge', () => {
  beforeEach(() => exposedInMainWorld.clear())

  it('exposes nothing unless the main process passed the error-reporting switch', () => {
    expect(exposeErrorReportingBridge(['--openwaggle-home-directory=/home/ada'])).toBe(false)
    expect(exposedInMainWorld.size).toBe(0)
  })

  it('marks the page as one that sends envelopes over the app IPC', () => {
    expect(exposeErrorReportingBridge(['--openwaggle-error-reporting'])).toBe(true)
    expect([...exposedInMainWorld]).toEqual([['__OPENWAGGLE_ERROR_REPORT_ENVELOPES__', true]])
  })
})
