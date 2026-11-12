import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authorizeLocalSessionCommand } from '../../application/local-session-command-dispatcher'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SettingsService } from '../../services/settings-service'
import { agentDefinitionProjectProbe } from '../agent-definition-project-probe'
import { sessionCommandFailureMessage } from '../session-command-failure-message'
import {
  GOSAFE,
  OPENWAGGLE,
  PROJECT_BY_SESSION,
  resolveCallers,
} from './session-tool-cross-project-callers.test-support'

const authorizationLayer = Layer.mergeAll(
  Layer.succeed(SessionAuthorizationTargetRepository, {
    resolve: (sessionId) =>
      Effect.succeed({
        sessionId,
        projectPath: PROJECT_BY_SESSION[sessionId] ?? '/projects/unknown',
        hiveRootSessionId: sessionId === 'gosafe-worker' ? 'gosafe-root' : sessionId,
        authorizationCeiling: 'yolo',
      }),
    resolveDelegation: (delegationId) =>
      Effect.succeed({
        sessionId: delegationId,
        projectPath: OPENWAGGLE,
        hiveRootSessionId: delegationId,
        authorizationCeiling: 'yolo',
      }),
    runInputWidensReach: () => Effect.succeed(false),
    listLiveDerivedAuthorities: () => Effect.succeed([]),
  }),
  Layer.succeed(SettingsService, {
    get: () => Effect.succeed(DEFAULT_SETTINGS),
    update: () => Effect.void,
    initialize: () => Effect.void,
    flushForTests: () => Effect.void,
  }),
)

function queryPayload(
  query: Extract<LocalSessionCommandPayload, { contract: 'session-query-v2' }>['request']['query'],
) {
  return {
    contract: 'session-query-v2',
    request: { contractVersion: 2, requestId: 'request-query', query },
  } satisfies LocalSessionCommandPayload
}

function controlPayload(
  command: Extract<
    LocalSessionCommandPayload,
    { contract: 'session-control-v2' }
  >['request']['command'],
) {
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: 2,
      requestId: `request-${command.operation}`,
      idempotencyKey: `idempotency-${command.operation}`,
      command,
    },
  } satisfies LocalSessionCommandPayload
}

function lifecyclePayload(
  command: Extract<
    LocalSessionCommandPayload,
    { contract: 'session-lifecycle-v2' }
  >['request']['command'],
) {
  return {
    contract: 'session-lifecycle-v2',
    request: {
      contractVersion: 2,
      requestId: `request-${command.operation}`,
      idempotencyKey: `idempotency-${command.operation}`,
      command,
    },
  } satisfies LocalSessionCommandPayload
}

const crossProjectPayloads = {
  list: queryPayload({ operation: 'list', limit: 50, projectPath: OPENWAGGLE }),
  search: queryPayload({
    operation: 'search',
    query: 'handoff',
    limit: 20,
    projectPath: OPENWAGGLE,
  }),
  read: queryPayload({ operation: 'read', sessionId: 'openwaggle-root' }),
  // What agent_definitions_list sends before it reads another project's Agent definitions.
  agentDefinitionsProbe: agentDefinitionProjectProbe(OPENWAGGLE),
  launch: lifecyclePayload({
    operation: 'launch',
    projectPath: OPENWAGGLE,
    objective: 'Fix the scratch-directory bug.',
    attachmentIds: [],
    workspace: { mode: 'new-worktree' },
  }),
  create: lifecyclePayload({ operation: 'create', projectPath: OPENWAGGLE }),
  followUp: controlPayload({
    operation: 'follow-up',
    sessionId: 'openwaggle-root',
    input: { text: 'Here is the report.', attachmentIds: [] },
  }),
} satisfies Record<string, LocalSessionCommandPayload>

function authorize(caller: LocalSessionCallerIdentity, payload: LocalSessionCommandPayload) {
  return Effect.runPromise(
    authorizeLocalSessionCommand({ caller, payload }).pipe(Effect.provide(authorizationLayer)),
  )
}

describe('Hive tool cross-project authority', () => {
  let root = ''
  let callers: Awaited<ReturnType<typeof resolveCallers>>

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cross-project-authority-'))
    callers = await resolveCallers(path.join(root, 'authority.sqlite'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('gives a user-originated root Session agent every project in the local catalog', () => {
    expect(callers.independent.profileAuthority?.scope).toEqual({
      all: true,
      exportRoots: [GOSAFE],
      attachmentRoots: [GOSAFE],
    })
    expect(callers.allProfile.profileAuthority?.scope).toMatchObject({ all: true })
  })

  it.each(Object.entries(crossProjectPayloads))(
    'lets an Independent Session in one project %s in another project',
    async (_name, payload) => {
      await expect(authorize(callers.independent, payload)).resolves.toBeUndefined()
      await expect(authorize(callers.allProfile, payload)).resolves.toBeUndefined()
    },
  )

  it.each(Object.entries(crossProjectPayloads))(
    'keeps a Worker and a project-scoped profile out of another project for %s',
    async (_name, payload) => {
      for (const caller of [callers.worker, callers.projectProfile]) {
        const failure = await authorize(caller, payload).then(
          () => undefined,
          (error: unknown) => error,
        )
        // Assert the reason, so a refusal for some unrelated cause cannot keep this green.
        expect(sessionCommandFailureMessage(failure)).toContain('(target_scope_denied)')
      }
    },
  )

  // A caller limited to one project must not borrow a desktop Session's reach by messaging it.
  it.each(Object.entries(crossProjectPayloads))(
    'keeps a desktop Session whose Run a project-scoped profile started out of another project for %s',
    async (_name, payload) => {
      const failure = await authorize(callers.drivenByProfile, payload).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(sessionCommandFailureMessage(failure)).toContain('(target_scope_denied)')
    },
  )

  it('bounds the agent ceiling by an ask-for-approval profile that started its Run', () => {
    expect(callers.independent.profileAuthority?.authorizationCeiling).toBe('yolo')
    // The Session is yolo, but its Run acts for an ask-for-approval caller.
    expect(callers.askedByProfile.profileAuthority?.authorizationCeiling).toBe('ask-for-approval')
  })

  it('names the refusal reason instead of a generic failure', async () => {
    const failure = await authorize(callers.projectProfile, crossProjectPayloads.launch).then(
      () => undefined,
      (error: unknown) => error,
    )
    const message = sessionCommandFailureMessage(failure)
    expect(message).not.toContain('An error has occurred')
    expect(message).toContain('target_scope_denied')
    expect(message).toContain('outside the authorized scope')
  })
})
