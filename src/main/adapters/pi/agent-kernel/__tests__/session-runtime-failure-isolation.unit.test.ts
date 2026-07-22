import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEnabledOpenWaggleExtensionPackage } from '../../openwaggle-pi-extension-selection'
import { withPiSession } from '../session-runtime'

interface ProjectRuntimeInput {
  readonly projectPath: string
  readonly modelReference: string
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly enabledOpenWaggleExtensionPackagePaths?: readonly string[]
}

interface PiExtensionLoadErrorFixture {
  readonly path: string
  readonly error: string
}

interface TestRuntimeServices {
  readonly diagnostics: {
    readonly records: readonly unknown[]
  }
  readonly enabledOpenWaggleExtensionPackagePaths: readonly string[]
  readonly resourceLoader: {
    readonly getExtensions: () => {
      readonly errors: readonly PiExtensionLoadErrorFixture[]
    }
  }
}

interface ProjectRuntimeResult {
  readonly model: unknown
  readonly services: TestRuntimeServices
}

interface OpenWaggleSessionOptions {
  readonly services: TestRuntimeServices
  readonly model: unknown
  readonly sessionManager: unknown
}

type ProjectRuntimeLoader = (input: ProjectRuntimeInput) => Promise<ProjectRuntimeResult>
type OpenWaggleSessionCreator = (
  options: OpenWaggleSessionOptions,
) => Promise<{ readonly session: unknown }>

const runtimeMocks = vi.hoisted(() => ({
  createOpenWaggleAgentSessionFromServices: vi.fn<OpenWaggleSessionCreator>(),
  createPiProjectModelRuntime: vi.fn<ProjectRuntimeLoader>(),
  createSessionManagerForSession: vi.fn(),
  disposeOpenWagglePiSession: vi.fn(),
  resolveSessionProjectPath: vi.fn(),
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSessionRuntime: vi.fn(),
  SessionManager: { create: vi.fn() },
}))

vi.mock('../../pi-provider-catalog', () => ({
  createPiProjectModelRuntime: runtimeMocks.createPiProjectModelRuntime,
  getPiAgentDir: vi.fn(),
}))

vi.mock('../../pi-session-lifecycle', () => ({
  createOpenWaggleAgentSessionFromServices: runtimeMocks.createOpenWaggleAgentSessionFromServices,
  disposeOpenWagglePiSession: runtimeMocks.disposeOpenWagglePiSession,
}))

vi.mock('../session-manager', () => ({
  createSessionManagerForSession: runtimeMocks.createSessionManagerForSession,
  resolveSessionProjectPath: runtimeMocks.resolveSessionProjectPath,
}))

const MODEL = SupportedModelId('openai/gpt-5.5')
const session = { sessionId: 'pi-session-1', sessionFile: '/repo/session.jsonl' }
const model = { id: 'gpt-5.5', provider: 'openai', input: ['text'] }
const sessionManager = { id: 'manager-1' }

function input() {
  return {
    session: {
      id: SessionId('session-runtime'),
      title: 'Runtime session',
      projectPath: '/repo',
      piSessionId: 'pi-session-1',
      piSessionFile: '/repo/session.jsonl',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    },
    model: MODEL,
    skillToggles: { audit: true },
  }
}

function enabledExtensionPackage(): RuntimeEnabledOpenWaggleExtensionPackage {
  const packagePath = '/repo/.openwaggle/extensions/broken-extension'
  const scope = { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: '/repo' } as const

  return {
    extensionPackage: {
      id: 'broken-extension',
      scope,
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
    },
    lifecycle: {
      extensionId: 'broken-extension',
      scope,
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
    },
    packagePath,
  }
}

function runtimeServices(
  enabledOpenWaggleExtensionPackagePaths: readonly string[],
  errors: readonly PiExtensionLoadErrorFixture[] = [],
): TestRuntimeServices {
  return {
    diagnostics: { records: [] },
    enabledOpenWaggleExtensionPackagePaths,
    resourceLoader: {
      getExtensions: () => ({ errors }),
    },
  }
}

