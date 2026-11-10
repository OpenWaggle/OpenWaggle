import { describe, expect, it } from 'vitest'
import { classifyAccessCliError } from '../access-cli-output'
import { sessionCliExitCodeForError } from '../session-cli-exit-status'
import {
  LocalSessionClientProtocolError,
  localSessionClientProtocolError,
} from '../session-host/local-session-client-protocol-error'

describe('Access CLI protocol error classification', () => {
  it('classifies a POSIX authentication failure by the kind the Session Host gave it', () => {
    const error = localSessionClientProtocolError(
      { kind: 'error', code: 'authentication_failed', errorKind: 'authentication', message: '' },
      'Local Session authentication failed.',
    )

    const kind = classifyAccessCliError(error)
    expect(kind).toBe('authentication')
    expect(sessionCliExitCodeForError(kind)).toBe(3)
  })

  it('classifies a Windows identity-proof failure the client refused itself', () => {
    const error = new LocalSessionClientProtocolError(
      'authentication_failed',
      'Local Session Host identity verification failed.',
      { errorKind: 'authentication' },
    )

    const kind = classifyAccessCliError(error)
    expect(kind).toBe('authentication')
    expect(sessionCliExitCodeForError(kind)).toBe(3)
  })
})
