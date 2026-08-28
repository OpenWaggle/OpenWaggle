/**
 * The shared horizontal frame for chat content and the composer.
 *
 * Transcript rows used to keep a 48px gutter while the composer used 20px. Both had the same
 * outer cap, but the useful reading width drifted by 56px. Keeping the cap and gutter together
 * makes ordinary messages, Waggle turns, status rows, and the composer align as one conversation.
 */
export const CHAT_CONTENT_FRAME_CLASS = 'mx-auto w-full max-w-180 px-5'