describe('Pi session runtime extension failure isolation', () => {
  beforeEach(() => {
    runtimeMocks.createOpenWaggleAgentSessionFromServices.mockReset()
    runtimeMocks.createPiProjectModelRuntime.mockReset()
    runtimeMocks.createSessionManagerForSession.mockReset()
    runtimeMocks.disposeOpenWagglePiSession.mockReset()
    runtimeMocks.resolveSessionProjectPath.mockReset()
    runtimeMocks.resolveSessionProjectPath.mockReturnValue('/repo')
    runtimeMocks.createSessionManagerForSession.mockReturnValue(sessionManager)
    runtimeMocks.createPiProjectModelRuntime.mockResolvedValue({
      model,
      services: runtimeServices([]),
    })
    runtimeMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })
  })

  it('falls back to extension-free session startup when a runtime package fails to load', async () => {
    const selection = enabledExtensionPackage()
    const loadFailure = new Error('extension runtime load failed')
    const recordFailure = vi.fn(async () => undefined)
    const operation = vi.fn(async (operationSession: AgentSession) => operationSession.sessionId)

    runtimeMocks.createPiProjectModelRuntime.mockImplementation(async (runtimeInput) => {
      if (runtimeInput.enabledOpenWaggleExtensionPackagePaths?.includes(selection.packagePath)) {
        throw loadFailure
      }

      return {
        model,
        services: runtimeServices(runtimeInput.enabledOpenWaggleExtensionPackagePaths ?? []),
      }
    })

    const result = await withPiSession(
      {
        ...input(),
        enabledOpenWaggleExtensionPackages: [selection],
        recordOpenWaggleExtensionRuntimeFailure: recordFailure,
      },
      operation,
    )

    expect(result).toBe('pi-session-1')
    expect(operation).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.createPiProjectModelRuntime).toHaveBeenCalledTimes(3)
    expect(runtimeMocks.createOpenWaggleAgentSessionFromServices).toHaveBeenCalledTimes(1)
    expect(recordFailure).toHaveBeenCalledWith(selection, loadFailure, 'Pi session initialization')
    expect(runtimeMocks.disposeOpenWagglePiSession).toHaveBeenCalledWith(session)
  })

  it('falls back when Pi records a matching runtime extension load error', async () => {
    const selection = enabledExtensionPackage()
    const recordFailure = vi.fn(async () => undefined)
    const operation = vi.fn(async (operationSession: AgentSession) => operationSession.sessionId)

    runtimeMocks.createPiProjectModelRuntime.mockImplementation(async (runtimeInput) => {
      const errors = runtimeInput.enabledOpenWaggleExtensionPackagePaths?.includes(
        selection.packagePath,
      )
        ? [
            {
              path: `${selection.packagePath}/extensions/provider.js`,
              error: 'provider module load failed',
            },
          ]
        : []

      return {
        model,
        services: runtimeServices(
          runtimeInput.enabledOpenWaggleExtensionPackagePaths ?? [],
          errors,
        ),
      }
    })

    const result = await withPiSession(
      {
        ...input(),
        enabledOpenWaggleExtensionPackages: [selection],
        recordOpenWaggleExtensionRuntimeFailure: recordFailure,
      },
      operation,
    )

    expect(result).toBe('pi-session-1')
    expect(operation).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.createPiProjectModelRuntime).toHaveBeenCalledTimes(3)
    expect(runtimeMocks.createOpenWaggleAgentSessionFromServices).toHaveBeenCalledTimes(1)
    expect(recordFailure).toHaveBeenCalledWith(
      selection,
      expect.objectContaining({ message: expect.stringContaining('provider module load failed') }),
      'Pi session initialization',
    )
  })

  it('falls back without poisoning lifecycle state when extension activation fails', async () => {
    const selection = enabledExtensionPackage()
    const activationFailure = new Error('extension session_start failed')
    const recordFailure = vi.fn(async () => undefined)
    const operation = vi.fn(async (operationSession: AgentSession) => operationSession.sessionFile)

    runtimeMocks.createPiProjectModelRuntime.mockImplementation(async (runtimeInput) => ({
      model,
      services: runtimeServices(runtimeInput.enabledOpenWaggleExtensionPackagePaths ?? []),
    }))
    runtimeMocks.createOpenWaggleAgentSessionFromServices.mockImplementation(async (options) => {
      if (options.services.enabledOpenWaggleExtensionPackagePaths.includes(selection.packagePath)) {
        throw activationFailure
      }

      return { session }
    })

    const result = await withPiSession(
      {
        ...input(),
        enabledOpenWaggleExtensionPackages: [selection],
        recordOpenWaggleExtensionRuntimeFailure: recordFailure,
      },
      operation,
    )

    expect(result).toBe('/repo/session.jsonl')
    expect(operation).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.createPiProjectModelRuntime).toHaveBeenCalledTimes(2)
    expect(runtimeMocks.createOpenWaggleAgentSessionFromServices).toHaveBeenCalledTimes(2)
    expect(recordFailure).not.toHaveBeenCalled()
    expect(runtimeMocks.disposeOpenWagglePiSession).toHaveBeenCalledWith(session)
  })
})
