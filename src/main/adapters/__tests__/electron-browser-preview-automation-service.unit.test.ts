import { SessionId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import type { Effect as EffectType } from 'effect/Effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createOwner,
  createWindow,
  getBrowserPreviewElectronMocks,
  getBrowserPreviewOwnerRegistryMock,
} from '../../__tests__/browser-preview-test-harness'
import type { BrowserPreviewAutomationServiceShape } from '../../ports/browser-preview-automation-service'
import type { SettingsServiceShape } from '../../services/settings-service'

const { browserPreviewManager } = await import('../../browser-preview')
const { makeBrowserPreviewAutomationService } = await import(
  '../electron-browser-preview-automation-service'
)

const scope = { sessionId: SessionId('session-automation'), workingPath: '/project' }

function settingsService() {
  return fromPartial<SettingsServiceShape>({
    get: () => Effect.succeed(DEFAULT_SETTINGS),
  })
}

const invalidRequests: readonly (readonly [string, () => EffectType<unknown, Error>])[] = [
  ['open', () => makeBrowserPreviewAutomationService(settingsService()).open(scope, {})],
  ['navigate', () => makeBrowserPreviewAutomationService(settingsService()).navigate(scope, {})],
  [
    'resize',
    () =>
      makeBrowserPreviewAutomationService(settingsService()).resize(scope, {
        mode: 'freeform',
        width: 1,
        height: 1,
      }),
  ],
]

function automationOperations(
  service: BrowserPreviewAutomationServiceShape,
): readonly (readonly [string, () => EffectType<unknown, Error>])[] {
  return [
    ['status', () => service.status(scope, {})],
    ['open', () => service.open(scope, { url: 'localhost:5173' })],
    ['navigate', () => service.navigate(scope, { url: 'localhost:5173' })],
    ['resize', () => service.resize(scope, { mode: 'fill' })],
    ['appearance', () => service.setAppearance(scope, { colorScheme: 'system' })],
    ['snapshot', () => service.snapshot(scope, {})],
    ['click', () => service.click(scope, { x: 1, y: 1 })],
    ['type', () => service.type(scope, { text: 'hello' })],
    ['press', () => service.press(scope, { key: 'Enter' })],
    ['scroll', () => service.scroll(scope, { deltaY: 1 })],
    ['evaluate', () => service.evaluate(scope, { expression: 'document.title' })],
    ['wait', () => service.waitFor(scope, { text: 'ready' })],
    ['recording start', () => service.startRecording(scope, {})],
    ['recording stop', () => service.stopRecording(scope, {})],
  ]
}

