import { match } from '@diegogbrisa/ts-match'
import type { OpenWaggleMcpServeOptions, OpenWaggleMcpServer } from './openwaggle-mcp-server-policy'
import { loadGrantedSession, requireGrant, sessionAllowed } from './openwaggle-mcp-server-policy'
import {
  handoffSession,
  interruptSession,
  messageSession,
  organizeSession,
  waitForSession,
} from './openwaggle-mcp-session-actions'
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
import { listSessions, readSession, sessionStatus } from './openwaggle-mcp-session-queries'

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
  const session = adapters.loadSession
    ? await adapters.loadSession(input.sessionId)
    : await loadGrantedSession(options, input.sessionId)
  if (!sessionAllowed(options, session)) {
    throw new Error(
      `Session ${JSON.stringify(input.sessionId)} was not found in the granted scope.`,
    )
  }
  return match(input.operation)
    .with('status', () => sessionStatus(tasks, metadata, session))
    .with('read', () => readSession(session, input))
    .with('fork', 'clone', () => copySession(options, tasks, metadata, session, input, adapters))
    .with('message', 'steer', () =>
      messageSession(options, tasks, session, input, input.operation === 'steer'),
    )
    .with('wait', () => waitForSession(tasks, session, input))
    .with('interrupt', () => interruptSession(options, tasks, session))
    .with('plan-worktree', () => planWorktree(session, input))
    .with('create-worktree', () => createWorktree(session, input, adapters))
    .with('handoff', () => handoffSession(options, metadata, session, input))
    .otherwise(() => organizeSession(metadata, session, input))
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
