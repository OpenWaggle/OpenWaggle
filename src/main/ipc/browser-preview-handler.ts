import { safeDecodeUnknown } from '@shared/schema'
import {
  browserImportInputSchema,
  guidedBrowserImportInputSchema,
} from '@shared/schemas/browser-import'
import {
  browserPreviewIdAndBoundsSchema,
  browserPreviewIdAndUrlSchema,
  browserPreviewIdAndZoomActionSchema,
  browserPreviewIdSchema,
  browserPreviewOpenInputSchema,
  browserPreviewOwnerKeySchema,
  browserPreviewShortcutBindingsSchema,
} from '@shared/schemas/browser-preview'
import {
  browserPreviewOpenRequestAckSchema,
  browserPreviewOwnerSelectionSchema,
} from '@shared/schemas/browser-preview-owner'
import { browserProfileIdSchema } from '@shared/schemas/browser-profile'
import { resolveBrowserProfiles } from '@shared/types/browser-profile'
import * as Effect from 'effect/Effect'
import type { Schema as EffectSchema } from 'effect/Schema'
import {
  getGuiBrowserProfiles,
  updateGuiBrowserProfiles,
} from '../application/gui-browser-profile-settings'
import { recordUsageStatisticsObservation } from '../application/usage-statistics-recording'
import { createBrowserCookieImporter } from '../browser-import/browser-cookie-importer'
import { openBrowserImportFullDiskAccessSettings } from '../browser-import/browser-import-system-settings'
import { createGuidedBrowserImporter } from '../browser-import/guided-browser-import'
import { browserPreviewViews } from '../desktop-shell/browser-preview-views'
import { SettingsService, type SettingsServiceShape } from '../services/settings-service'
import { registerBrowserPreviewControlHandlers } from './browser-preview-control-handler'
import { typedHandle } from './typed-ipc'

interface BrowserImportServices {
  readonly cookies: ReturnType<typeof createBrowserCookieImporter>
  readonly guided: ReturnType<typeof createGuidedBrowserImporter>
}

const browserImportServices = new WeakMap<SettingsServiceShape, BrowserImportServices>()

function browserImportServicesFor(settings: SettingsServiceShape) {
  const existing = browserImportServices.get(settings)
  if (existing) return existing

  const cookies = createBrowserCookieImporter({
    getTargetProfiles: async () => resolveBrowserProfiles(await getGuiBrowserProfiles(settings)),
  })
  const guided = createGuidedBrowserImporter({
    getConfiguredProfiles: () => getGuiBrowserProfiles(settings),
    updateConfiguredProfiles: (profiles) => updateGuiBrowserProfiles(settings, profiles),
    importCookiesIntoPreparedProfile: cookies.importCookiesIntoPreparedProfile,
    clearProfileData: (profileId) => browserPreviewViews.clearProfileData(profileId),
  })
  const created = { cookies, guided }
  browserImportServices.set(settings, created)
  return created
}

function decode<T, I>(schema: EffectSchema<T, I>, value: unknown) {
  const decoded = safeDecodeUnknown(schema, value)
  return decoded.success
    ? Effect.succeed(decoded.data)
    : Effect.fail(new Error(decoded.issues.join('; ')))
}

function registerBrowserPreviewNavigationHandlers() {
  typedHandle('browser-preview:open', (event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decode(browserPreviewOpenInputSchema, input)
      const opened = yield* Effect.sync(() => browserPreviewViews.open(event.sender, decoded))
      yield* recordUsageStatisticsObservation({ kind: 'feature', flag: 'browser_preview' })
      return opened
    }),
  )

  typedHandle('browser-preview:set-bounds', (event, previewId: unknown, bounds: unknown) =>
    Effect.gen(function* () {
      const [decodedPreviewId, decodedBounds] = yield* decode(browserPreviewIdAndBoundsSchema, [
        previewId,
        bounds,
      ])
      yield* Effect.sync(() =>
        browserPreviewViews.setBounds(event.sender, decodedPreviewId, decodedBounds),
      )
    }),
  )

  typedHandle('browser-preview:navigate', (event, previewId: unknown, url: unknown) =>
    Effect.gen(function* () {
      const [decodedPreviewId, decodedUrl] = yield* decode(browserPreviewIdAndUrlSchema, [
        previewId,
        url,
      ])
      return yield* Effect.sync(() =>
        browserPreviewViews.navigate(event.sender, decodedPreviewId, decodedUrl),
      )
    }),
  )

  typedHandle('browser-preview:go-back', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const decodedPreviewId = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.sync(() => browserPreviewViews.goBack(event.sender, decodedPreviewId))
    }),
  )

  typedHandle('browser-preview:go-forward', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const decodedPreviewId = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.sync(() => browserPreviewViews.goForward(event.sender, decodedPreviewId))
    }),
  )

  typedHandle('browser-preview:reload', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const decodedPreviewId = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.sync(() => browserPreviewViews.reload(event.sender, decodedPreviewId))
    }),
  )

  typedHandle('browser-preview:stop', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const decodedPreviewId = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.sync(() => browserPreviewViews.stop(event.sender, decodedPreviewId))
    }),
  )

  typedHandle('browser-preview:close', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const decodedPreviewId = yield* decode(browserPreviewIdSchema, previewId)
      yield* Effect.tryPromise({
        try: () => browserPreviewViews.close(event.sender, decodedPreviewId),
        catch: (error) => error,
      })
    }),
  )

  typedHandle('browser-preview:zoom', (event, previewId: unknown, action: unknown) =>
    Effect.gen(function* () {
      const [decodedPreviewId, decodedAction] = yield* decode(browserPreviewIdAndZoomActionSchema, [
        previewId,
        action,
      ])
      return yield* Effect.sync(() =>
        browserPreviewViews.zoom(event.sender, decodedPreviewId, decodedAction),
      )
    }),
  )

  typedHandle('browser-preview:set-shortcut-bindings', (event, bindings: unknown) =>
    Effect.gen(function* () {
      const decodedBindings = yield* decode(browserPreviewShortcutBindingsSchema, bindings)
      yield* Effect.sync(() =>
        browserPreviewViews.setShortcutBindings(event.sender, decodedBindings),
      )
    }),
  )
}

