import { Schema, safeDecodeUnknown } from '@shared/schema'
import {
  worktreeLaunchEnvironmentSchema,
  worktreeLaunchStageSchema,
  worktreeLaunchStepSchema,
} from '@shared/schemas/background-run'
import { agentSendPayloadSchema, toAgentSendPayload } from '@shared/schemas/validation'
import { toWaggleConfig, waggleConfigSchema } from '@shared/schemas/waggle'
import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { FirstSendRecovery } from './background-run-store'

/**
 * Version 2 carries launch stages and steps that a version-1 renderer cannot decode. Writing them
 * under the old key made an older renderer (after an update-track downgrade) discard the whole
 * blob, including other Sessions' first-send payloads. The old key is still read once, to migrate.
 */
export const BACKGROUND_RUN_RECOVERY_STORAGE_KEY = 'openwaggle:background-run-recovery:v2'
const LEGACY_BACKGROUND_RUN_RECOVERY_STORAGE_KEY = 'openwaggle:background-run-recovery:v1'
const LEGACY_RECOVERY_STORAGE_VERSION = 1
const RECOVERY_STORAGE_VERSION = 2

const setupActionSchema = Schema.Struct({
  terminalId: Schema.String,
  actionId: Schema.String,
  actionName: Schema.String,
  projectRoot: Schema.String,
  cwd: Schema.String,
})

const worktreeLaunchSchema = Schema.Struct({
  status: Schema.Literal('running', 'complete', 'failed'),
  stage: worktreeLaunchStageSchema,
  startedAt: Schema.Number,
  updatedAt: Schema.Number,
  details: Schema.mutable(Schema.Array(Schema.String)),
  environment: Schema.optional(worktreeLaunchEnvironmentSchema),
  steps: Schema.optional(Schema.mutable(Schema.Array(worktreeLaunchStepSchema))),
  progressPercentage: Schema.optional(Schema.Number),
  worktreePath: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  baseRef: Schema.optional(Schema.String),
  setupAction: Schema.optional(setupActionSchema),
  errorMessage: Schema.optional(Schema.String),
})

const persistedLaunchSchema = Schema.Struct({
  sessionId: Schema.String,
  launch: worktreeLaunchSchema,
})

const persistedFirstSendSchema = Schema.Struct({
  sessionId: Schema.String,
  payload: agentSendPayloadSchema,
  waggleConfig: Schema.NullOr(waggleConfigSchema),
  model: Schema.String,
})

/** Entries decode one by one, so one entry this renderer cannot read never costs the others. */
const persistedRecoverySchema = Schema.Struct({
  version: Schema.Literal(LEGACY_RECOVERY_STORAGE_VERSION, RECOVERY_STORAGE_VERSION),
  launches: Schema.Array(Schema.Unknown),
  recoveries: Schema.Array(Schema.Unknown),
})

function decodeEach<A, I>(entries: readonly unknown[], schema: Schema.Schema<A, I>) {
  return entries.flatMap((entry) => {
    const decoded = safeDecodeUnknown(schema, entry)
    return decoded.success ? [decoded.data] : []
  })
}

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

  const key = target.getItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY)
    ? BACKGROUND_RUN_RECOVERY_STORAGE_KEY
    : LEGACY_BACKGROUND_RUN_RECOVERY_STORAGE_KEY
  try {
    const raw = target.getItem(key)
    if (!raw) return empty
    const decoded = safeDecodeUnknown(persistedRecoverySchema, JSON.parse(raw))
    if (!decoded.success) {
      target.removeItem(key)
      return empty
    }
    return {
      launches: new Map(
        decodeEach(decoded.data.launches, persistedLaunchSchema).map(({ sessionId, launch }) => [
          SessionId(sessionId),
          launch,
        ]),
      ),
      recoveries: new Map(
        decodeEach(decoded.data.recoveries, persistedFirstSendSchema).map(
          ({ sessionId, payload, waggleConfig, model }) => [
            SessionId(sessionId),
            {
              payload: toAgentSendPayload(payload),
              waggleConfig: waggleConfig ? toWaggleConfig(waggleConfig) : null,
              model: SupportedModelId(model),
            },
          ],
        ),
      ),
    }
  } catch {
    target.removeItem(key)
    return empty
  }
}

export function persistRecoverableBackgroundRuns(input: RecoverableBackgroundRuns) {
  const target = storage()
  if (!target) return
  // The legacy copy has been migrated into memory; leaving it would resurrect stale recoveries.
  target.removeItem(LEGACY_BACKGROUND_RUN_RECOVERY_STORAGE_KEY)
  if (input.launches.size === 0 && input.recoveries.size === 0) {
    target.removeItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY)
    return
  }

  try {
    target.setItem(
      BACKGROUND_RUN_RECOVERY_STORAGE_KEY,
      JSON.stringify({
        version: RECOVERY_STORAGE_VERSION,
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
