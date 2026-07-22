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
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
    contributionId: 'sample.tool-renderer',
    title: 'Sample tool renderer',
    label: 'Sample tool renderer',
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'dist/tool.js',
    matches: {
      toolNames: ['sample.tool'],
    },
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

describe('resolveExtensionAgentLoopContribution', () => {
  it('matches tool renderer contributions by declared tool names', () => {
    const toolEntry = entry()

    const resolution = resolveExtensionAgentLoopContribution({
      registry: registry([toolEntry]),
      target: { surface: 'tool', toolName: 'sample.tool' },
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'available',
      contribution: {
        entry: toolEntry,
        entryPath: 'dist/tool.js',
      },
    })
  })

  it('ignores renderer contributions whose match metadata targets another payload', () => {
    const resolution = resolveExtensionAgentLoopContribution({
      registry: registry([entry()]),
      target: { surface: 'tool', toolName: 'other.tool' },
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'not-found',
      title: 'Extension renderer not available',
    })
  })

  it('does not treat missing Pi event matches as a wildcard renderer binding', () => {
    const resolution = resolveExtensionAgentLoopContribution({
      registry: registry([entry({ matches: undefined })]),
      target: { surface: 'tool', toolName: 'sample.tool' },
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'not-found',
      title: 'Extension renderer not available',
    })
  })

  it('matches custom-message and interaction renderers by their specific match lists', () => {
    const customEntry = entry({
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.CUSTOM_MESSAGE_RENDERERS,
      contributionId: 'sample.custom-message',
      matches: { customMessageNames: ['sample.message'] },
    })
    const interactionEntry = entry({
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.INTERACTION_RENDERERS,
      contributionId: 'sample.interaction',
      matches: { interactionKinds: ['sample.choice'] },
    })

    expect(
      resolveExtensionAgentLoopContribution({
        registry: registry([customEntry, interactionEntry]),
        target: { surface: 'custom-message', customMessageName: 'sample.message' },
        requestedProjectPaths: [PROJECT_PATH],
      }),
    ).toMatchObject({ status: 'available', contribution: { entry: customEntry } })
    expect(
      resolveExtensionAgentLoopContribution({
        registry: registry([customEntry, interactionEntry]),
        target: { surface: 'interaction', interactionKind: 'sample.choice' },
        requestedProjectPaths: [PROJECT_PATH],
      }),
    ).toMatchObject({ status: 'available', contribution: { entry: interactionEntry } })
  })

  it('matches transcript renderer contributions through the transcript surface', () => {
    const transcriptEntry = entry({
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TRANSCRIPT_RENDERERS,
      contributionId: 'sample.transcript',
      matches: {},
    })

    const resolution = resolveExtensionAgentLoopContribution({
      registry: registry([transcriptEntry]),
      target: { surface: 'transcript' },
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'available',
      contribution: { entry: transcriptEntry },
    })
  })

  it('resolves auxiliary placement contributions that bind to the same Pi tool event', () => {
    const dialogEntry = entry({
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS,
      contributionId: 'sample.dialog',
      title: 'Sample dialog',
      matches: { toolNames: ['sample.tool'] },
    })
    const sidePanelEntry = entry({
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
      contributionId: 'sample.side-panel',
      title: 'Sample side panel',
      matches: { toolNames: ['sample.tool'] },
    })
    const statusEntry = entry({
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.STATUS_WIDGETS,
      contributionId: 'sample.status',
      title: 'Sample status',
      matches: { toolNames: ['sample.tool'] },
    })
    const registryView = registry([dialogEntry, sidePanelEntry, statusEntry])
    const target = { surface: 'tool', toolName: 'sample.tool' } as const

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

  it('falls back to blocked when the matching renderer is not eligible for the project', () => {
    const resolution = resolveExtensionAgentLoopContribution({
      registry: registry([
        entry({
          eligibility: {
            runtimeEnabled: true,
            enabled: true,
            trusted: false,
            sdkCompatible: true,
            updateAvailable: false,
            disabledProjectPaths: [],
          },
        }),
      ]),
      target: { surface: 'tool', toolName: 'sample.tool' },
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'blocked',
      title: 'Extension renderer blocked',
    })
  })

  it('uses a later eligible renderer when an earlier matching renderer is blocked', () => {
    const blockedGlobalEntry = entry({
      extensionId: 'blocked-global',
      scope: {
        kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND,
        label: 'Global',
      },
      projectPaths: [PROJECT_PATH],
      eligibility: {
        runtimeEnabled: true,
        enabled: true,
        trusted: false,
        sdkCompatible: true,
        updateAvailable: false,
        disabledProjectPaths: [],
      },
    })
    const eligibleProjectEntry = entry({
      extensionId: 'eligible-project',
      contributionId: 'eligible.tool-renderer',
    })

    const resolution = resolveExtensionAgentLoopContribution({
      registry: registry([blockedGlobalEntry, eligibleProjectEntry]),
      target: { surface: 'tool', toolName: 'sample.tool' },
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'available',
      contribution: { entry: eligibleProjectEntry },
    })
  })

  it('uses a later eligible renderer when an earlier matching renderer is invalid', () => {
    const invalidEntry = entry({
      extensionId: 'invalid-project',
      contributionId: 'invalid.tool-renderer',
      entryPath: undefined,
    })
    const eligibleEntry = entry({
      extensionId: 'eligible-project',
      contributionId: 'eligible.tool-renderer',
    })

    const resolution = resolveExtensionAgentLoopContribution({
      registry: registry([invalidEntry, eligibleEntry]),
      target: { surface: 'tool', toolName: 'sample.tool' },
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'available',
      contribution: { entry: eligibleEntry },
    })
  })
})
