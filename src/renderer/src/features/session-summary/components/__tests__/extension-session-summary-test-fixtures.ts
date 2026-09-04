import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId } from '@shared/types/brand'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import type { SessionResource } from '@shared/types/session-resource'

export const PROJECT_PATH = '/project'

export function baseEntry(
  family: ExtensionContributionRegistryEntry['family'],
  contributionId: string,
): ExtensionContributionRegistryEntry {
  return {
    extensionId: 'summary-extension',
    extensionName: 'Summary Extension',
    extensionVersion: '1.0.0',
    scope: {
      kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
      label: 'Project',
      projectPath: PROJECT_PATH,
    },
    packagePath: `${PROJECT_PATH}/.openwaggle/extensions/summary-extension`,
    manifestPath: `${PROJECT_PATH}/.openwaggle/extensions/summary-extension/openwaggle.extension.json`,
    contentHash: 'abcdef',
    projectPaths: [PROJECT_PATH],
    appliesToAllRequestedProjects: true,
    family,
    contributionId,
    title: contributionId,
    label: contributionId,
    eligibility: {
      runtimeEnabled: true,
      enabled: true,
      trusted: true,
      sdkCompatible: true,
      updateAvailable: false,
      disabledProjectPaths: [],
    },
    diagnostics: [],
  }
}

export function summaryEntry(): ExtensionContributionRegistryEntry {
  return {
    ...baseEntry(OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SESSION_SUMMARY_SECTIONS, 'summary'),
    title: 'Build status',
    sessionSummary: {
      placement: 'details',
      rows: [
        { id: 'status', label: 'Status', value: 'Ready' },
        { id: 'workers', label: 'Workers', count: 4 },
        { id: 'artifact', label: 'Preview', resourceId: 'resource-one' },
        {
          id: 'open-panel',
          label: 'Open details',
          action: { family: 'sidePanels', contributionId: 'details-panel' },
        },
      ],
    },
  }
}

export function registry(entries: readonly ExtensionContributionRegistryEntry[]) {
  return { projectPaths: [PROJECT_PATH], entries } satisfies ExtensionContributionRegistryView
}

export function sessionResource(
  kind: SessionResource['kind'],
  sessionId = 'session-one',
): SessionResource {
  return {
    id: 'resource-one',
    sessionId: SessionId(sessionId),
    canonicalKey: 'file:resource-one',
    kind,
    title: 'Resource one',
    mimeType: null,
    locator: 'session-resource://resource-one',
    available: true,
    isSource: false,
    isOutput: true,
    occurrences: [],
    createdAt: 1,
    updatedAt: 1,
  }
}
