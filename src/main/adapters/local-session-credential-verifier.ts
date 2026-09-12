import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { LocalSessionCredentialVerifier } from '../ports/local-session-credential-verifier'
import { verifyProfileCredential } from '../session-host/profile-credential'

export const LocalSessionCredentialVerifierLive = Layer.succeed(LocalSessionCredentialVerifier, {
  verify: (input) =>
    Effect.tryPromise({
      try: () => verifyProfileCredential(input.credential, input.verifier),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
})
