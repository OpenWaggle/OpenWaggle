import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId } from '@shared/types/brand'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentInteractionsPanel } from '../AgentInteractionsPanel'

const projectPath = '/test/project'

function registryWithInteractionRenderer(kind: string): ExtensionContributionRegistryView {
  const entry = {
    extensionId: 'github-fixture',
    extensionName: 'GitHub Fixture',
    extensionVersion: '1.0.0',
    scope: {
      kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
      label: 'Project',
      projectPath,
    },
    packagePath: `${projectPath}/.openwaggle/extensions/github-fixture`,
    manifestPath: `${projectPath}/.openwaggle/extensions/github-fixture/openwaggle.extension.json`,
    contentHash: 'abcdef',
    projectPaths: [projectPath],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.INTERACTION_RENDERERS,
    contributionId: 'github.interaction',
    title: 'GitHub interaction',
    label: 'GitHub interaction',
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'dist/interaction.js',
    matches: { interactionKinds: [kind] },
    eligibility: {
      runtimeEnabled: true,
      enabled: true,
      trusted: true,
      sdkCompatible: true,
      updateAvailable: false,
      disabledProjectPaths: [],
    },
    diagnostics: [],
  } satisfies ExtensionContributionRegistryEntry

  return { projectPaths: [projectPath], entries: [entry] }
}

describe('AgentInteractionsPanel', () => {
  it('submits pending Pi confirm interactions from the fallback panel', () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const interaction = {
      interactionId: 'interaction-1',
      sessionId: SessionId('session-1'),
      runId: 'run-1',
      kind: 'confirm',
      source: 'pi-ui',
      createdAt: 1,
      title: 'Approve action?',
      message: 'The extension wants to proceed.',
    } as const

    render(<AgentInteractionsPanel interactions={[interaction]} onRespond={onRespond} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    expect(onRespond).toHaveBeenCalledWith(interaction, { kind: 'confirm', accepted: true })
  })

  it('shows matching extension interaction renderer without blocking fallback controls', () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const interaction = {
      interactionId: 'interaction-1',
      sessionId: SessionId('session-1'),
      runId: 'run-1',
      kind: 'confirm',
      source: 'pi-ui',
      createdAt: 1,
      title: 'Approve action?',
      message: 'The extension wants to proceed.',
    } as const

    render(
      <AgentInteractionsPanel
        interactions={[interaction]}
        extensionRegistry={registryWithInteractionRenderer('confirm')}
        extensionProjectPaths={[projectPath]}
        onRespond={onRespond}
      />,
    )

    expect(screen.getByTitle('Extension module: GitHub interaction')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onRespond).toHaveBeenCalledWith(interaction, { kind: 'confirm', accepted: true })
  })
})
