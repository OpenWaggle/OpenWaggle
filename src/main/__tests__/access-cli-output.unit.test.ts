import { describe, expect, it } from 'vitest'
import { classifyAccessCliError } from '../access-cli-output'
import { sessionCliExitCodeForError } from '../session-cli-exit-status'
import {
  LocalSessionClientProtocolError,
  localSessionClientProtocolError,
} from '../session-host/local-session-client-protocol-error'

describe('Access CLI protocol error classification', () => {
  it('classifies a POSIX authentication failure from its protocol code', () => {
    const error = localSessionClientProtocolError(
      { kind: 'error', code: 'authentication_failed', message: '' },
      'Local Session authentication failed.',
    )

    const kind = classifyAccessCliError(error)
    expect(kind).toBe('authentication')
    expect(sessionCliExitCodeForError(kind)).toBe(3)
  })

  it('classifies a Windows identity-proof failure from its typed code', () => {
    const error = new LocalSessionClientProtocolError(
      'authentication_failed',
      'Local Session Host identity verification failed.',
    )

    const kind = classifyAccessCliError(error)
    expect(kind).toBe('authentication')
    expect(sessionCliExitCodeForError(kind)).toBe(3)
  })
})
