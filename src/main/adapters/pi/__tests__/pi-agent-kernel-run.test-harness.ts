import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { vi } from 'vitest'
import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import { McpSessionConnectionPool } from '../../mcp/pool/mcp-session-connection-pool'
import type { runPiAgentKernel } from '../pi-agent-kernel-run'
import { stubDocsToolServices } from './openwaggle-docs-tool.test-harness'

type KernelRunDependencies = Parameters<typeof runPiAgentKernel>[1]

/**
 * What `runPiAgentKernel` needs around the Pi run itself: a bound managed-worktree workspace with
 * no preparation, the docs bundle at `/docs-bundle`, and a fresh MCP pool. A Run's visualization
 * directory is `visualizationDirectory`.
 */
export function kernelRunDependencies(visualizationDirectory: string | undefined) {
  return {
    runtimeExtensionIsolation: {},
    mcpPool: new McpSessionConnectionPool(),
    docs: stubDocsToolServices('/docs-bundle'),
    projectActions: fromPartial({
      workspaces: {
        getBound: () =>
          Effect.succeed({
            id: 'workspace-1',
            projectPath: '/repo',
            workingPath: '/repo/worktree',
            kind: 'managed-worktree',
            worktreeBranch: 'test',
          }),
      },
    }),
    preparation: fromPartial({
      read: () => Effect.succeed(null),
      environment: () => Effect.succeed({}),
      requireSetup: () => Effect.void,
    }),
    terminal: fromPartial({}),
    browserPreviewAutomation: fromPartial({}),
    enableBrowserPreviewAutomation: false,
    inlineVisualization: fromPartial({
      prepareSession: () => Effect.succeed(visualizationDirectory),
    }),
  } satisfies KernelRunDependencies
}

/** A first Run of a local Session in `/repo`; `overrides` replace its fields. */
export function kernelRunInput(
  sessionId: string,
  overrides: Omit<Partial<AgentKernelRunInput>, 'session'> & {
    readonly session?: Partial<SessionDetail>
  } = {},
) {
  const { session, ...rest } = overrides
  return fromPartial<AgentKernelRunInput>({
    runId: 'run-1',
    payload: { text: 'Do the work', attachments: [] },
    model: SupportedModelId('openai/gpt-5.4'),
    signal: new AbortController().signal,
    onEvent: vi.fn(),
    ...rest,
    session: { id: SessionId(sessionId), projectPath: '/repo', messages: [], ...session },
  })
}

/** What the mocked Pi run returns: an empty answer with no snapshot nodes. */
export const EMPTY_RUN_RESULT = {
  newMessages: [],
  piSessionId: 'pi-session',
  sessionSnapshot: { nodes: [], activeNodeId: null },
}
