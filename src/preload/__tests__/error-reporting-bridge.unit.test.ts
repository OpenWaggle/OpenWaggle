import { beforeEach, describe, expect, it, vi } from 'vitest'

const sentryPreload = vi.hoisted(() => ({ hookupIpc: vi.fn() }))

vi.mock('@sentry/electron/preload-namespaced', () => sentryPreload)

import { exposeErrorReportingBridge } from '../error-reporting-bridge'

describe('error reporting preload bridge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exposes nothing unless the main process passed the error-reporting switch', () => {
    expect(exposeErrorReportingBridge(['/Applications/OpenWaggle.app', '--type=renderer'])).toBe(
      false,
    )
    expect(sentryPreload.hookupIpc).not.toHaveBeenCalled()
  })

  it("exposes the SDK's IPC bridge when the main process reports errors", () => {
    expect(
      exposeErrorReportingBridge(['/Applications/OpenWaggle.app', '--openwaggle-error-reporting']),
    ).toBe(true)
    expect(sentryPreload.hookupIpc).toHaveBeenCalledOnce()
  })
})
