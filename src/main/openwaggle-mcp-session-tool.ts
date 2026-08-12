import { match } from '@diegogbrisa/ts-match'
import * as Effect from 'effect/Effect'
import {
  handoffSession,
  interruptSession,
  messageSession,
  organizeSession,
  waitForSession,
} from './application/mcp-hosted-session-control'
import type { OpenWaggleMcpServeOptions, OpenWaggleMcpServer } from './openwaggle-mcp-server-policy'
import { requireGrant } from './openwaggle-mcp-server-policy'
import {
  type OpenWaggleSessionTaskController,
  type OpenWaggleSessionToolAdapters,
  type SessionToolInput,
  sessionInputSchema,
} from './openwaggle-mcp-session-contract'
import {
  copySession,
  createSession,
  createWorktree,
  planWorktree,
} from './openwaggle-mcp-session-lifecycle'
import type { OpenWaggleMcpSessionMetadataStore } from './openwaggle-mcp-session-metadata-store'
import {
  listSessions,
  loadHostedSession,
  readSession,
  sessionStatus,
} from './openwaggle-mcp-session-queries'

export {
  type OpenWaggleSessionTaskController,
  type OpenWaggleSessionToolAdapters,
  sessionInputSchema,
} from './openwaggle-mcp-session-contract'

export function registerOpenWaggleSessionTool(
  server: OpenWaggleMcpServer,
  options: OpenWaggleMcpServeOptions,
  tasks: OpenWaggleSessionTaskController,
  metadata: OpenWaggleMcpSessionMetadataStore,
  adapters: OpenWaggleSessionToolAdapters,
) {
  server.registerTool(
    'openwaggle_sessions',
    {
      title: 'OpenWaggle sessions',
      description:
        'Discover, inspect, create, fork, clone, message, steer, wait for, interrupt, hand off, pin, rename, archive, or materialize worktrees for granted desktop sessions. Every operation checks its own grant.',
      inputSchema: sessionInputSchema,
    },
    async (input) => executeSessionOperation(options, tasks, metadata, adapters, input),
  )
}

export async function executeSessionOperation(
  options: OpenWaggleMcpServeOptions,
  tasks: OpenWaggleSessionTaskController,
  metadata: OpenWaggleMcpSessionMetadataStore,
  adapters: OpenWaggleSessionToolAdapters,
  input: SessionToolInput,
) {
  if (input.operation === 'list') return listSessions(options, metadata, input)
  if (input.operation === 'create') {
    requireGrant(options, 'sessions:create')
    return createSession(options, metadata, input)
  }
  if (!input.sessionId) throw new Error(`${input.operation} requires sessionId.`)
  requireSessionOperationGrants(options, input.operation)
  const session = await loadHostedSession(options, metadata, input.sessionId, adapters.loadSession)
  return match(input.operation)
    .with('status', () => sessionStatus(tasks, metadata, session))
    .with('read', () => readSession(session, input))
    .with('fork', 'clone', () => copySession(options, tasks, metadata, session, input, adapters))
    .with('message', 'steer', () =>
      Effect.runPromise(
        messageSession(options, tasks, session, input, input.operation === 'steer'),
      ),
    )
    .with('wait', () => Effect.runPromise(waitForSession(tasks, session, input)))
    .with('interrupt', () => Effect.runPromise(interruptSession(options, tasks, session)))
    .with('plan-worktree', () => planWorktree(metadata, session, input))
    .with('create-worktree', () => createWorktree(options, metadata, session, input, adapters))
    .with('handoff', () => Effect.runPromise(handoffSession(options, metadata, session, input)))
    .otherwise(() => Effect.runPromise(organizeSession(metadata, session, input)))
}

function requireSessionOperationGrants(
  options: OpenWaggleMcpServeOptions,
  operation: Exclude<SessionToolInput['operation'], 'list' | 'create'>,
) {
  if (operation === 'status' || operation === 'read' || operation === 'wait') {
    requireGrant(options, 'sessions:read')
    return
  }
  if (operation === 'fork' || operation === 'clone') {
    requireGrant(options, 'sessions:read')
    requireGrant(options, 'sessions:create')
    return
  }
  if (operation === 'create-worktree') {
    requireGrant(options, 'sessions:create')
    requireGrant(options, 'sessions:organize')
    return
  }
  if (operation === 'message' || operation === 'steer') {
    requireGrant(options, 'sessions:message')
    if (operation === 'steer') requireGrant(options, 'sessions:interrupt')
    return
  }
  if (operation === 'interrupt') {
    requireGrant(options, 'sessions:interrupt')
    return
  }
  requireGrant(options, 'sessions:organize')
}
