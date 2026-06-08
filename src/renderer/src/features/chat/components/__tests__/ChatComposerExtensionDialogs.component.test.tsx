import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import { SessionId } from '@shared/types/brand'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChatComposerExtensionDialogs } from '../ChatComposerExtensionDialogs'

const PROJECT_PATH = '/test/project'

function extensionDialogEntry({
  kind,
  title = 'GitHub approval dialog',
  scope = {
    kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
    label: 'Project',
    projectPath: PROJECT_PATH,
  },
  packagePath = `${PROJECT_PATH}/.openwaggle/extensions/github-fixture`,
  manifestPath = `${PROJECT_PATH}/.openwaggle/extensions/github-fixture/openwaggle.extension.json`,
  contentHash = 'abcdef',
  trusted = true,
}: {
  readonly kind: string
  readonly title?: string
  readonly scope?: ExtensionContributionRegistryEntry['scope']
  readonly packagePath?: string
  readonly manifestPath?: string
  readonly contentHash?: string
  readonly trusted?: boolean
}): ExtensionContributionRegistryEntry {
  return {
    extensionId: 'github-fixture',
    extensionName: 'GitHub Fixture',
    extensionVersion: '1.0.0',
    scope,
    packagePath,
    manifestPath,
    contentHash,
    projectPaths: [PROJECT_PATH],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS,
    contributionId: 'github.approval-dialog',
    title,
    label: title,
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'dist/dialog.js',
    matches: { interactionKinds: [kind] },
    eligibility: {
      runtimeEnabled: true,
      enabled: true,
      trusted,
      sdkCompatible: true,
      updateAvailable: false,
      disabledProjectPaths: [],
    },
    diagnostics: [],
  }
}

function extensionDialogRegistry(kind: string): ExtensionContributionRegistryView {
  return { projectPaths: [PROJECT_PATH], entries: [extensionDialogEntry({ kind })] }
}

function pendingInteraction(): AgentLoopInteraction {
  return {
    interactionId: 'interaction-1',
    sessionId: SessionId('session-1'),
    runId: 'run-1',
    kind: 'confirm',
    source: 'pi-ui',
    createdAt: 1,
    title: 'Approve action?',
    message: 'The extension wants to proceed.',
  }
}

describe('ChatComposerExtensionDialogs', () => {
  it('opens matching extension dialog contributions from compact composer launchers', () => {
    render(
      <ChatComposerExtensionDialogs
        agentInteractions={[pendingInteraction()]}
        extensionProjectPaths={[PROJECT_PATH]}
        extensionRegistry={extensionDialogRegistry('confirm')}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /extensions/i }))
    fireEvent.click(screen.getByRole('button', { name: /github approval dialog/i }))

    expect(screen.getByRole('dialog', { name: 'GitHub approval dialog' })).toBeInTheDocument()
    expect(screen.getByTitle('Extension module: GitHub approval dialog')).toBeInTheDocument()
  })

  it('does not render composer launchers without matching dialog contributions', () => {
    render(
      <ChatComposerExtensionDialogs
        agentInteractions={[pendingInteraction()]}
        extensionProjectPaths={[PROJECT_PATH]}
        extensionRegistry={extensionDialogRegistry('select')}
      />,
    )

    expect(screen.queryByRole('button', { name: /extensions/i })).not.toBeInTheDocument()
  })

  it('opens the selected package when global and project dialogs share an id', () => {
    render(
      <ChatComposerExtensionDialogs
        agentInteractions={[pendingInteraction()]}
        extensionProjectPaths={[PROJECT_PATH]}
        extensionRegistry={{
          projectPaths: [PROJECT_PATH],
          entries: [
            extensionDialogEntry({
              kind: 'confirm',
              title: 'Global approval dialog',
              scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND, label: 'Global' },
              packagePath: '/test/user-data/extensions/github-fixture',
              manifestPath: '/test/user-data/extensions/github-fixture/openwaggle.extension.json',
              contentHash: 'global-hash',
              trusted: false,
            }),
            extensionDialogEntry({
              kind: 'confirm',
              title: 'Project approval dialog',
              contentHash: 'project-hash',
            }),
          ],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /extensions/i }))
    fireEvent.click(screen.getByRole('button', { name: /project approval dialog/i }))

    expect(screen.getByRole('dialog', { name: 'Project approval dialog' })).toBeInTheDocument()
    expect(screen.getByTitle('Extension module: Project approval dialog')).toBeInTheDocument()
    expect(screen.queryByText('Extension dialog blocked')).not.toBeInTheDocument()
  })
})
