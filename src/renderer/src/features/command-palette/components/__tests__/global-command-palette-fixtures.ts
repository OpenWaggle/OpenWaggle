import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ActionDefinition } from '@shared/types/action-definitions'
import type {
  ActionManagementRequest,
  ActionManagementResult,
} from '@shared/types/action-management'
import type { ActionRun } from '@shared/types/action-runs'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { extensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import { fromPartial } from '@total-typescript/shoehorn'

export const NOTES = extensionRightPanelSurfaceId({
  extensionId: 'acme.notes',
  sidePanelId: 'notes',
})

/** The one Project Action of the open Session's project. */
const SERVE: ActionDefinition = {
  id: 'serve',
  name: 'Serve app',
  icon: 'play',
  invocation: { type: 'command', command: 'pnpm serve', directory: '.' },
  kind: 'service',
  allowConcurrent: false,
  autoOpenPreview: false,
}

/** The Host's Project Actions: only `/session-project` has one, and it starts. */
export async function answerProjectActions({ scope, operation }: ActionManagementRequest) {
  if (operation.type === 'catalog') {
    const result: ActionManagementResult = {
      type: 'catalog',
      catalog: {
        revision: 'catalog-1',
        actions:
          scope.projectPath === '/session-project' ? [{ source: 'local', definition: SERVE }] : [],
        profiles: [],
        preparation: [],
      },
    }
    return result
  }
  if (operation.type === 'start') {
    const result: ActionManagementResult = {
      type: 'run',
      run: fromPartial<ActionRun>({ id: 'run-1', action: SERVE }),
    }
    return result
  }
  throw new Error(`Unexpected operation ${operation.type}`)
}

/** An enabled, trusted global side panel contributed by the Acme Notes extension. */
export function sidePanelEntry() {
  const entry: ExtensionContributionRegistryEntry = {
    extensionId: 'acme.notes',
    extensionName: 'Acme Notes',
    extensionVersion: '1.0.0',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND, label: 'Global' },
    packagePath: '/extensions/acme-notes',
    manifestPath: '/extensions/acme-notes/openwaggle.extension.json',
    contentHash: 'hash-1',
    projectPaths: ['/repo'],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
    contributionId: 'notes',
    title: 'Notes',
    label: 'Notes',
    category: 'Writing',
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'modules/notes.js',
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
  return entry
}
