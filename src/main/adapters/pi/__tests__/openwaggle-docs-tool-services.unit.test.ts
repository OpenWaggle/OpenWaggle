import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { DocsBundleError } from '../../../errors'
import type { DocsBundleServiceShape } from '../../../ports/docs-bundle-service'
import type { ExtensionLifecycleRepositoryShape } from '../../../ports/extension-lifecycle-repository'
import type { ExtensionManagerServiceShape } from '../../../ports/extension-manager-service'

const warnings = vi.hoisted((): { calls: string[] } => ({ calls: [] }))

vi.mock('../../../logger', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../logger')>()
  return {
    ...original,
    createLogger: (namespace: string) => ({
      ...original.createLogger(namespace),
      warn: (message: string) => {
        warnings.calls.push(message)
      },
    }),
  }
})

const { createOpenWaggleDocsToolServices } = await import('../openwaggle-docs-tool-services')

const BUNDLE_PATH = '/resources/openwaggle-docs'

function services(docsBundle: Partial<DocsBundleServiceShape>) {
  return createOpenWaggleDocsToolServices({
    docsBundle: fromPartial<DocsBundleServiceShape>({
      getBundlePath: () => Effect.succeed(BUNDLE_PATH),
      ...docsBundle,
    }),
    extensionManager: fromPartial<ExtensionManagerServiceShape>({
      listPackages: () => Effect.succeed([]),
    }),
    extensionLifecycle: fromPartial<ExtensionLifecycleRepositoryShape>({}),
  })
}

describe('createOpenWaggleDocsToolServices', () => {
  it('names the bundle root only when the bundle loads', async () => {
    const loaded = services({
      loadBundle: () => Effect.succeed({ bundlePath: BUNDLE_PATH, generatedAt: 'now', topics: [] }),
    })
    expect(await Effect.runPromise(loaded.availableBundlePath())).toBe(BUNDLE_PATH)
    expect(await Effect.runPromise(loaded.discover({ projectPaths: ['/repo'] }))).toMatchObject({
      bundlePath: BUNDLE_PATH,
      firstPartyTopics: [],
      extensionTopics: [],
    })
  })

  it('turns a missing bundle into null and reports it once per process', async () => {
    const missing = services({
      loadBundle: () =>
        Effect.fail(new DocsBundleError({ operation: 'load-installed-docs', cause: 'ENOENT' })),
    })
    expect(await Effect.runPromise(missing.availableBundlePath())).toBeNull()
    expect(await Effect.runPromise(missing.availableBundlePath())).toBeNull()
    expect(warnings.calls).toEqual([
      'The installed OpenWaggle docs bundle is unavailable for agent Runs',
    ])
  })
})