function registerBrowserPreviewOwnerHandlers() {
  typedHandle('browser-preview:register-owner', (event, ownerKey: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decode(browserPreviewOwnerKeySchema, ownerKey)
      yield* Effect.sync(() => browserPreviewViews.registerOwner(decoded, event.sender))
    }),
  )

  typedHandle('browser-preview:unregister-owner', (event, ownerKey: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decode(browserPreviewOwnerKeySchema, ownerKey)
      yield* Effect.sync(() => browserPreviewViews.unregisterOwner(decoded, event.sender))
      yield* Effect.sync(() => browserPreviewViews.forgetOwnerSelection(event.sender, decoded))
    }),
  )

  typedHandle('browser-preview:ack-open-request', (event, acknowledgment: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decode(browserPreviewOpenRequestAckSchema, acknowledgment)
      yield* Effect.sync(() => browserPreviewViews.acknowledgeOpenRequest(event.sender, decoded))
    }),
  )

  typedHandle('browser-preview:set-current', (event, ownerKey: unknown, previewId: unknown) =>
    Effect.gen(function* () {
      const [decodedOwnerKey, decodedPreviewId] = yield* decode(
        browserPreviewOwnerSelectionSchema,
        [ownerKey, previewId],
      )
      yield* Effect.sync(() =>
        browserPreviewViews.setCurrentPreview(event.sender, decodedOwnerKey, decodedPreviewId),
      )
    }),
  )
}

function registerBrowserPreviewImportHandlers() {
  typedHandle('browser-preview:list-import-sources', () =>
    Effect.gen(function* () {
      const settings = yield* SettingsService
      return yield* Effect.tryPromise(() =>
        browserImportServicesFor(settings).cookies.listSources(),
      )
    }),
  )

  typedHandle('browser-preview:import-cookies', (_event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decode(browserImportInputSchema, input)
      const settings = yield* SettingsService
      return yield* Effect.tryPromise(() =>
        browserImportServicesFor(settings).cookies.importCookies(decoded),
      )
    }),
  )

  typedHandle('browser-preview:guided-import-cookies', (_event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decode(guidedBrowserImportInputSchema, input)
      const settings = yield* SettingsService
      return yield* Effect.promise(() =>
        browserImportServicesFor(settings).guided.importCookies(decoded),
      )
    }),
  )

  typedHandle('browser-preview:open-full-disk-access-settings', () =>
    Effect.promise(() => openBrowserImportFullDiskAccessSettings()),
  )

  typedHandle('browser-preview:clear-profile-data', (_event, profileId: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decode(browserProfileIdSchema, profileId)
      const settings = yield* SettingsService
      const configuredProfiles = resolveBrowserProfiles(
        yield* Effect.tryPromise(() => getGuiBrowserProfiles(settings)),
      )
      if (!configuredProfiles.some((profile) => profile.id === decoded)) {
        return yield* Effect.fail(new Error('The selected browser profile does not exist.'))
      }
      yield* Effect.tryPromise(() => browserPreviewViews.clearProfileData(decoded))
    }),
  )
}

export function registerBrowserPreviewHandlers(): void {
  registerBrowserPreviewControlHandlers()
  registerBrowserPreviewNavigationHandlers()
  registerBrowserPreviewOwnerHandlers()
  registerBrowserPreviewImportHandlers()
}
