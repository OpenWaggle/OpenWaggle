import { Schema } from '@shared/schema'
import {
  LOCAL_SESSION_PROTOCOL_NAME,
  LOCAL_SESSION_REVISION_2_CAPABILITIES,
  LOCAL_SESSION_REVISION_3_CAPABILITIES,
  LOCAL_SESSION_REVISION_4_CAPABILITIES,
  LOCAL_SESSION_REVISION_5_CAPABILITIES,
  LOCAL_SESSION_SUPPORTED_REVISIONS,
  type LocalSessionNegotiationResult,
} from '@shared/types/local-session-protocol'

const [currentRevision, hostUiRevision, compactionRevision, waggleRevision, legacyRevision] =
  LOCAL_SESSION_SUPPORTED_REVISIONS
const MAX_NEGOTIATION_REVISIONS = 16
const [
  subscribeCapability,
  replayCapability,
  mutateCapability,
  queryCapability,
  snapshotCapability,
  accessProfilesCapability,
  localUiMutationCapability,
] = LOCAL_SESSION_REVISION_2_CAPABILITIES
const [, , , , , , , waggleRunCapability, waggleCancelCapability] =
  LOCAL_SESSION_REVISION_3_CAPABILITIES
const [, , , , , , , , , localCompactionCapability] = LOCAL_SESSION_REVISION_4_CAPABILITIES
const [, , , , , , , , , , hostUiCapability] = LOCAL_SESSION_REVISION_5_CAPABILITIES

const supportedRevisionListSchema = Schema.Array(
  Schema.Number.pipe(Schema.int(), Schema.positive()),
).pipe(Schema.minItems(1), Schema.maxItems(MAX_NEGOTIATION_REVISIONS))

const revision2CapabilitySchema = Schema.Tuple(
  Schema.Literal(subscribeCapability),
  Schema.Literal(replayCapability),
  Schema.Literal(mutateCapability),
  Schema.Literal(queryCapability),
  Schema.Literal(snapshotCapability),
  Schema.Literal(accessProfilesCapability),
  Schema.Literal(localUiMutationCapability),
)
const revision3CapabilitySchema = Schema.Tuple(
  Schema.Literal(subscribeCapability),
  Schema.Literal(replayCapability),
  Schema.Literal(mutateCapability),
  Schema.Literal(queryCapability),
  Schema.Literal(snapshotCapability),
  Schema.Literal(accessProfilesCapability),
  Schema.Literal(localUiMutationCapability),
  Schema.Literal(waggleRunCapability),
  Schema.Literal(waggleCancelCapability),
)
const revision4CapabilitySchema = Schema.Tuple(
  Schema.Literal(subscribeCapability),
  Schema.Literal(replayCapability),
  Schema.Literal(mutateCapability),
  Schema.Literal(queryCapability),
  Schema.Literal(snapshotCapability),
  Schema.Literal(accessProfilesCapability),
  Schema.Literal(localUiMutationCapability),
  Schema.Literal(waggleRunCapability),
  Schema.Literal(waggleCancelCapability),
  Schema.Literal(localCompactionCapability),
)
const currentCapabilitySchema = Schema.Tuple(
  Schema.Literal(subscribeCapability),
  Schema.Literal(replayCapability),
  Schema.Literal(mutateCapability),
  Schema.Literal(queryCapability),
  Schema.Literal(snapshotCapability),
  Schema.Literal(accessProfilesCapability),
  Schema.Literal(localUiMutationCapability),
  Schema.Literal(waggleRunCapability),
  Schema.Literal(waggleCancelCapability),
  Schema.Literal(localCompactionCapability),
  Schema.Literal(hostUiCapability),
)

export const localSessionNegotiationResultSchema: Schema.Schema<LocalSessionNegotiationResult> =
  Schema.Union(
    Schema.Struct({
      accepted: Schema.Literal(true),
      protocol: Schema.Literal(LOCAL_SESSION_PROTOCOL_NAME),
      revision: Schema.Literal(currentRevision),
      hostInstanceId: Schema.String,
      capabilities: currentCapabilitySchema,
    }),
    Schema.Struct({
      accepted: Schema.Literal(true),
      protocol: Schema.Literal(LOCAL_SESSION_PROTOCOL_NAME),
      revision: Schema.Literal(hostUiRevision),
      hostInstanceId: Schema.String,
      capabilities: currentCapabilitySchema,
    }),
    Schema.Struct({
      accepted: Schema.Literal(true),
      protocol: Schema.Literal(LOCAL_SESSION_PROTOCOL_NAME),
      revision: Schema.Literal(compactionRevision),
      hostInstanceId: Schema.String,
      capabilities: revision4CapabilitySchema,
    }),
    Schema.Struct({
      accepted: Schema.Literal(true),
      protocol: Schema.Literal(LOCAL_SESSION_PROTOCOL_NAME),
      revision: Schema.Literal(waggleRevision),
      hostInstanceId: Schema.String,
      capabilities: revision3CapabilitySchema,
    }),
    Schema.Struct({
      accepted: Schema.Literal(true),
      protocol: Schema.Literal(LOCAL_SESSION_PROTOCOL_NAME),
      revision: Schema.Literal(legacyRevision),
      hostInstanceId: Schema.String,
      capabilities: revision2CapabilitySchema,
    }),
    Schema.Struct({
      accepted: Schema.Literal(false),
      protocol: Schema.Literal(LOCAL_SESSION_PROTOCOL_NAME),
      code: Schema.Literal('incompatible_protocol'),
      supportedRevisions: supportedRevisionListSchema,
    }),
    Schema.Struct({
      accepted: Schema.Literal(false),
      protocol: Schema.Literal(LOCAL_SESSION_PROTOCOL_NAME),
      code: Schema.Literal('host_upgrade_pending'),
      hostInstanceId: Schema.String,
      supportedRevisions: supportedRevisionListSchema,
      blockingRuns: Schema.Array(Schema.Struct({ sessionId: Schema.String, runId: Schema.String })),
      blockingOperations: Schema.Array(
        Schema.Struct({
          operationId: Schema.String,
          operation: Schema.String,
          targetScope: Schema.String,
        }),
      ),
    }),
  )
