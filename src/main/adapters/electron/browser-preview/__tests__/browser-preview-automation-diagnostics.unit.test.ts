import { BROWSER_PREVIEW_AUTOMATION_LIMITS } from '@shared/types/browser-preview-automation'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createBrowserPreviewAutomationDiagnosticsState,
  recordBrowserPreviewCdpMessage,
} from '../browser-preview-automation-diagnostics'

describe('browser preview automation diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records console values without retaining remote objects', () => {
    const state = createBrowserPreviewAutomationDiagnosticsState()
    recordBrowserPreviewCdpMessage(state, 'Runtime.consoleAPICalled', {
      type: 'warning',
      args: [{ value: 'Slow request' }, { value: { duration: 42 } }],
      timestamp: 1_725_000_000,
    })

    expect(state.consoleEntries).toEqual([
      expect.objectContaining({ level: 'warning', text: 'Slow request {"duration":42}' }),
    ])
  })

  it('joins request metadata to successful and failed network completions', () => {
    const state = createBrowserPreviewAutomationDiagnosticsState()
    recordBrowserPreviewCdpMessage(state, 'Network.requestWillBeSent', {
      requestId: 'request-1',
      request: { url: 'https://example.test/api', method: 'POST' },
      timestamp: 4_218.25,
      wallTime: 1_725_000_000,
    })
    recordBrowserPreviewCdpMessage(state, 'Network.responseReceived', {
      requestId: 'request-1',
      response: { url: 'https://example.test/api', status: 204 },
      timestamp: 1_725_000_001,
    })
    recordBrowserPreviewCdpMessage(state, 'Network.requestWillBeSent', {
      requestId: 'request-2',
      request: { url: 'https://example.test/fail', method: 'GET' },
      timestamp: 4_220.25,
      wallTime: 1_725_000_002,
    })
    recordBrowserPreviewCdpMessage(state, 'Network.loadingFailed', {
      requestId: 'request-2',
      errorText: 'net::ERR_FAILED',
      timestamp: 1_725_000_003,
    })

    expect(state.networkEntries).toEqual([
      expect.objectContaining({
        method: 'POST',
        status: 204,
        failed: false,
        timestamp: '2024-08-30T06:40:00.000Z',
      }),
      expect.objectContaining({
        method: 'GET',
        status: null,
        failed: true,
        timestamp: '2024-08-30T06:40:02.000Z',
      }),
    ])
    expect(state.pendingRequests.size).toBe(0)
  })

  it('uses receipt time when request wall time is unavailable', () => {
    const receivedAt = Date.UTC(2026, 8, 5, 12, 34, 56)
    vi.spyOn(Date, 'now').mockReturnValue(receivedAt)
    const state = createBrowserPreviewAutomationDiagnosticsState()

    recordBrowserPreviewCdpMessage(state, 'Network.requestWillBeSent', {
      requestId: 'request-without-wall-time',
      request: { url: 'https://example.test/api', method: 'GET' },
      timestamp: 17.5,
    })
    recordBrowserPreviewCdpMessage(state, 'Network.responseReceived', {
      requestId: 'request-without-wall-time',
      response: { url: 'https://example.test/api', status: 200 },
      timestamp: 18.25,
    })

    expect(state.networkEntries[0]?.timestamp).toBe('2026-09-05T12:34:56.000Z')
  })

  it('uses response receipt time when request metadata is unavailable', () => {
    const receivedAt = Date.UTC(2026, 8, 5, 12, 35, 0)
    vi.spyOn(Date, 'now').mockReturnValue(receivedAt)
    const state = createBrowserPreviewAutomationDiagnosticsState()

    recordBrowserPreviewCdpMessage(state, 'Network.responseReceived', {
      requestId: 'unknown-request',
      response: { url: 'https://example.test/api', status: 200 },
      timestamp: 19.75,
    })

    expect(state.networkEntries[0]?.timestamp).toBe('2026-09-05T12:35:00.000Z')
  })

  it('bounds pending requests that never complete', () => {
    const state = createBrowserPreviewAutomationDiagnosticsState()
    const extraRequest = 1
    for (
      let index = 0;
      index < BROWSER_PREVIEW_AUTOMATION_LIMITS.NETWORK_ENTRIES + extraRequest;
      index += 1
    ) {
      recordBrowserPreviewCdpMessage(state, 'Network.requestWillBeSent', {
        requestId: `request-${String(index)}`,
        request: { url: `https://example.test/${String(index)}`, method: 'GET' },
        timestamp: 1_725_000_000 + index,
      })
    }

    expect(state.pendingRequests.size).toBe(BROWSER_PREVIEW_AUTOMATION_LIMITS.NETWORK_ENTRIES)
    expect(state.pendingRequests.has('request-0')).toBe(false)
  })
})
