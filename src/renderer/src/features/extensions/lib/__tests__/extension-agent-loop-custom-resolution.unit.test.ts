import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { describe, expect, it } from 'vitest'
import {
  resolveExtensionAgentLoopContribution,
  resolveExtensionAgentLoopContributionEntries,
} from '../extension-agent-loop-resolution'

const PROJECT_PATH = '/tmp/project'

function entry(
  overrides: Partial<ExtensionContributionRegistryEntry> = {},
): ExtensionContributionRegistryEntry {
  return {
    extensionId: 'sample-extension',
    extensionName: 'Sample Extension',
    extensionVersion: '1.0.0',
    scope: {
      kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
      label: 'Project',
      projectPath: PROJECT_PATH,
    },
    packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
    manifestPath: '/tmp/project/.openwaggle/extensions/sample-extension/openwaggle.extension.json',
    contentHash: 'abcdef',
    projectPaths: [PROJECT_PATH],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.INTERACTION_RENDERERS,
    contributionId: 'sample.custom-interaction',
    title: 'Sample custom interaction',
    label: 'Sample custom interaction',
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'dist/custom-interaction.js',
    matches: { interactionKinds: ['custom'] },
    eligibility: {
      runtimeEnabled: true,
      enabled: true,
      trusted: true,
      sdkCompatible: true,
      updateAvailable: false,
      disabledProjectPaths: [],
    },
    diagnostics: [],
    ...overrides,
  }
}

function registry(
  entries: readonly ExtensionContributionRegistryEntry[],
): ExtensionContributionRegistryView {
  return {
    projectPaths: [PROJECT_PATH],
    entries,
  }
}

describe('resolveExtensionAgentLoopContribution for custom interactions', () => {
  it('matches custom desktop interaction renderers by the custom interaction kind', () => {
    const customInteractionEntry = entry()

    const resolution = resolveExtensionAgentLoopContribution({
      registry: registry([customInteractionEntry]),
      target: { surface: 'interaction', interactionKind: 'custom' },
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'available',
      contribution: { entry: customInteractionEntry },
    })
  })

  it('resolves auxiliary placements that bind to the same custom interaction event', () => {
    const dialogEntry = entry({
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS,
      contributionId: 'sample.custom-dialog',
      title: 'Sample custom dialog',
    })
    const sidePanelEntry = entry({
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
      contributionId: 'sample.custom-side-panel',
      title: 'Sample custom side panel',
    })
    const statusEntry = entry({
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.STATUS_WIDGETS,
      contributionId: 'sample.custom-status',
      title: 'Sample custom status',
    })
    const registryView = registry([dialogEntry, sidePanelEntry, statusEntry])
    const target = { surface: 'interaction', interactionKind: 'custom' } as const

    expect(
      resolveExtensionAgentLoopContributionEntries({
        registry: registryView,
        target,
        requestedProjectPaths: [PROJECT_PATH],
        family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS,
      }).map((contribution) => contribution.entry),
    ).toEqual([dialogEntry])
    expect(
      resolveExtensionAgentLoopContributionEntries({
        registry: registryView,
        target,
        requestedProjectPaths: [PROJECT_PATH],
        family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
      }).map((contribution) => contribution.entry),
    ).toEqual([sidePanelEntry])
    expect(
      resolveExtensionAgentLoopContributionEntries({
        registry: registryView,
        target,
        requestedProjectPaths: [PROJECT_PATH],
        family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.STATUS_WIDGETS,
      }).map((contribution) => contribution.entry),
    ).toEqual([statusEntry])
  })
})
