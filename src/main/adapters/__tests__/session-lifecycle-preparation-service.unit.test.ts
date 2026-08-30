import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId, WorkspaceId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecyclePreparationService } from '../../ports/session-lifecycle-preparation-service'
import { deriveChildCapabilities } from '../session-lifecycle-execution-profile'
import { makeLifecyclePreparationLayer } from './session-lifecycle-preparation-test-support'

describe('Session lifecycle preparation service', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-prepare-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('inherits the parent Workspace and derives only non-escalating child authority', async () => {
    const createdProjects: string[] = []
    const layer = makeLifecyclePreparationLayer(
      path.join(temporaryRoot, 'prepare.sqlite'),
      createdProjects,
    )
    const prepared = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionLifecyclePreparationService
        return yield* service.prepare({
          callerId: 'profile:restricted',
          callerCapabilities: ['sessions:spawn', 'sessions:message'],
          callerAuthorizationCeiling: 'ask-for-approval',
          identities: {
            sessionId: SessionId('session-worker'),
            workspaceId: WorkspaceId('workspace-unused'),
          },
          request: {
            contractVersion: 2,
            requestId: 'request-spawn',
            idempotencyKey: 'spawn-worker',
            command: {
              operation: 'spawn',
              parentSessionId: 'session-parent',
              expectedParentRunId: 'run-parent',
              workspace: { mode: 'share-parent' },
              runAuthorizationOverride: 'yolo',
              delegation: {
                objective: 'Review the change.',
                deliverables: [],
                acceptanceCriteria: [],
                dependencies: [],
                resourceReferences: [],
              },
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(createdProjects).toEqual(['/project'])
    expect(prepared).toMatchObject({
      workspacePlan: { mode: 'parent' },
      executionSnapshot: { authorizationCeiling: 'ask-for-approval' },
      derivedCapabilities: ['sessions:spawn', 'sessions:message'],
      parentConcurrencyLimit: 9,
      hostRunCeiling: 16,
    })
  })

  it('cannot re-expand authority across three derived generations', () => {
    const request = {
      contractVersion: 2 as const,
      requestId: 'request-spawn',
      idempotencyKey: 'spawn-worker',
      command: {
        operation: 'spawn' as const,
        parentSessionId: 'parent',
        expectedParentRunId: 'run-parent',
        workspace: { mode: 'share-parent' as const },
        delegation: {
          objective: 'Continue the chain.',
          deliverables: [],
          acceptanceCriteria: [],
          dependencies: [],
          resourceReferences: [],
        },
      },
    }
    const profile = {
      modelId: 'provider/model',
      thinkingLevel: 'high' as const,
      sessionCapabilities: [
        'sessions:spawn',
        'sessions:message',
        'delegations:read',
        'delegations:review',
      ] as const,
    }
    const first = deriveChildCapabilities(
      {
        callerId: 'profile:root',
        callerCapabilities: ['sessions:spawn', 'sessions:message'],
        identities: { sessionId: SessionId('first'), workspaceId: WorkspaceId('first-workspace') },
        request,
      },
      profile,
    )
    const second = deriveChildCapabilities(
      {
        callerId: 'session-agent:first:run',
        callerCapabilities: first,
        identities: {
          sessionId: SessionId('second'),
          workspaceId: WorkspaceId('second-workspace'),
        },
        request,
      },
      profile,
    )
    const third = deriveChildCapabilities(
      {
        callerId: 'session-agent:second:run',
        callerCapabilities: second,
        identities: { sessionId: SessionId('third'), workspaceId: WorkspaceId('third-workspace') },
        request,
      },
      profile,
    )

    expect(first).toEqual(['sessions:spawn', 'sessions:message'])
    expect(second).toEqual(first)
    expect(third).toEqual(first)
  })

  it('prepares a distinct pending Workspace for an explicit new worktree', async () => {
    const layer = makeLifecyclePreparationLayer(path.join(temporaryRoot, 'worktree.sqlite'), [])
    const prepared = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionLifecyclePreparationService
        return yield* service.prepare({
          callerId: 'local-user',
          identities: {
            sessionId: SessionId('session-root'),
            workspaceId: WorkspaceId('workspace-root'),
          },
          request: {
            contractVersion: 2,
            requestId: 'request-launch',
            idempotencyKey: 'launch-root',
            command: {
              operation: 'launch',
              projectPath: '/project',
              workspace: { mode: 'new-worktree', baseRef: 'main' },
              objective: 'Implement it.',
              attachmentIds: [],
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(prepared.workspacePlan).toMatchObject({
      mode: 'provisioned',
      workspace: {
        id: 'workspace-root',
        kind: 'managed-worktree',
        lifecycleState: 'pending',
        worktreeBaseRef: 'main',
      },
    })
  })

  it('forks the source Pi transcript and inherits its exact execution profile and Workspace', async () => {
    const createdProjects: string[] = []
    const layer = makeLifecyclePreparationLayer(
      path.join(temporaryRoot, 'fork.sqlite'),
      createdProjects,
    )
    const prepared = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE sessions SET last_active_node_id = ${'source-node'}
          WHERE id = ${'session-parent'}
        `
        const service = yield* SessionLifecyclePreparationService
        return yield* service.prepare({
          callerId: 'local-user',
          identities: {
            sessionId: SessionId('session-fork'),
            workspaceId: WorkspaceId('workspace-fork'),
          },
          request: {
            contractVersion: 2,
            requestId: 'request-fork',
            idempotencyKey: 'fork-session',
            command: {
              operation: 'fork',
              sourceSessionId: 'session-parent',
              position: 'before',
              workspace: { mode: 'share-source' },
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(createdProjects).toEqual([])
    expect(prepared).toMatchObject({
      session: { piSessionId: 'pi-forked', piSessionFile: '/tmp/pi-forked.jsonl' },
      workspacePlan: { mode: 'parent' },
      executionSnapshot: {
        profile: { modelId: 'provider/parent', thinkingLevel: 'high' },
        authorizationCeiling: 'yolo',
      },
      forkSnapshot: { activeNodeId: 'fork-node' },
      forkEditorText: 'Retry this',
      forkSourceNodeId: 'source-node',
    })
  })

  it('resolves optional Agent definitions without allowing them to widen authority', async () => {
    const projectPath = path.join(temporaryRoot, 'project')
    const agentDirectory = path.join(projectPath, '.openwaggle', 'agents')
    await fs.mkdir(agentDirectory, { recursive: true })
    await fs.writeFile(
      path.join(agentDirectory, 'reviewer.md'),
      `---
schemaVersion: 1
name: reviewer
description: Reviews security boundaries
model: provider/definition
reasoning: high
tools: [read_file]
sessionCapabilities: [sessions:read]
authorizationMode: ask-for-approval
---

Review the delegated change and report findings.
`,
      'utf8',
    )
    const layer = makeLifecyclePreparationLayer(
      path.join(temporaryRoot, 'agent-definition.sqlite'),
      [],
      projectPath,
    )
    const prepared = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionLifecyclePreparationService
        return yield* service.prepare({
          callerId: 'local-user',
          callerCapabilities: ['sessions:spawn', 'sessions:read', 'sessions:message'],
          identities: {
            sessionId: SessionId('session-reviewer'),
            workspaceId: WorkspaceId('workspace-reviewer'),
          },
          request: {
            contractVersion: 2,
            requestId: 'request-reviewer',
            idempotencyKey: 'spawn-reviewer',
            command: {
              operation: 'spawn',
              parentSessionId: 'session-parent',
              expectedParentRunId: 'run-parent',
              workspace: { mode: 'share-parent' },
              specialization: {
                agentDefinitionName: 'reviewer',
                modelId: 'provider/explicit',
              },
              runAuthorizationOverride: 'yolo',
              delegation: {
                objective: 'Review the change.',
                deliverables: [],
                acceptanceCriteria: [],
                dependencies: [],
                resourceReferences: [],
              },
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(prepared).toMatchObject({
      executionSnapshot: {
        profile: {
          modelId: 'provider/explicit',
          thinkingLevel: 'high',
          agentDefinitionName: 'reviewer',
          tools: ['read_file'],
          sessionCapabilities: ['sessions:read'],
        },
        resolvedAgentSnapshot: {
          name: 'reviewer',
          instructions: 'Review the delegated change and report findings.',
        },
        authorizationCeiling: 'ask-for-approval',
      },
      derivedCapabilities: ['sessions:read'],
    })
  })
})
