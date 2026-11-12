import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { Schema } from '@shared/schema'
import {
  agentTransportCustomEventSchema,
  agentTransportInteractionRequestEventSchema,
  agentTransportInteractionResolvedEventSchema,
} from './stream'

/** The transport events a Run records durably as Agent loop audit nodes. */
export const durableAgentLoopEventSchema = Schema.Union(
  agentTransportCustomEventSchema,
  agentTransportInteractionRequestEventSchema,
  agentTransportInteractionResolvedEventSchema,
)

const sessionEventCustomTypeSchema = Schema.Literal(OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE)

/** The content an Agent loop audit node stores: the single source of its type. */
export const durableAgentLoopEventNodeContentSchema = Schema.Struct({
  customType: sessionEventCustomTypeSchema,
  event: durableAgentLoopEventSchema,
})

/**
 * An audit node's `contentJson`, with the event left undecoded: whether a node is an audit node
 * depends only on its `customType`, and each reader decodes the event as it needs.
 */
export const agentLoopSessionEventContentJsonSchema = Schema.parseJson(
  Schema.Struct({
    customType: sessionEventCustomTypeSchema,
    event: Schema.optionalWith(Schema.Unknown, { exact: true }),
  }),
)
