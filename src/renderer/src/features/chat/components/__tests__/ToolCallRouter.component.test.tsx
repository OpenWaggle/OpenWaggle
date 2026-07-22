import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

type ToolCallPart = Extract<UIMessage['parts'][number], { type: 'tool-call' }>

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../ToolCallBlock', () => ({
  ToolCallBlock: ({
    name,
    result,
    isStreaming,
  }: {
    name: string
    result?: { content: unknown; state: string; error?: string }
    isStreaming?: boolean
  }) => (
    <div data-testid="tool-call-block" data-streaming={String(isStreaming)}>
      <span>{name}</span>
      {result && <span data-testid="tool-result-state">{result.state}</span>}
    </div>
  ),
}))

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------
import { ToolCallRouter } from '../ToolCallRouter'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeToolCallPart(
  name: string,
  args = '{}',
  id = 'tc-1',
  state: ToolCallPart['state'] = 'input-complete',
) {
  return { type: 'tool-call', id, name, arguments: args, state }
}

function emptyResults() {
  return new Map()
}

function resultsWithEntry(
  id: string,
  content: unknown,
  state = 'output-available',
  error?: string,
) {
  const map = new Map<string, { content: unknown; state: string; error?: string }>()
  map.set(id, { content, state, error })
  return map
}

const defaultSessionId = SessionId('session-1')
const projectPath = '/test/project'

function registryWithToolRenderer(toolName: string): ExtensionContributionRegistryView {
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
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
    contributionId: 'github.tool-card',
    title: 'GitHub tool card',
    label: 'GitHub tool card',
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'dist/tool-card.js',
    matches: { toolNames: [toolName] },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ToolCallRouter', () => {
  it('renders ToolCallBlock for generic tool calls', () => {
    const part = makeToolCallPart('read')
    render(
      <ToolCallRouter
        part={part}
        toolResults={emptyResults()}
        sessionId={defaultSessionId}
        isStreaming={false}
      />,
    )
    expect(screen.getByTestId('tool-call-block')).toHaveTextContent('read')
  })

  it('passes persisted tool results through to ToolCallBlock', () => {
    const part = makeToolCallPart('bash', '{"command":"echo hi"}', 'tc-bash')
    render(
      <ToolCallRouter
        part={part}
        toolResults={resultsWithEntry('tc-bash', 'hi')}
        sessionId={defaultSessionId}
        isStreaming={false}
      />,
    )
    expect(screen.getByTestId('tool-result-state')).toHaveTextContent('output-available')
  })

  it('passes streaming state through without special-casing tool names', () => {
    const part = makeToolCallPart('futurePiTool', '{}', 'tc-future')
    render(
      <ToolCallRouter
        part={part}
        toolResults={emptyResults()}
        sessionId={defaultSessionId}
        isStreaming={true}
      />,
    )
    expect(screen.getByTestId('tool-call-block')).toHaveAttribute('data-streaming', 'true')
    expect(screen.getByTestId('tool-call-block')).toHaveTextContent('futurePiTool')
  })

  it('mounts a matching extension tool renderer from the production registry', () => {
    const part = makeToolCallPart('read', '{"path":"src/app.ts"}', 'tc-read')
    render(
      <ToolCallRouter
        part={part}
        toolResults={resultsWithEntry('tc-read', 'file content')}
        sessionId={defaultSessionId}
        isStreaming={false}
        extensionRegistry={registryWithToolRenderer('read')}
        extensionProjectPaths={[projectPath]}
      />,
    )

    expect(screen.getByTitle('Extension module: GitHub tool card')).toBeInTheDocument()
    expect(screen.queryByTestId('tool-call-block')).toBeNull()
  })

  it('falls back to the standard tool call block when no extension renderer matches', () => {
    const part = makeToolCallPart('missing.tool', '{}', 'tc-missing')
    render(
      <ToolCallRouter
        part={part}
        toolResults={emptyResults()}
        sessionId={defaultSessionId}
        isStreaming={false}
        extensionRegistry={registryWithToolRenderer('read')}
        extensionProjectPaths={[projectPath]}
      />,
    )

    expect(screen.getByTestId('tool-call-block')).toHaveTextContent('missing.tool')
    expect(screen.queryByText('Tool output · missing.tool')).toBeNull()
  })
})
