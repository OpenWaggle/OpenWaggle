import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ChatToolCallPart } from '@shared/types/chat-ui'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExtensionAgentLoopSurface } from '../ExtensionAgentLoopSurface'

const PROJECT_PATH = '/tmp/project'

const TOOL_PART: ChatToolCallPart = {
  type: 'tool-call',
  id: 'tool-1',
  name: 'openwaggle.github.listIssues',
  arguments: '{"owner":"OpenWaggle","repo":"OpenWaggle"}',
  state: 'input-complete',
}

const TOOL_ENTRY: ExtensionContributionRegistryEntry = {
  extensionId: 'github-fixture',
  extensionName: 'GitHub Fixture',
  extensionVersion: '1.0.0',
  scope: {
    kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
    label: 'Project',
    projectPath: PROJECT_PATH,
  },
  packagePath: '/tmp/project/.openwaggle/extensions/github-fixture',
  manifestPath: '/tmp/project/.openwaggle/extensions/github-fixture/openwaggle.extension.json',
  contentHash: 'abcdef',
  projectPaths: [PROJECT_PATH],
  appliesToAllRequestedProjects: true,
  family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
  contributionId: 'github.tool-card',
  title: 'GitHub tool card',
  label: 'GitHub tool card',
  runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
  execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
  entryPath: 'dist/tool-card.js',
  matches: {
    toolNames: ['openwaggle.github.listIssues'],
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
}

const REGISTRY: ExtensionContributionRegistryView = {
  projectPaths: [PROJECT_PATH],
  entries: [TOOL_ENTRY],
}

describe('ExtensionAgentLoopSurface', () => {
  it('renders an OpenWaggle-owned tool fallback when no renderer matches', () => {
    render(
      <ExtensionAgentLoopSurface
        input={{ surface: 'tool', toolCall: { ...TOOL_PART, name: 'missing.tool' } }}
        projectPaths={[PROJECT_PATH]}
        registry={REGISTRY}
      />,
    )

    expect(screen.getByText('Tool output · missing.tool')).toBeInTheDocument()
    expect(screen.getByText('missing.tool')).toBeInTheDocument()
    expect(screen.getByText('{"owner":"OpenWaggle","repo":"OpenWaggle"}')).toBeInTheDocument()
    expect(screen.queryByTitle('Extension module: GitHub tool card')).not.toBeInTheDocument()
  })

  it('mounts matching renderers and passes serializable surface payload to the frame document', async () => {
    render(
      <ExtensionAgentLoopSurface
        input={{ surface: 'tool', toolCall: TOOL_PART }}
        projectPaths={[PROJECT_PATH]}
        registry={REGISTRY}
      />,
    )

    const frame = screen.getByTitle('Extension module: GitHub tool card')
    await waitFor(() => {
      expect(frame).toHaveAttribute('src', expect.stringContaining('blob:'))
    })
    expect(screen.getByText('GitHub tool card')).toBeInTheDocument()
    expect(screen.queryByText('openwaggle.github.listIssues')).not.toBeInTheDocument()
    expect(screen.queryByText('toolRenderers')).not.toBeInTheDocument()
  })

  it('renders an interactive fallback and routes selected actions', () => {
    const onAction = vi.fn()
    render(
      <ExtensionAgentLoopSurface
        input={{
          surface: 'interaction',
          interaction: {
            id: 'select-issue',
            kind: 'github.issue.select',
            title: 'Select an issue',
            description: 'Pick one issue for the next step.',
            state: 'pending',
            actions: [
              { id: 'issue-113', label: '#113' },
              { id: 'cancel', label: 'Cancel', tone: 'secondary' },
            ],
          },
          onAction,
        }}
        projectPaths={[PROJECT_PATH]}
        registry={{ projectPaths: [PROJECT_PATH], entries: [] }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '#113' }))

    expect(screen.getByText('Interaction · github.issue.select')).toBeInTheDocument()
    expect(onAction).toHaveBeenCalledWith('select-issue', 'issue-113')
  })

  it('mounts transcript renderer contributions for transcript surfaces', async () => {
    const transcriptEntry = {
      ...TOOL_ENTRY,
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TRANSCRIPT_RENDERERS,
      contributionId: 'github.transcript',
      title: 'GitHub transcript',
      label: 'GitHub transcript',
      entryPath: 'dist/transcript.js',
      matches: {},
    } satisfies ExtensionContributionRegistryEntry

    render(
      <ExtensionAgentLoopSurface
        fallback={null}
        input={{
          surface: 'transcript',
          transcript: {
            sessionId: 'session-1',
            projectPaths: [PROJECT_PATH],
            messageCount: 3,
            state: 'active',
          },
        }}
        projectPaths={[PROJECT_PATH]}
        registry={{ projectPaths: [PROJECT_PATH], entries: [transcriptEntry] }}
      />,
    )

    const frame = screen.getByTitle('Extension module: GitHub transcript')
    await waitFor(() => {
      expect(frame).toHaveAttribute('src', expect.stringContaining('blob:'))
    })
    expect(screen.getByText('GitHub transcript')).toBeInTheDocument()
    expect(screen.queryByText('Transcript renderer')).not.toBeInTheDocument()
    expect(screen.queryByText('transcriptRenderers')).not.toBeInTheDocument()
  })
})
