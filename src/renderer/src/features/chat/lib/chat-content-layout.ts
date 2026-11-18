import {
  SESSION_SUMMARY_RIGHT_INSET_PX,
  SESSION_SUMMARY_WIDTH_PX,
} from '@/features/session-summary'

/**
 * The shared horizontal frame for chat content and the composer.
 *
 * Transcript rows used to keep a 48px gutter while the composer used 20px. Both had the same
 * outer cap, but the useful reading width drifted by 56px. Keeping the cap and gutter together
 * makes ordinary messages, Waggle turns, status rows, and the composer align as one conversation.
 * `chat-content-frame` is the hook globals.css uses to move every frame clear of a docked Session
 * Summary.
 */
export const CHAT_CONTENT_MAX_WIDTH_PX = 720
export const CHAT_CONTENT_FRAME_CLASS = 'chat-content-frame mx-auto w-full max-w-180 px-5'

/** The gap between a docked Session Summary and the conversation frame. */
const SESSION_SUMMARY_CONTENT_GAP_PX = 16
/** The width a docked Session Summary takes from the right of the chat panel. */
export const SESSION_SUMMARY_FOOTPRINT_PX =
  SESSION_SUMMARY_WIDTH_PX + SESSION_SUMMARY_RIGHT_INSET_PX + SESSION_SUMMARY_CONTENT_GAP_PX

/** The chat panel's class while it can dock a Session Summary; globals.css keys on it. */
export const SESSION_SUMMARY_DOCKED_CHAT_CLASS = 'session-summary-docking'
/** The custom property, in px, by which the conversation frames move clear of the Summary. */
export const SESSION_SUMMARY_RESERVE_PROPERTY = '--session-summary-reserve'

/**
 * The least width a docked Summary must take from the conversation for the centered frame to clear
 * it: none where the panel has room beside the centered column, up to the whole footprint, where the
 * frame fills what is left. A frame of width f centered in w - r ends at (w - r + f) / 2, which
 * clears the Summary at w - footprint when r >= 2 * footprint + f - w.
 */
export function sessionSummaryReservePx(panelWidth: number) {
  // The footprint counts on both sides of the centered frame.
  const needed =
    SESSION_SUMMARY_FOOTPRINT_PX +
    SESSION_SUMMARY_FOOTPRINT_PX +
    CHAT_CONTENT_MAX_WIDTH_PX -
    panelWidth
  return Math.min(SESSION_SUMMARY_FOOTPRINT_PX, Math.max(0, needed))
}
