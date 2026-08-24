import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSessionGrants,
  listGrantsForProject,
  listSessionGrants,
} from '../agent-authorization-grants'
import { requestAuthorization } from '../agent-authorization-request'
import {
  clearAgentLoopInteractionBrokerForTests,
  submitAgentLoopInteractionResponse,
} from '../agent-loop-interaction-broker'

const sessionId = SessionId('authorization-session')
const runId = 'run-authorization'

const scopeKey = {
  requester: 'github-issues',
  requesterId: 'github-issues-id',
  capability: 'mcp.tool-call',
  resource: 'list_issues',
} as const

function harness(input: {
  readonly mode: AgentAuthorizationMode
  readonly projectPath?: string | null
}) {
  const emitted: AgentTransportEvent[] = []
  const pending = requestAuthorization({
    sessionId,
    runId,
    projectPath: input.projectPath ?? null,
    title: 'Allow MCP tool call?',
    message: 'Server: github-issues\nTool: List issues (list_issues)',
    scopeKey,
    resolveAuthorizationMode: async () => input.mode,
    onEvent: (event) => emitted.push(event),
    runSignal: new AbortController().signal,
    newInteractionId: () => 'authorization-1',
  })
  return { emitted, pending }
}

/**
 * Waits until the request has actually been raised.
 *
 * A fixed tick is not enough and made this suite flaky under load: before registering anything,
 * `requestAuthorization` resolves the mode and then reads the project config from disk, so the
 * emitted event can arrive several macrotasks later. Polling for the event removes the guess.
 */
async function flush(emitted?: readonly AgentTransportEvent[]) {
  if (!emitted) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    return
  }

  const deadline = Date.now() + 5000
  while (emitted.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function answer(scope?: 'session' | 'project') {
  submitAgentLoopInteractionResponse({
    sessionId,
    runId,
    interactionId: 'authorization-1',
    kind: 'confirm',
    response: { kind: 'confirm', accepted: true, ...(scope ? { scope } : {}) },
  })
}

describe('requestAuthorization', () => {
  beforeEach(() => {
    clearAgentLoopInteractionBrokerForTests()
    clearSessionGrants()
  })

  it('grants immediately in full access and emits nothing at all', async () => {
    // The contract is not merely "no prompt": full access must leave no transcript entry, no
    // counter and no log, so there must be no event for anything downstream to render.
    const { emitted, pending } = harness({ mode: 'yolo' })

    await expect(pending).resolves.toBe(true)
    expect(emitted).toEqual([])
  })

  it('prompts in approval mode when nothing covers the request', async () => {
    const { emitted, pending } = harness({ mode: 'ask-for-approval' })
    await flush(emitted)

    expect(emitted[0]).toMatchObject({
      type: 'agent_interaction_request',
      interaction: { kind: 'confirm', purpose: 'authorization', scopeKey },
    })

    answer()
    await expect(pending).resolves.toBe(true)
  })

  it('returns false when the user continues without granting', async () => {
    const { emitted, pending } = harness({ mode: 'ask-for-approval' })
    await flush(emitted)

    submitAgentLoopInteractionResponse({
      sessionId,
      runId,
      interactionId: 'authorization-1',
      kind: 'confirm',
      response: { kind: 'confirm', accepted: false },
    })

    await expect(pending).resolves.toBe(false)
  })

  it('leaves nothing behind for a once-only approval', async () => {
    const { emitted, pending } = harness({ mode: 'ask-for-approval' })
    await flush(emitted)
    answer()
    await pending

    expect(listSessionGrants(sessionId)).toEqual([])
  })

  it('keeps a session approval and stops asking for the rest of the session', async () => {
    const first = harness({ mode: 'ask-for-approval' })
    await flush(first.emitted)
    answer('session')
    await expect(first.pending).resolves.toBe(true)
    expect(listSessionGrants(sessionId)).toHaveLength(1)

    const second = harness({ mode: 'ask-for-approval' })
    await expect(second.pending).resolves.toBe(true)
    expect(second.emitted).toEqual([])
  })

  it('does not reuse a session approval for a different tool', async () => {
    const first = harness({ mode: 'ask-for-approval' })
    await flush(first.emitted)
    answer('session')
    await first.pending

    const emitted: AgentTransportEvent[] = []
    const other = requestAuthorization({
      sessionId,
      runId,
      projectPath: null,
      title: 'Allow MCP tool call?',
      message: 'Tool: Create issue (create_issue)',
      scopeKey: { ...scopeKey, resource: 'create_issue' },
      resolveAuthorizationMode: async () => 'ask-for-approval',
      onEvent: (event) => emitted.push(event),
      runSignal: new AbortController().signal,
      newInteractionId: () => 'authorization-2',
    })
    await flush(emitted)

    expect(emitted).toHaveLength(1)
    submitAgentLoopInteractionResponse({
      sessionId,
      runId,
      interactionId: 'authorization-2',
      kind: 'confirm',
      response: { kind: 'confirm', accepted: false },
    })
    await expect(other).resolves.toBe(false)
  })
})

describe('requestAuthorization with a project', () => {
  let projectPath = ''

  beforeEach(async () => {
    clearAgentLoopInteractionBrokerForTests()
    clearSessionGrants()
    projectPath = await mkdtemp(path.join(tmpdir(), 'openwaggle-authorization-test-'))
  })

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  it('persists a project approval and stops asking afterwards', async () => {
    const first = harness({ mode: 'ask-for-approval', projectPath })
    await flush(first.emitted)
    answer('project')
    await expect(first.pending).resolves.toBe(true)

    await expect(listGrantsForProject(projectPath)).resolves.toHaveLength(1)

    clearSessionGrants()
    const second = harness({ mode: 'ask-for-approval', projectPath })
    await expect(second.pending).resolves.toBe(true)
    expect(second.emitted).toEqual([])
  })

  it('falls back to the session when there is no project to write to', async () => {
    // Narrower than the user asked for, never wider, and never silently dropped.
    const { emitted, pending } = harness({ mode: 'ask-for-approval', projectPath: null })
    await flush(emitted)
    answer('project')
    await pending

    expect(listSessionGrants(sessionId)).toHaveLength(1)
  })

  it('ignores a stored grant in full access without consulting the project file', async () => {
    const spy = vi.spyOn(console, 'warn')
    const { emitted, pending } = harness({ mode: 'yolo', projectPath })

    await expect(pending).resolves.toBe(true)
    expect(emitted).toEqual([])
    spy.mockRestore()
  })
})
