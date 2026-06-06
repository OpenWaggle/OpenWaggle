import type { AgentSessionServices } from '@earendil-works/pi-coding-agent'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../../extensions/types'
import { ExtensionLifecycleRepository } from '../../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../../ports/extension-project-overrides-repository'
import { ProviderProbeService } from '../../../ports/provider-probe-service'

interface RuntimeServicesOptions {
  readonly enabledOpenWaggleExtensionPackagePaths: readonly string[]
  readonly loadMcpAdapter: boolean
}

type RuntimeServicesLoader = (
  cwd: string,
  options: RuntimeServicesOptions,
) => Promise<AgentSessionServices>

interface FakeAgentSession {
  readonly prompt: (
    prompt: string,
    options: { readonly expandPromptTemplates: false },
  ) => Promise<void>
  readonly abort: () => Promise<void>
  readonly dispose: () => void
}

type AgentSessionFactory = (input: {
  readonly services: AgentSessionServices
  readonly model: unknown
  readonly sessionManager: unknown
  readonly noTools: 'all'
}) => Promise<{ readonly session: FakeAgentSession }>

const probeMocks = vi.hoisted(() => ({
  createAgentSessionFromServices: vi.fn<AgentSessionFactory>(),
  createPiRuntimeServices: vi.fn<RuntimeServicesLoader>(),
  prompt: vi.fn<FakeAgentSession['prompt']>(async () => undefined),
  abort: vi.fn<FakeAgentSession['abort']>(async () => undefined),
  dispose: vi.fn<FakeAgentSession['dispose']>(),
  sessionManagerInMemory: vi.fn<() => unknown>(() => ({ kind: 'in-memory-session-manager' })),
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSessionFromServices: probeMocks.createAgentSessionFromServices,
  SessionManager: {
    inMemory: probeMocks.sessionManagerInMemory,
  },
}))

vi.mock('../pi-provider-catalog', () => ({
  createPiRuntimeServices: probeMocks.createPiRuntimeServices,
}))

import { PiProviderProbeLive } from '../pi-provider-probe-adapter'

interface PiExtensionLoadErrorFixture {
  readonly path: string
  readonly error: string
}

function discoveredPackage(projectPath: string): DiscoveredExtensionPackage {
  const packagePath = `${projectPath}/.openwaggle/extensions/broken-extension`
  return {
    id: 'broken-extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
    packagePath,
    manifestPath: `${packagePath}/${OPENWAGGLE_EXTENSION.MANIFEST_FILE}`,
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
    reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
    lastReloadedAt: null,
    sdkRange: '>=0.1.0 <0.2.0',
    sdkCompatible: true,
    diagnostics: [],
    installedAt: 1000,
    updatedAt: 2000,
  }
}

function piServices(loadErrors: readonly PiExtensionLoadErrorFixture[] = []) {
  return fromPartial<AgentSessionServices>({
    resourceLoader: {
      getExtensions: () => ({
        errors: loadErrors,
      }),
    },
    authStorage: {
      setRuntimeApiKey: () => undefined,
    },
    modelRegistry: {
      find: () => ({ id: 'offline-model' }),
    },
  })
}

function probeLayer(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly getStoredLifecycle: () => ExtensionLifecycleState
  readonly setStoredLifecycle: (state: ExtensionLifecycleState) => void
}) {
  const extensionSelectionLayer = Layer.mergeAll(
    Layer.succeed(ExtensionManagerService, {
      listPackages: () => Effect.succeed([input.extensionPackage]),
    }),
    Layer.succeed(ExtensionLifecycleRepository, {
      get: () => Effect.sync(input.getStoredLifecycle),
      list: () => Effect.sync(() => [input.getStoredLifecycle()]),
      upsert: (state) =>
        Effect.sync(() => {
          input.setStoredLifecycle(state)
        }),
    }),
    Layer.succeed(ExtensionProjectOverridesRepository, {
      get: () => Effect.succeed(null),
      upsert: () => Effect.void,
    }),
  )

  return PiProviderProbeLive.pipe(Layer.provide(extensionSelectionLayer))
}

describe('PiProviderProbeLive extension failure isolation', () => {
  beforeEach(() => {
    probeMocks.createAgentSessionFromServices.mockReset()
    probeMocks.createPiRuntimeServices.mockReset()
    probeMocks.prompt.mockClear()
    probeMocks.abort.mockClear()
    probeMocks.dispose.mockClear()
    probeMocks.sessionManagerInMemory.mockClear()
    probeMocks.createAgentSessionFromServices.mockResolvedValue({
      session: {
        prompt: probeMocks.prompt,
        abort: probeMocks.abort,
        dispose: probeMocks.dispose,
      },
    })
  })

  it('retries only Pi runtime startup and sends the provider probe prompt once', async () => {
    const projectPath = '/tmp/openwaggle-provider-probe'
    const extensionPackage = discoveredPackage(projectPath)
    const packagePath = extensionPackage.packagePath
    let storedLifecycle = lifecycleState(projectPath)

    probeMocks.createPiRuntimeServices.mockImplementation(async (_cwd, options) => {
      if (options.enabledOpenWaggleExtensionPackagePaths.includes(packagePath)) {
        return piServices([
          {
            path: `${packagePath}/extensions/provider.js`,
            error: 'activation failed',
          },
        ])
      }

      return piServices()
    })

    const layer = probeLayer({
      extensionPackage,
      getStoredLifecycle: () => storedLifecycle,
      setStoredLifecycle: (state) => {
        storedLifecycle = state
      },
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const providerProbeService = yield* ProviderProbeService
        yield* providerProbeService.probeCredentials({
          providerId: 'offline-provider',
          modelId: 'offline-model',
          apiKey: 'test-key',
          projectPath,
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(probeMocks.createPiRuntimeServices).toHaveBeenCalledTimes(3)
    expect(probeMocks.createAgentSessionFromServices).toHaveBeenCalledTimes(1)
    expect(probeMocks.prompt).toHaveBeenCalledTimes(1)
    expect(storedLifecycle).toMatchObject({
      enabled: false,
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.FAILED,
      diagnostics: [
        expect.objectContaining({
          code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.RUNTIME_LOAD_FAILED,
        }),
      ],
    })
  })
})
