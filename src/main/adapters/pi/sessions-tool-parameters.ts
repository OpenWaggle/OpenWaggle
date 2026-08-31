import {
  SESSION_QUERY_DISCOVERY_LIMIT,
  SESSION_QUERY_MAX_WAIT_MS,
  SESSION_QUERY_WAIT_TARGET_LIMIT,
} from '@shared/types/session-query'
import { type Static, Type } from 'typebox'
import { sessionsToolCollaborationParameters } from './sessions-tool-collaboration-parameters'
import { sessionsToolControlParameters } from './sessions-tool-control-parameters'
import { delegationsConflictsParameter } from './sessions-tool-delegation-extra-parameters'
import { sessionsToolExportOperationParameters } from './sessions-tool-export-operation-parameters'
import { sessionsToolReadParameters } from './sessions-tool-query-parameters'
import { sessionsToolQueueParameters } from './sessions-tool-queue-parameters'

const AGENT_DEFINITION_RESULT_LIMIT = 100

const workspace = Type.Optional(
  Type.Union([Type.Literal('share-parent'), Type.Literal('local'), Type.Literal('new-worktree')]),
)

const rootWorkspace = Type.Optional(
  Type.Union([
    Type.Literal('current'),
    Type.Literal('local'),
    Type.Literal('new-worktree'),
    Type.Literal('existing'),
  ]),
)

const rootSpecialization = {
  agent: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
}

