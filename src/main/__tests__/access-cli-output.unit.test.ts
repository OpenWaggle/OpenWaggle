import { describe, expect, it } from 'vitest'
import {
  AmbiguousProfileOperationError,
  classifyAccessCliError,
  writeAccessCliError,
} from '../access-cli-output'
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

  it('carries the Session Host code in the JSON error envelope', () => {
    let written = ''
    writeAccessCliError(
      new LocalSessionClientProtocolError('capability_denied', 'access:profiles is required.'),
      true,
      (value) => {
        written += value
      },
    )

    expect(JSON.parse(written)).toEqual({
      schemaVersion: 1,
      type: 'error',
      error: {
        kind: 'authorization',
        message: 'access:profiles is required.',
        code: 'capability_denied',
      },
    })
  })

  it('carries the code of a Session Host refusal an uncertain operation wraps', () => {
    let written = ''
    writeAccessCliError(
      new AmbiguousProfileOperationError('The profile may have been created.', {
        cause: new LocalSessionClientProtocolError('profile_revoked', 'Profile revoked.'),
      }),
      true,
      (value) => {
        written += value
      },
    )

    expect(JSON.parse(written)).toMatchObject({
      error: { kind: 'authentication', code: 'profile_revoked' },
    })
  })
})
