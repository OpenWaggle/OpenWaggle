import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CdpConnection, type CdpSocket } from '../cdp-connection'
import {
  CefDevToolsEndpoint,
  cefDevToolsSocketUrl,
  resolveCefRemoteDebuggingPort,
} from '../cef-devtools-endpoint'

describe('CEF remote debugging port', () => {
  it('takes the launch environment over the build configuration', () => {
    expect(
      resolveCefRemoteDebuggingPort({
        environmentPort: '41234',
        chromiumFlags: { 'remote-debugging-port': '9222' },
      }),
    ).toBe(41_234)
    expect(
      resolveCefRemoteDebuggingPort({
        environmentPort: undefined,
        chromiumFlags: { 'remote-debugging-port': '9333' },
      }),
    ).toBe(9333)
  })

  it('serves no endpoint for a disabled, invalid or per-launch port the launcher never set', () => {
    for (const environmentPort of ['0', 'off', '80', '70000', 'x']) {
      expect(resolveCefRemoteDebuggingPort({ environmentPort, chromiumFlags: undefined })).toBe(
        null,
      )
    }
    expect(
      resolveCefRemoteDebuggingPort({
        environmentPort: undefined,
        chromiumFlags: { 'remote-debugging-port': 'launch' },
      }),
    ).toBeNull()
    expect(resolveCefRemoteDebuggingPort({ environmentPort: undefined, chromiumFlags: {} })).toBe(
      null,
    )
  })
})

describe('CEF DevTools targets', () => {
  const target = (webSocketDebuggerUrl: string) => ({
    id: 'T1',
    type: 'page',
    url: 'about:blank#m',
    webSocketDebuggerUrl,
  })

  it('accepts only a page socket on the endpoint’s own loopback host and port', () => {
    expect(cefDevToolsSocketUrl(9555, target('ws://127.0.0.1:9555/devtools/page/T1'))).toBe(
      'ws://127.0.0.1:9555/devtools/page/T1',
    )
    for (const url of [
      'ws://127.0.0.1:9556/devtools/page/T1',
      'ws://localhost:9555/devtools/page/T1',
      'ws://10.0.0.2:9555/devtools/page/T1',
      'ws://127.0.0.1:9555/devtools/browser/T1',
      'wss://127.0.0.1:9555/devtools/page/T1',
    ]) {
      expect(() => cefDevToolsSocketUrl(9555, target(url))).toThrow()
    }
  })

  it('finds the page whose URL carries the marker', async () => {
    const lists = [
      [],
      [{ id: 'A', type: 'page', url: 'https://other.test/' }],
      [
        { id: 'A', type: 'page', url: 'https://other.test/' },
        { id: 'B', type: 'page', url: 'about:blank#marker-1' },
      ],
    ]
    const fetchTargets = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(lists.shift() ?? []),
    }))
    const endpoint = new CefDevToolsEndpoint(9555, fetchTargets)
    const page = await endpoint.waitForPage('marker-1', {
      deadlineMs: 1_000,
      pollMs: 1,
      signal: new AbortController().signal,
    })
    expect(page.id).toBe('B')
    expect(fetchTargets).toHaveBeenCalledWith('http://127.0.0.1:9555/json/list')
  })

  it('gives up at the deadline', async () => {
    const endpoint = new CefDevToolsEndpoint(9555, async () => ({
      ok: false,
      status: 500,
      text: async () => '',
    }))
    await expect(
      endpoint.waitForPage('m', {
        deadlineMs: 20,
        pollMs: 5,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/never appeared/)
  })
})

function fakeSocket() {
  const listeners = new Map<string, ((event: { readonly data: unknown }) => void)[]>()
  const sent: string[] = []
  const socket: CdpSocket = {
    send: (data) => void sent.push(data),
    close: () => fire('close'),
    addEventListener: (type: string, listener: (event: { readonly data: unknown }) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
  }
  function fire(type: string, event: { readonly data: unknown } = { data: undefined }) {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }
  return { socket, sent, fire }
}

describe('CDP connection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function connected() {
    const fake = fakeSocket()
    const connecting = CdpConnection.connect('ws://127.0.0.1:1/devtools/page/x', {
      openSocket: () => fake.socket,
      commandTimeoutMs: 100,
    })
    fake.fire('open')
    return { ...fake, cdp: await connecting }
  }

  it('answers commands by id and passes events on', async () => {
    const { cdp, sent, fire } = await connected()
    const events: string[] = []
    cdp.onEvent((method) => events.push(method))
    const result = cdp.send('Page.enable')
    fire('message', { data: JSON.stringify({ method: 'Page.loadEventFired', params: {} }) })
    fire('message', { data: JSON.stringify({ id: 1, result: { ok: true } }) })
    await expect(result).resolves.toEqual({ ok: true })
    expect(JSON.parse(sent[0] ?? '')).toEqual({ id: 1, method: 'Page.enable', params: {} })
    expect(events).toEqual(['Page.loadEventFired'])
  })

  it('rejects a command that times out, fails, or outlives the socket', async () => {
    const { cdp, fire } = await connected()
    const timedOut = cdp.send('Page.reload')
    const rejectedTimeout = expect(timedOut).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(150)
    await rejectedTimeout

    const failed = cdp.send('Page.navigate')
    fire('message', { data: JSON.stringify({ id: 2, error: { message: 'bad url' } }) })
    await expect(failed).rejects.toThrow('Page.navigate: bad url')

    const pending = cdp.send('Page.stopLoading')
    fire('close')
    await expect(pending).rejects.toThrow(/closed/)
    expect(cdp.isOpen).toBe(false)
    await expect(cdp.send('Page.enable')).rejects.toThrow(/closed/)
  })

  it('fails to connect when the socket closes before it opens', async () => {
    const fake = fakeSocket()
    const connecting = CdpConnection.connect('ws://127.0.0.1:1/devtools/page/x', {
      openSocket: () => fake.socket,
      commandTimeoutMs: 100,
    })
    fake.fire('error')
    await expect(connecting).rejects.toThrow(/could not connect/)
  })
})