describe('Electron browser preview automation service', () => {
  beforeEach(() => {
    getBrowserPreviewElectronMocks().createdViews.length = 0
    getBrowserPreviewElectronMocks().windowFromWebContents.mockReset()
  })

  it('materializes background previews with the inferred default profile and tracks current tabs', async () => {
    const { owner } = createOwner()
    const { window } = createWindow()
    getBrowserPreviewElectronMocks().windowFromWebContents.mockReturnValue(window)
    getBrowserPreviewOwnerRegistryMock().requestOpen.mockImplementation(async (request) => {
      browserPreviewManager.open(owner, {
        previewId: request.previewId,
        ownerKey: request.ownerKey,
        profileId: request.profileId,
        url: request.url,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: request.visible,
      })
    })
    const service = makeBrowserPreviewAutomationService(settingsService())

    const first = await Effect.runPromise(
      service.open(scope, { url: 'localhost:5173', open: false }),
    )
    const second = await Effect.runPromise(
      service.open(scope, {
        url: 'localhost:4173',
        open: false,
        reuseExistingTab: false,
      }),
    )
    const current = await Effect.runPromise(service.status(scope, {}))

    expect(first).toMatchObject({ available: true, visible: false })
    expect(second).toMatchObject({ available: true, visible: false })
    expect(second.tabId).not.toBe(first.tabId)
    expect(current.tabId).toBe(second.tabId)
    expect(
      browserPreviewManager.findOwnedPreview(String(scope.sessionId), first.tabId ?? undefined)
        ?.profileId,
    ).toBe(DEFAULT_SETTINGS.browserDefaultProfileId)

    if (first.tabId) browserPreviewManager.close(owner, first.tabId)
    if (second.tabId) browserPreviewManager.close(owner, second.tabId)
  })

  it('reads the auto-show default for every open while explicit visibility still wins', async () => {
    const { owner } = createOwner(18)
    const { window } = createWindow()
    getBrowserPreviewElectronMocks().windowFromWebContents.mockReturnValue(window)
    getBrowserPreviewOwnerRegistryMock().requestOpen.mockImplementation(async (request) => {
      browserPreviewManager.open(owner, {
        previewId: request.previewId,
        ownerKey: request.ownerKey,
        profileId: request.profileId,
        url: request.url,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: request.visible,
      })
    })
    let autoShow = false
    const service = makeBrowserPreviewAutomationService(
      fromPartial<SettingsServiceShape>({
        get: () =>
          Effect.succeed({ ...DEFAULT_SETTINGS, browserAutoShowFloatingPreview: autoShow }),
      }),
    )

    const hidden = await Effect.runPromise(
      service.open(scope, { url: 'localhost:5173', reuseExistingTab: false }),
    )
    autoShow = true
    const visible = await Effect.runPromise(
      service.open(scope, { url: 'localhost:4173', reuseExistingTab: false }),
    )
    const explicitlyHidden = await Effect.runPromise(
      service.open(scope, {
        url: 'localhost:3000',
        open: false,
        reuseExistingTab: false,
      }),
    )

    expect(hidden.visible).toBe(false)
    expect(visible.visible).toBe(true)
    expect(explicitlyHidden.visible).toBe(false)

    for (const result of [hidden, visible, explicitlyHidden]) {
      if (result.tabId) browserPreviewManager.close(owner, result.tabId)
    }
  })

  it('does not materialize a preview when its saved browser defaults cannot be read', async () => {
    const requestOpen = getBrowserPreviewOwnerRegistryMock().requestOpen
    requestOpen.mockClear()
    let settingsRead = 0
    const service = makeBrowserPreviewAutomationService(
      fromPartial<SettingsServiceShape>({
        get: () => {
          settingsRead += 1
          return settingsRead === 1
            ? Effect.succeed(DEFAULT_SETTINGS)
            : Effect.die(new Error('settings storage unavailable'))
        },
      }),
    )

    const result = await Effect.runPromise(
      Effect.either(service.open(scope, { url: 'localhost:5173', open: false })),
    )

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left).toEqual(new Error('Browser preview preferences could not be verified.'))
    }
    expect(requestOpen).not.toHaveBeenCalled()
  })

  it.each(invalidRequests)(
    'reports invalid %s requests through the typed error channel',
    async (_name, run) => {
      const result = await Effect.runPromise(Effect.either(run()))

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') expect(result.left).toBeInstanceOf(Error)
    },
  )

  it('revokes every captured operation when agent browser access is disabled', async () => {
    let accessEnabled = true
    const settings = fromPartial<SettingsServiceShape>({
      get: () => Effect.succeed({ ...DEFAULT_SETTINGS, enableAgentBrowserAccess: accessEnabled }),
    })
    const service = makeBrowserPreviewAutomationService(settings)

    await expect(Effect.runPromise(service.status(scope, {}))).resolves.toMatchObject({
      available: false,
    })
    accessEnabled = false

    for (const [name, run] of automationOperations(service)) {
      const result = await Effect.runPromise(Effect.either(run()))
      expect(result._tag, name).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left.message, name).toBe('Agent browser access is disabled.')
      }
    }
  })

  it('fails closed when browser-access settings cannot be read', async () => {
    const service = makeBrowserPreviewAutomationService(
      fromPartial<SettingsServiceShape>({
        get: () => Effect.die(new Error('settings unavailable')),
      }),
    )

    const result = await Effect.runPromise(Effect.either(service.status(scope, {})))

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left.message).toBe('Agent browser access could not be verified.')
    }
  })
})