export const sessionsToolParameters = Type.Union([
  Type.Object({
    action: Type.Literal('create'),
    projectPath: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    workspace: rootWorkspace,
    workspaceId: Type.Optional(Type.String()),
    baseRef: Type.Optional(Type.String()),
    startFromOrigin: Type.Optional(Type.Boolean()),
    ...rootSpecialization,
  }),
  Type.Object({
    action: Type.Literal('fork'),
    sessionId: Type.Optional(Type.String()),
    targetNodeId: Type.Optional(Type.String()),
    position: Type.Optional(Type.Union([Type.Literal('before'), Type.Literal('at')])),
    title: Type.Optional(Type.String()),
    workspace: Type.Optional(
      Type.Union([
        Type.Literal('share-source'),
        Type.Literal('local'),
        Type.Literal('new-worktree'),
        Type.Literal('existing'),
      ]),
    ),
    workspaceId: Type.Optional(Type.String()),
    baseRef: Type.Optional(Type.String()),
    startFromOrigin: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    action: Type.Literal('launch'),
    objective: Type.String({ minLength: 1 }),
    projectPath: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    workspace: rootWorkspace,
    workspaceId: Type.Optional(Type.String()),
    baseRef: Type.Optional(Type.String()),
    startFromOrigin: Type.Optional(Type.Boolean()),
    authorization: Type.Optional(
      Type.Union([Type.Literal('ask-for-approval'), Type.Literal('yolo')]),
    ),
    interactionTimeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
    ...rootSpecialization,
  }),
  Type.Object({
    action: Type.Literal('spawn'),
    objective: Type.String({ minLength: 1 }),
    workspace,
    baseRef: Type.Optional(Type.String()),
    startFromOrigin: Type.Optional(Type.Boolean()),
    ...rootSpecialization,
    deliverables: Type.Optional(Type.Array(Type.String())),
    acceptanceCriteria: Type.Optional(Type.Array(Type.String())),
    resourceReferences: Type.Optional(Type.Array(Type.String())),
    authorization: Type.Optional(
      Type.Union([Type.Literal('ask-for-approval'), Type.Literal('yolo')]),
    ),
    interactionTimeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
  Type.Object({
    action: Type.Literal('message'),
    sessionId: Type.String(),
    text: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    action: Type.Literal('start'),
    sessionId: Type.String(),
    text: Type.String({ minLength: 1 }),
    authorization: Type.Optional(
      Type.Union([Type.Literal('ask-for-approval'), Type.Literal('yolo')]),
    ),
    interactionTimeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
  Type.Object({
    action: Type.Literal('follow_up'),
    sessionId: Type.String(),
    text: Type.String({ minLength: 1 }),
    authorization: Type.Optional(
      Type.Union([Type.Literal('ask-for-approval'), Type.Literal('yolo')]),
    ),
  }),
  Type.Object({
    action: Type.Literal('steer'),
    sessionId: Type.String(),
    text: Type.String({ minLength: 1 }),
    expectedRunId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal('replace'),
    sessionId: Type.String(),
    text: Type.String({ minLength: 1 }),
    expectedRunId: Type.String(),
    authorization: Type.Optional(
      Type.Union([Type.Literal('ask-for-approval'), Type.Literal('yolo')]),
    ),
  }),
  Type.Object({
    action: Type.Literal('promote'),
    sessionId: Type.String(),
    followUpId: Type.String(),
    expectedRunId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal('rename'),
    sessionId: Type.String(),
    title: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    action: Type.Union([Type.Literal('archive'), Type.Literal('unarchive')]),
    sessionId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal('handoff'),
    sessionId: Type.String(),
    workspace: Type.Union([
      Type.Literal('local'),
      Type.Literal('new-worktree'),
      Type.Literal('existing'),
    ]),
    workspaceId: Type.Optional(Type.String()),
    baseRef: Type.Optional(Type.String()),
    startFromOrigin: Type.Optional(Type.Boolean()),
  }),
  ...sessionsToolControlParameters,
  ...sessionsToolCollaborationParameters,
  Type.Object({
    action: Type.Literal('delegations_list'),
    catalogScope: Type.Optional(
      Type.Union([Type.Literal('current'), Type.Literal('project'), Type.Literal('all')]),
    ),
    projectPath: Type.Optional(Type.String()),
    parentSessionId: Type.Optional(Type.String()),
    workerSessionId: Type.Optional(Type.String()),
    states: Type.Optional(
      Type.Array(
        Type.Union([
          Type.Literal('working'),
          Type.Literal('waiting'),
          Type.Literal('needs_attention'),
          Type.Literal('ready_for_review'),
          Type.Literal('revision_requested'),
          Type.Literal('accepted'),
          Type.Literal('cancelled'),
        ]),
      ),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SESSION_QUERY_DISCOVERY_LIMIT })),
    cursor: Type.Optional(Type.String()),
  }),
  Type.Object({ action: Type.Literal('delegations_read'), delegationId: Type.String() }),
  delegationsConflictsParameter,
  Type.Object({
    action: Type.Literal('list'),
    catalogScope: Type.Optional(
      Type.Union([Type.Literal('current'), Type.Literal('project'), Type.Literal('all')]),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SESSION_QUERY_DISCOVERY_LIMIT })),
    cursor: Type.Optional(Type.String()),
    projectPath: Type.Optional(Type.String()),
    archived: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    action: Type.Literal('search'),
    catalogScope: Type.Optional(
      Type.Union([Type.Literal('current'), Type.Literal('project'), Type.Literal('all')]),
    ),
    query: Type.String({ minLength: 1 }),
    projectPath: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SESSION_QUERY_DISCOVERY_LIMIT })),
    cursor: Type.Optional(Type.String()),
    fullTranscript: Type.Optional(
      Type.Boolean({
        description:
          'Search allowed transcript text in addition to discovery fields. Defaults to lexical mode unless mode is explicit.',
      }),
    ),
    mode: Type.Optional(
      Type.Union([Type.Literal('hybrid'), Type.Literal('lexical'), Type.Literal('semantic')], {
        description: 'Defaults to hybrid discovery or lexical full-transcript search.',
      }),
    ),
    requireFresh: Type.Optional(Type.Boolean()),
    waitTimeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: SESSION_QUERY_MAX_WAIT_MS })),
  }),
  ...sessionsToolReadParameters,
  ...sessionsToolQueueParameters,
  ...sessionsToolExportOperationParameters,
  Type.Object({
    action: Type.Literal('wait'),
    sessionIds: Type.Array(Type.String(), {
      minItems: 1,
      maxItems: SESSION_QUERY_WAIT_TARGET_LIMIT,
    }),
    condition: Type.Optional(
      Type.Union([
        Type.Literal('idle'),
        Type.Literal('queue-empty'),
        Type.Literal('state-revision-after'),
      ]),
    ),
    afterStateRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    timeoutMs: Type.Integer({ minimum: 0, maximum: SESSION_QUERY_MAX_WAIT_MS }),
  }),
  Type.Object({
    action: Type.Literal('agent_definitions_list'),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: AGENT_DEFINITION_RESULT_LIMIT })),
  }),
  Type.Object({
    action: Type.Literal('agent_definitions_search'),
    query: Type.String({ minLength: 1 }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: AGENT_DEFINITION_RESULT_LIMIT })),
  }),
])

export type SessionsToolParameters = Static<typeof sessionsToolParameters>
