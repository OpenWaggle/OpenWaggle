import { Context, type Effect } from 'effect'

export interface LocalSessionCredentialVerifierShape {
  readonly verify: (input: {
    readonly credential: string
    readonly verifier: string
  }) => Effect.Effect<boolean, Error>
}

export class LocalSessionCredentialVerifier extends Context.Tag(
  '@openwaggle/LocalSessionCredentialVerifier',
)<LocalSessionCredentialVerifier, LocalSessionCredentialVerifierShape>() {}
