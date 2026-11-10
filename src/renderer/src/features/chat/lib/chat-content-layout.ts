import type { CSSProperties } from 'react'

/**
 * The shared horizontal frame for chat content and the composer.
 *
 * Transcript rows used to keep a 48px gutter while the composer used 20px. Both had the same
 * outer cap, but the useful reading width drifted by 56px. Keeping the cap and gutter together
 * makes ordinary messages, Waggle turns, status rows, and the composer align as one conversation.
 */
export const CHAT_CONTENT_MAX_WIDTH_PX = 720
export const CHAT_CONTENT_FRAME_CLASS = 'mx-auto w-full max-w-180 px-5'

/** The docked Session Summary's width, its inset from the right, and its gap to the chat. */
export const SESSION_SUMMARY_FOOTPRINT_PX = 300 + 16 + 16
/**
 * The conversation column a docked Summary must leave. Below it the Summary waits to be opened,
 * as an overlay, so a narrow window keeps its conversation.
 */
export const SESSION_SUMMARY_MIN_CONVERSATION_WIDTH_PX = 400

/**
 * Moves the conversation out from under a docked (persistent) Session Summary, which floats over
 * the chat panel's right side. The rule lives in globals.css (`.session-summary-docking`): a right
 * padding of `clamp(0px, 2 * footprint + max width - 100%, footprint)`, the least that keeps the
 * centered frame clear of the Summary, from the properties in `SESSION_SUMMARY_DOCKING_STYLE`.
 * A transient Summary still floats over the chat.
 */
export const SESSION_SUMMARY_DOCKED_CHAT_CLASS = 'session-summary-docking'
export const SESSION_SUMMARY_DOCKING_STYLE: CSSProperties & {
  readonly '--session-summary-footprint': string
  readonly '--chat-content-max-width': string
} = {
  '--session-summary-footprint': `${SESSION_SUMMARY_FOOTPRINT_PX}px`,
  '--chat-content-max-width': `${CHAT_CONTENT_MAX_WIDTH_PX}px`,
}
