import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../../extensions/types'
import { ExtensionLifecycleRepository } from '../../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../../ports/extension-project-overrides-repository'
import { ProviderService } from '../../../ports/provider-service'
import { ProviderServiceLive, supportsPiApiKeyAuthProvider } from '../pi-provider-service'
import {
  createTempProject,
  fs,
  path,
  writeThrowingProviderPackage,
} from './pi-provider-catalog.test-utils'

function discoveredPackage(projectPath: string): DiscoveredExtensionPackage {
  const packagePath = path.join(projectPath, '.openwaggle', 'extensions', 'broken-extension')
  return {
    id: 'broken-extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
    packagePath,
    manifestPath: path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE),
    manifest: {
      manifestVersion: 1,
      id: 'broken-extension',
      name: 'Broken Extension',
      version: '1.0.0',
      sdk: { openwaggle: '>=0.1.0 <0.2.0' },
      sourceFiles: ['src/provider.js'],
      builtArtifacts: ['extensions/provider.js'],
    },
    buildPlan: null,
    contentHash: 'abcdef',
    sdkCompatibility: {
      hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
      requiredRange: '>=0.1.0 <0.2.0',
      compatible: true,
    },
    diagnostics: [],
  }
}

function lifecycleState(projectPath: string): ExtensionLifecycleState {
  return {
    extensionId: 'broken-extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
    enabled: true,
    trusted: true,
    grantedCapabilities: [],
    contentHash: 'abcdef',
    packageVersion: '1.0.0',
    approvedBuildPlanHash: null,
    buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
    buildLog: null,
    reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
    lastReloadedAt: 3000,
    sdkRange: '>=0.1.0 <0.2.0',
    sdkCompatible: true,
    diagnostics: [],
    installedAt: 1000,
    updatedAt: 2000,
  }
}

function providerServiceLayer(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState
}) {
  let storedLifecycle = input.lifecycle
  const extensionSelectionLayer = Layer.mergeAll(
    Layer.succeed(ExtensionManagerService, {
      listPackages: () => Effect.succeed([input.extensionPackage]),
    }),
    Layer.succeed(ExtensionLifecycleRepository, {
      get: () => Effect.sync(() => storedLifecycle),
      list: () => Effect.sync(() => [storedLifecycle]),
      upsert: (state) =>
        Effect.sync(() => {
          storedLifecycle = state
        }),
    }),
    Layer.succeed(ExtensionProjectOverridesRepository, {
      get: () => Effect.succeed(null),
      upsert: () => Effect.void,
    }),
  )

  return {
    layer: ProviderServiceLive.pipe(Layer.provide(extensionSelectionLayer)),
    getStoredLifecycle: () => storedLifecycle,
  }
}

describe('supportsPiApiKeyAuthProvider', () => {
  const oauthProviders = new Set([
    'anthropic',
    'github-copilot',
    'google-antigravity',
    'google-gemini-cli',
    'openai-codex',
  ])
  const builtInModelProviders = new Set([
    'anthropic',
    'deepseek',
    'github-copilot',
    'google-antigravity',
    'google-gemini-cli',
    'openai',
    'openai-codex',
    'openrouter',
  ])

  it('keeps Pi OAuth-only providers out of the API-key auth section', () => {
    expect(
      supportsPiApiKeyAuthProvider('openai-codex', 'none', oauthProviders, builtInModelProviders),
    ).toBe(false)
    expect(
      supportsPiApiKeyAuthProvider('github-copilot', 'none', oauthProviders, builtInModelProviders),
    ).toBe(false)
    expect(
      supportsPiApiKeyAuthProvider(
        'google-antigravity',
        'none',
        oauthProviders,
        builtInModelProviders,
      ),
    ).toBe(false)
    expect(
      supportsPiApiKeyAuthProvider(
        'google-gemini-cli',
        'none',
        oauthProviders,
        builtInModelProviders,
      ),
    ).toBe(false)
  })

  it('keeps providers with Pi API-key auth in the API-key auth section', () => {
    expect(
      supportsPiApiKeyAuthProvider('anthropic', 'none', oauthProviders, builtInModelProviders),
    ).toBe(true)
    expect(
      supportsPiApiKeyAuthProvider('deepseek', 'none', oauthProviders, builtInModelProviders),
    ).toBe(true)
    expect(
      supportsPiApiKeyAuthProvider('openai', 'none', oauthProviders, builtInModelProviders),
    ).toBe(true)
    expect(
      supportsPiApiKeyAuthProvider('openrouter', 'none', oauthProviders, builtInModelProviders),
    ).toBe(true)
  })

  it('treats custom non-OAuth model providers as Pi API-key login providers', () => {
    expect(
      supportsPiApiKeyAuthProvider(
        'private-gateway',
        'none',
        oauthProviders,
        builtInModelProviders,
      ),
    ).toBe(true)
  })

  it('keeps configured custom auth visible even when provider metadata changes', () => {
    expect(
      supportsPiApiKeyAuthProvider(
        'private-oauth',
        'environment-or-custom',
        new Set(['private-oauth']),
        builtInModelProviders,
      ),
    ).toBe(true)
    expect(
      supportsPiApiKeyAuthProvider(
        'private-oauth',
        'api-key',
        new Set(['private-oauth']),
        builtInModelProviders,
      ),
    ).toBe(true)
  })
})

describe('ProviderServiceLive OpenWaggle extension failure isolation', () => {
  it('disables a throwing runtime extension package and still returns the provider catalog', async () => {
    const projectPath = await createTempProject()
    const extensionPackage = discoveredPackage(projectPath)
    const harness = providerServiceLayer({
      extensionPackage,
      lifecycle: lifecycleState(projectPath),
    })

    try {
      await writeThrowingProviderPackage(
        projectPath,
        path.join('.openwaggle', 'extensions', 'broken-extension'),
      )

      const providers = await Effect.runPromise(
        Effect.gen(function* () {
          const providerService = yield* ProviderService
          return yield* providerService.getAll(projectPath)
        }).pipe(Effect.provide(harness.layer)),
      )

      expect(providers.length).toBeGreaterThan(0)
      expect(harness.getStoredLifecycle()).toMatchObject({
        extensionId: 'broken-extension',
        enabled: false,
        reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.FAILED,
        diagnostics: [
          expect.objectContaining({
            severity: 'error',
            code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.RUNTIME_LOAD_FAILED,
          }),
        ],
      })
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })
})
