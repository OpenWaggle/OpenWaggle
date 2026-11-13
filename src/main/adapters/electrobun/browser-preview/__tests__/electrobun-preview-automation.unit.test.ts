import { SessionId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOUNDS,
  lastState,
  onlyView,
  settle,
  setup,
  type Setup,
} from './electrobun-browser-preview-harness'
import { browserPreviewAutomationController } from '../../../browser-preview/automation/browser-preview-automation-control'
import { makeBrowserPreviewAutomationService } from '../../../browser-preview/automation/browser-preview-automation-service'
import type { SettingsServiceShape } from '../../../../services/settings-service'
import { uncheckedFields } from '@shared/utils/object-shape'

vi.mock('../../../../desktop-native-admission', () => ({
  assertDesktopNativeAdmission: () => undefined,
}))

const scope = { sessionId: SessionId('s-agent'), workingPath: '/project' }
const AGENT_OWNER_KEY = String(scope.sessionId)

function automation(harness: Setup) {
  const settings = fromPartial<SettingsServiceShape>({
    get: () => Effect.succeed({ ...DEFAULT_SETTINGS, enableAgentBrowserAccess: true }),
  })
  return makeBrowserPreviewAutomationService(settings, harness.automation)
}

/** The agent's owner page: the Session's chat page registered for its previews. */
function agentHarness() {
  const harness = setup({ ownerKey: AGENT_OWNER_KEY })
  // The chat page answers an open request by opening the preview, as the renderer does.
  const automation: Setup['automation'] = {
    ...harness.automation,
    requestOpen: async (request) => {
      harness.views.open(harness.page.surface, { ...request, bounds: BOUNDS })
    },
  }
  return { ...harness, automation }
}

/** A PNG signature and IHDR header of `width` x `height`, all a screenshot's size is read from. */
function pngHeader(width: number, height: number) {
  const header = Buffer.alloc(29)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'ascii')
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  return header
}

const run = <A>(effect: Effect.Effect<A, Error>) => Effect.runPromise(effect)

