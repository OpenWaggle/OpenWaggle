/**
 * What a user-requested Title regeneration did. A regeneration never fails the request: a model
 * that is unavailable or errors leaves the title unchanged and says so.
 */
export type SessionTitleRegenerationResult =
  /** The generated title replaced the previous one. */
  | { readonly outcome: 'renamed'; readonly title: string }
  /** The model kept the previous title because it was already accurate. */
  | { readonly outcome: 'unchanged'; readonly title: string }
  /** The title changed while the regeneration ran, so the newer title was kept. */
  | { readonly outcome: 'superseded' }
  /** The Title model is Off, the Session has nothing to title yet, or no model could be used. */
  | {
      readonly outcome: 'unavailable'
      readonly reason: SessionTitleRegenerationUnavailableReason
    }
  /** The model request failed; the message is safe to show to the user. */
  | { readonly outcome: 'failed'; readonly message: string }

export type SessionTitleRegenerationUnavailableReason = 'off' | 'empty' | 'no-model' | 'busy'
