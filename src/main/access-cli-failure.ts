import {
  AmbiguousProfileOperationError,
  preservedProfileCredentialError,
  writeAccessCliCleanupError,
  writeAccessCliError,
} from './access-cli-output'
import { sessionCliExitCodeForError } from './session-cli-exit-status'
import type { stageProfileCredential } from './session-host/profile-credential-destination'

export async function settleAccessCliFailure(input: {
  readonly error: unknown
  readonly accepted: boolean
  readonly staged: Awaited<ReturnType<typeof stageProfileCredential>> | undefined
  readonly json: boolean
}) {
  const { error, accepted, staged, json } = input
  if (!accepted && staged?.recoveredPending) {
    return sessionCliExitCodeForError(
      writeAccessCliError(preservedProfileCredentialError(error, staged.recoveryLocation), json),
    )
  }
  if (
    !accepted &&
    !(error instanceof AmbiguousProfileOperationError && error.preserveStagedCredential)
  ) {
    try {
      await staged?.discard()
    } catch (cleanupError) {
      return sessionCliExitCodeForError(writeAccessCliCleanupError(error, cleanupError, json))
    }
  }
  return sessionCliExitCodeForError(writeAccessCliError(error, json))
}
