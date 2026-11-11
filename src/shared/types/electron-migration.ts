/**
 * What the first launch after the Electron build could not move on its own
 * (docs/electrobun-transition.md), for the notice that asks the user.
 *
 * - `needs-consent`: the previous version's key is in the keychain, and reading it prompts in this
 *   build; nothing runs until the user chooses Continue.
 * - `blocked`: the keychain did not answer or refused (a denied prompt, a locked keyring).
 * - `failed`: moving the secrets failed; `error` says why.
 * - `unrecoverable`: the secrets moved, except `unrecoverable`, which no key opens.
 */
export type ElectronMigrationSecretsState = 'needs-consent' | 'blocked' | 'failed' | 'unrecoverable'

export interface ElectronMigrationNotice {
  readonly secrets: ElectronMigrationSecretsState
  /** The entries to enter again, by name. */
  readonly unrecoverable: readonly string[]
  readonly error: string | null
  readonly busy: boolean
}
