import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { describe, expect, it } from 'vitest'
import { resolveExtensionSidePanelContribution } from '../extension-side-panel-resolution'

const PROJECT_PATH = '/tmp/project'
const OTHER_PROJECT_PATH = '/tmp/other-project'

function sidePanelEntry(
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
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
    contributionId: 'sample.side-panel',
    title: 'Sample side panel',
    label: 'Sample side panel',
    runtime: 'federated-module',
    execution: 'host-renderer',
    entryPath: 'dist/side-panel.html',
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

describe('resolveExtensionSidePanelContribution', () => {
  it('resolves a registered side panel contribution for the requested project', () => {
    const entry = sidePanelEntry()

    const resolution = resolveExtensionSidePanelContribution({
      registry: registry([entry]),
      target: {
        extensionId: 'sample-extension',
        sidePanelId: 'sample.side-panel',
      },
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'available',
      contribution: {
        entry,
        runtime: 'federated-module',
        execution: 'host-renderer',
        entryPath: 'dist/side-panel.html',
      },
    })
  })

  it('returns contained not-found states for unknown extensions and side panels', () => {
    const extensionResolution = resolveExtensionSidePanelContribution({
      registry: registry([sidePanelEntry()]),
      target: {
        extensionId: 'missing-extension',
        sidePanelId: 'sample.side-panel',
      },
      requestedProjectPaths: [PROJECT_PATH],
    })
    const sidePanelResolution = resolveExtensionSidePanelContribution({
      registry: registry([sidePanelEntry()]),
      target: {
        extensionId: 'sample-extension',
        sidePanelId: 'missing.side-panel',
      },
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(extensionResolution).toMatchObject({
      status: 'not-found',
      title: 'Extension side panel not available',
    })
    expect(sidePanelResolution).toMatchObject({
      status: 'not-found',
      title: 'Side panel contribution not available',
    })
  })

  it('can target a specific side panel package when duplicate contribution ids exist', () => {
    const globalEntry = sidePanelEntry({
      scope: {
        kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND,
        label: 'Global',
      },
      packagePath: '/tmp/user-data/extensions/sample-extension',
      manifestPath: '/tmp/user-data/extensions/sample-extension/openwaggle.extension.json',
      contentHash: 'global-hash',
      title: 'Global side panel',
    })
    const projectEntry = sidePanelEntry({
      contentHash: 'project-hash',
      title: 'Project side panel',
    })

    const resolution = resolveExtensionSidePanelContribution({
      registry: registry([globalEntry, projectEntry]),
      target: {
        extensionId: 'sample-extension',
        sidePanelId: 'sample.side-panel',
        packagePath: projectEntry.packagePath,
        contentHash: projectEntry.contentHash,
      },
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'available',
      contribution: { entry: projectEntry },
    })
  })

  it('blocks side panel entries that are not eligible for the active project', () => {
    const resolution = resolveExtensionSidePanelContribution({
      registry: registry([
        sidePanelEntry({
          appliesToAllRequestedProjects: false,
          projectPaths: [OTHER_PROJECT_PATH],
          eligibility: {
            runtimeEnabled: true,
            enabled: true,
            trusted: true,
            sdkCompatible: true,
            updateAvailable: false,
            disabledProjectPaths: [PROJECT_PATH],
          },
        }),
      ]),
      target: {
        extensionId: 'sample-extension',
        sidePanelId: 'sample.side-panel',
      },
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'blocked',
      title: 'Extension side panel blocked',
    })
  })

  it('rejects side panel entries missing host metadata before mounting a module', () => {
    const resolution = resolveExtensionSidePanelContribution({
      registry: registry([sidePanelEntry({ entryPath: undefined })]),
      target: {
        extensionId: 'sample-extension',
        sidePanelId: 'sample.side-panel',
      },
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'invalid',
      title: 'Side panel contribution incomplete',
    })
  })
})
