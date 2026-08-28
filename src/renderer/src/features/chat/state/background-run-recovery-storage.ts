import { Schema, safeDecodeUnknown } from '@shared/schema'
import { agentSendPayloadSchema, toAgentSendPayload } from '@shared/schemas/validation'
import { toWaggleConfig, waggleConfigSchema } from '@shared/schemas/waggle'
import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { FirstSendRecovery } from './background-run-store'

export const BACKGROUND_RUN_RECOVERY_STORAGE_KEY = 'openwaggle:background-run-recovery:v1'

const worktreeLaunchSchema = Schema.Struct({
  status: Schema.Literal('running', 'complete', 'failed'),
  stage: Schema.Literal(
    'preparing-workspace',
    'checking-out-files',
    'worktree-created',
    'starting-task',
  ),
  startedAt: Schema.Number,
  updatedAt: Schema.Number,
  details: Schema.mutable(Schema.Array(Schema.String)),
  progressPercentage: Schema.optional(Schema.Number),
  worktreePath: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  baseRef: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String),
})

const persistedRecoverySchema = Schema.Struct({
  version: Schema.Literal(1),
  launches: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        sessionId: Schema.String,
        launch: worktreeLaunchSchema,
      }),
    ),
  ),
  recoveries: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        sessionId: Schema.String,
        payload: agentSendPayloadSchema,
        waggleConfig: Schema.NullOr(waggleConfigSchema),
        model: Schema.String,
      }),
    ),
  ),
})

interface RecoverableBackgroundRuns {
  readonly launches: Map<SessionId, WorktreeLaunchSnapshot>
  readonly recoveries: Map<SessionId, FirstSendRecovery>
}

function storage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function compactRecoveryPayload(recovery: FirstSendRecovery): FirstSendRecovery {
  return {
    ...recovery,
    payload: {
      ...recovery.payload,
      attachments: recovery.payload.attachments.map((attachment) => ({
        ...attachment,
        // Main owns the durable capability and rehydrates extracted contents from disk.
        // Keeping megabytes of extracted text here exceeds localStorage quotas.
        extractedText: '',
      })),
    },
  }
}

export function loadRecoverableBackgroundRuns(): RecoverableBackgroundRuns {
  const empty = {
    launches: new Map<SessionId, WorktreeLaunchSnapshot>(),
    recoveries: new Map<SessionId, FirstSendRecovery>(),
  }
  const target = storage()
  if (!target) return empty

  try {
    const raw = target.getItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY)
    if (!raw) return empty
    const decoded = safeDecodeUnknown(persistedRecoverySchema, JSON.parse(raw))
    if (!decoded.success) {
      target.removeItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY)
      return empty
    }
    return {
      launches: new Map(
        decoded.data.launches.map(({ sessionId, launch }) => [SessionId(sessionId), launch]),
      ),
      recoveries: new Map(
        decoded.data.recoveries.map(({ sessionId, payload, waggleConfig, model }) => [
          SessionId(sessionId),
          {
            payload: toAgentSendPayload(payload),
            waggleConfig: waggleConfig ? toWaggleConfig(waggleConfig) : null,
            model: SupportedModelId(model),
          },
        ]),
      ),
    }
  } catch {
    target.removeItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY)
    return empty
  }
}

export function persistRecoverableBackgroundRuns(input: RecoverableBackgroundRuns) {
  const target = storage()
  if (!target) return
  if (input.launches.size === 0 && input.recoveries.size === 0) {
    target.removeItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY)
    return
  }

  try {
    target.setItem(
      BACKGROUND_RUN_RECOVERY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        launches: [...input.launches].map(([sessionId, launch]) => ({ sessionId, launch })),
        recoveries: [...input.recoveries].map(([sessionId, recovery]) => ({
          sessionId,
          ...compactRecoveryPayload(recovery),
        })),
      }),
    )
  } catch {
    // Recovery is best-effort; storage can be disabled or over quota.
  }
}
