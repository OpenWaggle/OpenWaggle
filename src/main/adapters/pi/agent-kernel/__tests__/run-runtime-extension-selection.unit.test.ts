import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEnabledOpenWaggleExtensionPackage } from '../../openwaggle-pi-extension-selection'
import { runPiSession } from '../classic-run'
import {
  createFakePi,
  createFakeSession,
  fakeRuntimeServices,
  modelFromReference,
  PRIMARY_MODEL,
  payload,
  type RuntimeFactoryInput,
  sessionDetail,
} from './run-orchestration.test-utils'

const runMocks = vi.hoisted(() => ({
  createPiProjectModelRuntime: vi.fn(),
  createOpenWaggleAgentSessionFromServices: vi.fn(),
  createSessionListener: vi.fn(),
  createSessionManagerForSession: vi.fn(),
  disposeOpenWagglePiSession: vi.fn(),
  getPiModelAvailableThinkingLevels: vi.fn(),
  resolveSessionProjectPath: vi.fn(),
}))

vi.mock('../../pi-provider-catalog', () => ({
  createPiProjectModelRuntime: runMocks.createPiProjectModelRuntime,
  getPiModelAvailableThinkingLevels: runMocks.getPiModelAvailableThinkingLevels,
}))

vi.mock('../../pi-session-lifecycle', () => ({
  createOpenWaggleAgentSessionFromServices: runMocks.createOpenWaggleAgentSessionFromServices,
  disposeOpenWagglePiSession: runMocks.disposeOpenWagglePiSession,
}))

vi.mock('../session-listener', () => ({
  createSessionListener: runMocks.createSessionListener,
}))

vi.mock('../session-manager', () => ({
  createSessionManagerForSession: runMocks.createSessionManagerForSession,
  resolveSessionProjectPath: runMocks.resolveSessionProjectPath,
}))

function runtimePackage(): RuntimeEnabledOpenWaggleExtensionPackage {
  const packagePath = '/repo/.openwaggle/extensions/sample-runtime-extension'
  const scope = { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: '/repo' } as const

  return {
    packagePath,
    extensionPackage: {
      id: 'sample-runtime-extension',
      scope,
      packagePath,
      manifestPath: `${packagePath}/${OPENWAGGLE_EXTENSION.MANIFEST_FILE}`,
      manifest: null,
      buildPlan: null,
      contentHash: 'abcdef',
      sdkCompatibility: null,
      diagnostics: [],
    },
    lifecycle: {
      extensionId: 'sample-runtime-extension',
      scope,
      enabled: true,
      trusted: true,
      grantedCapabilities: [],
      contentHash: 'abcdef',
      packageVersion: null,
      approvedBuildPlanHash: null,
      buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
      buildLog: null,
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
      lastReloadedAt: 1,
      sdkRange: null,
      sdkCompatible: true,
      diagnostics: [],
      installedAt: 1,
      updatedAt: 2,
    },
  }
}

describe('Pi run OpenWaggle extension selection', () => {
  beforeEach(() => {
    runMocks.createPiProjectModelRuntime.mockReset()
    runMocks.createOpenWaggleAgentSessionFromServices.mockReset()
    runMocks.createSessionListener.mockReset()
    runMocks.createSessionManagerForSession.mockReset()
    runMocks.disposeOpenWagglePiSession.mockReset()
    runMocks.getPiModelAvailableThinkingLevels.mockReset()
    runMocks.resolveSessionProjectPath.mockReset()
    runMocks.resolveSessionProjectPath.mockReturnValue('/repo')
    runMocks.createSessionManagerForSession.mockReturnValue({
      buildSessionContext: () => ({ messages: [] }),
    })
    runMocks.createSessionListener.mockReturnValue(() => undefined)
    runMocks.getPiModelAvailableThinkingLevels.mockReturnValue(['off', 'medium', 'high'])
  })

  it('passes lifecycle-selected OpenWaggle runtime packages into classic runs', async () => {
    const fakePi = createFakePi()
    const session = createFakeSession(fakePi.getAgentEndHandler)
    const selectedPackage = runtimePackage()
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => ({
      model: modelFromReference(input.modelReference),
      services: fakeRuntimeServices(),
    }))
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })

    await runPiSession({
      session: sessionDetail(),
      runId: 'run-with-runtime-extension',
      payload: payload('Run with extension'),
      model: PRIMARY_MODEL,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      enabledOpenWaggleExtensionPackages: [selectedPackage],
      recordOpenWaggleExtensionRuntimeFailure: vi.fn(),
    })

    expect(runMocks.createPiProjectModelRuntime).toHaveBeenCalledWith({
      projectPath: '/repo',
      modelReference: PRIMARY_MODEL,
      enabledOpenWaggleExtensionPackagePaths: [selectedPackage.packagePath],
    })
  })
})