describe('Electrobun Browser preview automation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens a preview for the agent and evaluates in its page over the preview’s CDP', async () => {
    const harness = agentHarness()
    harness.cef.respond('Runtime.evaluate', (params) =>
      uncheckedFields<{ expression: string }>(params).expression === 'document.title'
        ? { result: { value: 'Example' } }
        : {},
    )
    const service = automation(harness)

    const opened = await run(service.open(scope, { url: 'https://example.com/' }))
    await settle()
    const evaluated = run(service.evaluate(scope, { expression: 'document.title' }))
    await settle()

    expect(opened).toMatchObject({ available: true, tabId: expect.any(String) })
    await expect(evaluated).resolves.toBe('Example')
    expect(harness.cef.sent('Runtime.enable').length).toBeGreaterThan(0)
    expect(harness.cef.sent('Network.enable')).toHaveLength(1)
    expect(lastState(harness.sent)).toMatchObject({ controller: { kind: 'human' } })
  })

  it('returns the browser engine install failure as the agent open error', async () => {
    const failed = { type: 'failed', reason: 'http', message: 'The server answered 404.' } as const
    const harness = setup({
      ownerKey: AGENT_OWNER_KEY,
      engine: { status: () => failed, ensure: async () => failed },
    })

    await expect(
      run(automation(harness).open(scope, { url: 'https://example.com/' })),
    ).rejects.toThrow('The browser engine is not available: The server answered 404.')
    expect(harness.sent.filter(([channel]) => channel === 'browser-preview:open-request')).toEqual(
      [],
    )
  })

  it('navigates and waits for the load event of the new document', async () => {
    const harness = agentHarness()
    const service = automation(harness)
    await run(service.open(scope, { url: 'https://example.com/' }))
    await settle()

    const navigated = run(service.navigate(scope, { url: 'https://example.com/next' }))
    await settle()

    await expect(navigated).resolves.toMatchObject({ url: 'https://example.com/next' })
    expect(harness.cef.sent('Page.navigate').at(-1)?.params).toEqual({
      url: 'https://example.com/next',
    })
  })

  it('fails a navigation CEF rejects and shows the error on the preview', async () => {
    const harness = agentHarness()
    const service = automation(harness)
    await run(service.open(scope, { url: 'https://example.com/' }))
    await settle()
    harness.cef.respond('Page.navigate', () => ({ frameId: 'main', errorText: 'net::ERR_FAILED' }))

    const failed = expect(
      run(service.navigate(scope, { url: 'https://example.com/down' })),
    ).rejects.toThrow('net::ERR_FAILED')
    await settle()

    await failed
    expect(lastState(harness.sent)).toMatchObject({ loading: false, error: expect.anything() })
  })

  it('treats a navigation another one replaced (net::ERR_ABORTED) as no failure', async () => {
    const harness = agentHarness()
    const service = automation(harness)
    await run(service.open(scope, { url: 'https://example.com/' }))
    await settle()
    harness.cef.respond('Page.navigate', () => ({ frameId: 'main', errorText: 'net::ERR_ABORTED' }))

    const navigated = run(service.navigate(scope, { url: 'https://example.com/replaced' }))
    await settle()

    await expect(navigated).resolves.toMatchObject({ available: true })
    expect(lastState(harness.sent)).toMatchObject({ error: null })
  })

  it('refuses a cached automation page once its owner page retires', async () => {
    const harness = agentHarness()
    const service = automation(harness)
    await run(service.open(scope, { url: 'https://example.com/' }))
    await settle()
    const tab = harness.automation.findTab(AGENT_OWNER_KEY)
    if (tab === undefined) throw new Error('No preview tab')
    const page = harness.automation.page(tab)
    const warmed = browserPreviewAutomationController.run(page, 'warm', async () => 'ready')
    await settle()
    await expect(warmed).resolves.toBe('ready')

    harness.page.close()

    await expect(
      browserPreviewAutomationController.run(page, 'cached', async () => 'reached'),
    ).rejects.toThrow('retired')
  })

  it('snapshots the page with a screenshot captured by CEF', async () => {
    const harness = agentHarness()
    harness.cef.respond('Runtime.evaluate', () => ({
      result: {
        value: {
          url: 'https://example.com/',
          title: 'Example',
          loading: false,
          visibleText: 'Hello',
          interactiveElements: [],
        },
      },
    }))
    const service = automation(harness)
    await run(service.open(scope, { url: 'https://example.com/' }))
    await settle()

    const snapshot = run(service.snapshot(scope, {}))
    await settle()

    await expect(snapshot).resolves.toMatchObject({
      screenshot: { mimeType: 'image/png', width: 2, height: 3 },
    })
    expect(harness.cef.sent('Page.captureScreenshot').length).toBeGreaterThan(0)
  })

  it('captures a large page again at a smaller CDP scale instead of scaling it', async () => {
    const harness = agentHarness()
    harness.cef.respond('Runtime.evaluate', () => ({
      result: {
        value: { url: '', title: '', loading: false, visibleText: '', interactiveElements: [] },
      },
    }))
    harness.cef.respond('Page.captureScreenshot', (params) => ({
      data: Buffer.from(
        uncheckedFields<{ clip: object }>(params).clip
          ? pngHeader(1_024, 768)
          : pngHeader(2_000, 1_500),
      ).toString('base64'),
    }))
    const service = automation(harness)
    await run(service.open(scope, { url: 'https://example.com/' }))
    await settle()

    const snapshot = run(service.snapshot(scope, {}))
    await settle()

    await expect(snapshot).resolves.toMatchObject({ screenshot: { width: 1_024, height: 768 } })
    const clip = uncheckedFields<{ clip: object }>(
      harness.cef.sent('Page.captureScreenshot').at(-1)?.params,
    ).clip
    expect(clip).toMatchObject({ x: 0, y: 0, width: 2, height: 3, scale: 0.512 })
  })

  it('resizes the viewport and refuses recording, which CEF previews lack', async () => {
    const harness = agentHarness()
    const service = automation(harness)
    const opened = await run(service.open(scope, { url: 'https://example.com/' }))
    await settle()

    const resized = await run(service.resize(scope, { mode: 'freeform', width: 390, height: 640 }))

    expect(resized).toMatchObject({ tabId: opened.tabId })
    expect(onlyView(harness).id).toBeGreaterThan(0)
    await expect(run(service.startRecording(scope, {}))).rejects.toThrow('not available')
  })
})
