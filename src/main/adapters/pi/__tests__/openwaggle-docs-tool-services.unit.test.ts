import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocsBundleError } from '../../../errors'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../../extensions/types'
import type { DocsBundleServiceShape } from '../../../ports/docs-bundle-service'
import type { OpenWagglePiExtensionSelectionServices } from '../openwaggle-pi-extension-selection'

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
const PROJECT_PATH = '/repo'
const PACKAGE_HASH = 'package-hash'
const NOW = 1_798_761_600_000
let tempDir: string | null = null

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

async function extensionPackage(): Promise<DiscoveredExtensionPackage> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'ow-docs-services-'))
  const packagePath = path.join(tempDir, 'deploy')
  await mkdir(path.join(packagePath, 'docs'), { recursive: true })
  await writeFile(path.join(packagePath, 'docs', 'usage.md'), '# Deploy\n')
  return {
    id: 'acme.deploy',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    packagePath,
    manifestPath: path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE),
    manifest: {
      manifestVersion: 1,
      id: 'acme.deploy',
      name: 'Acme Deploy',
      version: '1.0.0',
      sdk: { openwaggle: OPENWAGGLE_EXTENSION.SDK_VERSION },
      sourceFiles: [],
      builtArtifacts: [],
      docs: { topics: [{ id: 'usage', title: 'Deploy usage', path: 'docs/usage.md' }] },
    },
    buildPlan: null,
    contentHash: PACKAGE_HASH,
    sdkCompatibility: {
      hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
      requiredRange: OPENWAGGLE_EXTENSION.SDK_VERSION,
      compatible: true,
    },
    diagnostics: [],
  }
}

function enabledLifecycle(extension: DiscoveredExtensionPackage): ExtensionLifecycleState {
  return {
    extensionId: extension.id,
    scope: extension.scope,
    enabled: true,
    trusted: true,
    grantedCapabilities: [],
    contentHash: PACKAGE_HASH,
    packageVersion: '1.0.0',
    approvedBuildPlanHash: null,
    buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
    buildLog: null,
    reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
    lastReloadedAt: NOW,
    sdkRange: OPENWAGGLE_EXTENSION.SDK_VERSION,
    sdkCompatible: true,
    diagnostics: [],
    installedAt: NOW,
    updatedAt: NOW,
  }
}

function services(
  docsBundle: Partial<DocsBundleServiceShape>,
  extensionSelection: Partial<OpenWagglePiExtensionSelectionServices> = {},
) {
  return createOpenWaggleDocsToolServices({
    docsBundle: fromPartial<DocsBundleServiceShape>({
      getBundlePath: () => Effect.succeed(BUNDLE_PATH),
      loadBundle: () => Effect.succeed({ bundlePath: BUNDLE_PATH, generatedAt: 'now', topics: [] }),
      ...docsBundle,
    }),
    extensionSelection: fromPartial<OpenWagglePiExtensionSelectionServices>({
      manager: fromPartial({ listPackages: () => Effect.succeed([]) }),
      ...extensionSelection,
    }),
  })
}

async function extensionServices(disabledForProject: boolean) {
  const extension = await extensionPackage()
  return services(
    {},
    {
      manager: fromPartial({ listPackages: () => Effect.succeed([extension]) }),
      lifecycleRepository: fromPartial({ get: () => Effect.succeed(enabledLifecycle(extension)) }),
      projectOverridesRepository: fromPartial({
        get: () => Effect.succeed(disabledForProject ? fromPartial({ disabled: true }) : null),
      }),
    },
  )
}

describe('createOpenWaggleDocsToolServices', () => {
  it('names the bundle root only when the bundle loads', async () => {
    expect(await Effect.runPromise(services({}).availableBundlePath())).toBe(BUNDLE_PATH)
  })

  it('offers docs of extensions the Run loads and not of one disabled for the project', async () => {
    const input = { projectPaths: [PROJECT_PATH] }
    const enabled = await Effect.runPromise((await extensionServices(false)).discover(input))
    expect(enabled.extensionTopics.map((topic) => topic.topic)).toEqual([
      'extension:acme.deploy/usage',
    ])
    const disabled = await Effect.runPromise((await extensionServices(true)).discover(input))
    expect(disabled.extensionTopics).toEqual([])
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
