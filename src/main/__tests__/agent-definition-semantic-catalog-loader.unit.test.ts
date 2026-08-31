import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDefinitionPiProjectServices } from '../adapters/pi/agent-definition-semantic-catalog-services'
import type { OpenWagglePiExtensionSelectionServices } from '../adapters/pi/openwaggle-pi-extension-selection'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../extensions/types'

const catalogMocks = vi.hoisted(() => ({
  createPiRuntimeServices: vi.fn(),
}))

vi.mock('../adapters/pi/pi-provider-catalog', () => ({
  createPiRuntimeServices: catalogMocks.createPiRuntimeServices,
}))

import { loadAgentDefinitionSemanticCatalog } from '../agent-definition-semantic-catalog-loader'

function managedExtension(projectPath: string): DiscoveredExtensionPackage {
  const packagePath = `${projectPath}/.openwaggle/extensions/team-tools`
  return {
    id: 'team-tools',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
    packagePath,
    manifestPath: `${packagePath}/${OPENWAGGLE_EXTENSION.MANIFEST_FILE}`,
    manifest: {
      manifestVersion: 1,
      id: 'team-tools',
      name: 'Team tools',
      version: '1.0.0',
      sdk: { openwaggle: '>=0.1.0 <0.2.0' },
      sourceFiles: ['src/index.ts'],
      builtArtifacts: ['extensions/index.js'],
      pi: { resourceRoots: ['pi'] },
    },
    buildPlan: null,
    contentHash: 'trusted-content',
    sdkCompatibility: {
      hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
      requiredRange: '>=0.1.0 <0.2.0',
      compatible: true,
    },
    diagnostics: [],
  }
}

function enabledLifecycle(projectPath: string): ExtensionLifecycleState {
  return {
    extensionId: 'team-tools',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
    enabled: true,
    trusted: true,
    grantedCapabilities: [],
    contentHash: 'trusted-content',
    packageVersion: '1.0.0',
    approvedBuildPlanHash: null,
    buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
    buildLog: null,
    reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
    lastReloadedAt: 1,
    sdkRange: '>=0.1.0 <0.2.0',
    sdkCompatible: true,
    diagnostics: [],
    installedAt: 1,
    updatedAt: 1,
  }
}

function extensionSelectionServices(
  extensionPackage: DiscoveredExtensionPackage,
  lifecycle: ExtensionLifecycleState,
): OpenWagglePiExtensionSelectionServices {
  return {
    manager: { listPackages: () => Effect.succeed([extensionPackage]) },
    lifecycleRepository: {
      get: () => Effect.succeed(lifecycle),
      list: () => Effect.succeed([lifecycle]),
      upsert: () => Effect.void,
    },
    projectOverridesRepository: {
      get: () => Effect.succeed(null),
      upsert: () => Effect.void,
    },
  }
}

describe('loadAgentDefinitionSemanticCatalog', () => {
  beforeEach(() => catalogMocks.createPiRuntimeServices.mockReset())

  it('includes tools and skills from enabled OpenWaggle-managed extensions', async () => {
    const projectPath = '/tmp/openwaggle-agent-definition-catalog'
    const extensionPackage = managedExtension(projectPath)

    catalogMocks.createPiRuntimeServices.mockResolvedValue(
      fromPartial<AgentDefinitionPiProjectServices>({
        modelRuntime: {
          getModels: () => [{ provider: 'test-provider', id: 'test-model' }],
        },
        resourceLoader: {
          getSkills: () => ({ skills: [{ name: 'managed-skill' }] }),
          getExtensions: () => ({
            extensions: [{ tools: new Map([['managed_tool', {}]]) }],
            errors: [],
          }),
        },
      }),
    )

    const catalog = await loadAgentDefinitionSemanticCatalog({
      projectPath,
      userHome: '/tmp/openwaggle-agent-definition-home',
      extensionSelectionServices: extensionSelectionServices(
        extensionPackage,
        enabledLifecycle(projectPath),
      ),
    })

    expect(catalog).toMatchObject({
      models: ['test-provider/test-model'],
      tools: expect.arrayContaining(['managed_tool']),
      skills: ['managed-skill'],
    })
    expect(catalogMocks.createPiRuntimeServices).toHaveBeenCalledWith(projectPath, {
      enabledOpenWaggleExtensionPackagePaths: [extensionPackage.packagePath],
      enabledOpenWaggleExtensionResourceRoots: [
        { packagePath: extensionPackage.packagePath, resourceRoot: 'pi' },
      ],
    })
  })
})
