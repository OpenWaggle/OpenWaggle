import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { describe, expect, it } from 'vitest'
import { resolveExtensionDialogContribution } from '../extension-dialog-resolution'

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
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS,
    contributionId: 'sample.dialog',
    title: 'Sample dialog',
    label: 'Sample dialog',
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'dist/dialog.js',
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

function targetFor(entry: ExtensionContributionRegistryEntry, dialogId = entry.contributionId) {
  return {
    extensionId: entry.extensionId,
    dialogId,
    packagePath: entry.packagePath,
    contentHash: entry.contentHash,
  }
}

describe('resolveExtensionDialogContribution', () => {
  it('matches dialog contributions by extension and contribution id', () => {
    const dialogEntry = entry()

    const resolution = resolveExtensionDialogContribution({
      registry: registry([dialogEntry]),
      target: targetFor(dialogEntry),
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'available',
      contribution: {
        entry: dialogEntry,
        entryPath: 'dist/dialog.js',
      },
    })
  })

  it('rejects missing dialog ids without falling through to other families', () => {
    const sidePanelEntry = entry({
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
      contributionId: 'sample.dialog',
    })
    const resolution = resolveExtensionDialogContribution({
      registry: registry([sidePanelEntry]),
      target: targetFor(sidePanelEntry),
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'not-found',
      title: 'Extension dialog not available',
    })
  })

  it('blocks ineligible dialog contributions for the requested project', () => {
    const blockedEntry = entry({
      eligibility: {
        runtimeEnabled: true,
        enabled: true,
        trusted: false,
        sdkCompatible: true,
        updateAvailable: false,
        disabledProjectPaths: [],
      },
    })
    const resolution = resolveExtensionDialogContribution({
      registry: registry([blockedEntry]),
      target: targetFor(blockedEntry),
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'blocked',
      title: 'Extension dialog blocked',
    })
  })

  it('resolves duplicate extension ids by selected package identity', () => {
    const globalEntry = entry({
      extensionName: 'Global Sample Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND, label: 'Global' },
      packagePath: '/tmp/user-data/extensions/sample-extension',
      manifestPath: '/tmp/user-data/extensions/sample-extension/openwaggle.extension.json',
      contentHash: 'global-hash',
      title: 'Global dialog',
      entryPath: 'dist/global-dialog.js',
      eligibility: {
        runtimeEnabled: true,
        enabled: true,
        trusted: false,
        sdkCompatible: true,
        updateAvailable: false,
        disabledProjectPaths: [],
      },
    })
    const projectEntry = entry({
      contentHash: 'project-hash',
      title: 'Project dialog',
      entryPath: 'dist/project-dialog.js',
    })

    const resolution = resolveExtensionDialogContribution({
      registry: registry([globalEntry, projectEntry]),
      target: targetFor(projectEntry),
      requestedProjectPaths: [PROJECT_PATH],
    })

    expect(resolution).toMatchObject({
      status: 'available',
      contribution: {
        entry: projectEntry,
        entryPath: 'dist/project-dialog.js',
      },
    })
  })
})
