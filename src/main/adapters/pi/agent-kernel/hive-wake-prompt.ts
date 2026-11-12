import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent'
import { HIVE_WAKE_NOTICE_TEXT } from '@shared/constants/hive'
import type { AgentTransportUserMessage } from '@shared/types/stream'
import type { PiEntryProjection } from './entry-projections'
import { buildMessageNodeContentJson, buildRawNodeContentJson } from './message-parts'

/** The custom type of the Host-authored message that starts a Hive wake Run. */
export const HIVE_WAKE_CUSTOM_TYPE = 'openwaggle-hive-wake'

/**
 * What a Hive wake Run is told. The Worker updates themselves arrive just before it, as the
 * orchestration update the Run delivers when it starts; this message only says why the Run began.
 */
export const HIVE_WAKE_PROMPT =
  'OpenWaggle Host-authored Hive wake, not a message from the user. Worker updates arrived while you were idle, so the Host started this Run. Read the orchestration update above, review or answer those Workers, and continue the work you were coordinating. If you told the user you would report back, report back now; if other Workers are still working, say so briefly and end your turn: the Host wakes you again when they finish.'

/**
 * Starts a Hive wake Run: a Host-authored custom message triggers the turn, so the transcript
 * shows no user message the user never wrote. Resolves when the Run ends, like `session.prompt`.
 */
export async function promptPiSessionForHiveWake(session: AgentSession) {
  await session.sendCustomMessage(
    {
      customType: HIVE_WAKE_CUSTOM_TYPE,
      content: HIVE_WAKE_PROMPT,
      display: false,
      details: { source: 'openwaggle', kind: 'hive-wake' },
    },
    { triggerTurn: true },
  )
}

/**
 * The wake message's transcript node: a user-role row holding the Host's notice, so the chat
 * folds the wake Run as its own turn and shows it as a notice rather than a user message.
 */
export function hiveWakeProjection() {
  return {
    kind: 'user_message',
    role: 'user',
    contentJson: buildMessageNodeContentJson([{ type: 'text', text: HIVE_WAKE_NOTICE_TEXT }], null),
    metadataJson: buildRawNodeContentJson({ hiveWake: true }),
  } satisfies PiEntryProjection
}

export function isHiveWakeEntry(entry: Extract<SessionEntry, { type: 'custom_message' }>) {
  return entry.customType === HIVE_WAKE_CUSTOM_TYPE
}

/** The live row for the wake message, matching its persisted node (`hiveWakeProjection`). */
export function hiveWakeDisplay(sessionNodeCreatedOrder: number) {
  return {
    parts: [{ type: 'text', text: HIVE_WAKE_NOTICE_TEXT }],
    sessionNodeCreatedOrder,
    hiveWake: true,
  } satisfies AgentTransportUserMessage
}
