import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClientInput: vi.fn(),
  executeCommand:
    vi.fn<(input: { readonly payload: LocalSessionCommandPayload }) => Promise<unknown>>(),
  watchEvents: vi.fn(),
}))

vi.mock('../local-session-cli-client', () => ({
  createLocalSessionCliClientInput: mocks.createClientInput,
}))

vi.mock('../session-host/local-session-client', () => ({
  executeLocalSessionCommand: mocks.executeCommand,
  watchLocalSessionEvents: mocks.watchEvents,
}))

import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { LocalSessionClientProtocolError } from '../session-host/local-session-client-protocol-error'
import { runSessionsCli } from '../sessions-cli'
import {
  accepted,
  captureCliOutput,
  interaction,
  RUN,
  requestsList,
  SESSION,
  sentCommands,
  stderr,
} from './sessions-cli-host-input.test-utils'

function sent() {
  return sentCommands(mocks.executeCommand.mock.calls)
}

describe('hive request-respond reads the pending request before it answers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClientInput.mockResolvedValue({
      paths: {},
      clientKind: 'cli',
      clientVersion: 'test',
      workingDirectory: '/project',
    })
    captureCliOutput()
  })

  it.each([
    [{ kind: 'select', choices: ['a', 'b'] }, ['--choice', 'b'], { kind: 'select', selected: 'b' }],
    [{ kind: 'select', choices: ['a'] }, ['--dismiss'], { kind: 'select', selected: null }],
    [{ kind: 'input', title: 'Name?' }, ['--text', 'Ada'], { kind: 'input', value: 'Ada' }],
    [{ kind: 'editor', title: 'Edit' }, ['--text', 'Body'], { kind: 'editor', value: 'Body' }],
    [{ kind: 'editor', title: 'Edit' }, ['--dismiss'], { kind: 'editor', value: null }],
    [
      { kind: 'notify', message: 'Done' },
      ['--acknowledge'],
      { kind: 'notify', acknowledged: true },
    ],
    [
      { kind: 'confirm', purpose: 'user-input', title: 'Go?', message: 'Go' },
      ['--confirm'],
      { kind: 'confirm', accepted: true },
    ],
    [
      { kind: 'confirm', purpose: 'disclosure', title: 'Go?', message: 'Go' },
      ['--dismiss'],
      { kind: 'confirm', accepted: false },
    ],
    [
      { kind: 'confirm', purpose: 'user-input', title: 'Go?', message: 'Go' },
      ['--decline'],
      { kind: 'confirm', accepted: false },
    ],
    [{ kind: 'custom', customType: 'x' }, ['--dismiss'], { kind: 'custom', value: null }],
  ] as const)('answers a %j request with %j', async (pending, answer, response) => {
    mocks.executeCommand
      .mockResolvedValueOnce(requestsList([interaction(pending)]))
      .mockResolvedValueOnce(accepted())

    await expect(
      runSessionsCli(['request-respond', SESSION, RUN, 'interaction-1', ...answer]),
    ).resolves.toBe(0)

    expect(sent()).toEqual([
      expect.objectContaining({ operation: 'requests-list', sessionId: SESSION }),
      expect.objectContaining({
        operation: 'request-respond',
        interactionId: 'interaction-1',
        kind: response.kind,
        response,
      }),
    ])
  })

  it('answers a custom request with the JSON value of --value-file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-cli-value-'))
    const valuePath = path.join(directory, 'value.json')
    try {
      await writeFile(valuePath, '{"picked":[1,2]}', 'utf8')
      mocks.executeCommand
        .mockResolvedValueOnce(requestsList([interaction({ kind: 'custom', customType: 'x' })]))
        .mockResolvedValueOnce(accepted())

      await expect(
        runSessionsCli([
          'request-respond',
          SESSION,
          RUN,
          'interaction-1',
          '--value-file',
          valuePath,
        ]),
      ).resolves.toBe(0)
      expect(sent()[1]).toMatchObject({
        response: { kind: 'custom', value: { picked: [1, 2] } },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('refuses an answer that does not fit the request kind as a usage error', async () => {
    mocks.executeCommand.mockResolvedValueOnce(
      requestsList([interaction({ kind: 'select', choices: ['a'] })]),
    )

    await expect(
      runSessionsCli(['request-respond', SESSION, RUN, 'interaction-1', '--text', 'a']),
    ).resolves.toBe(2)
    expect(mocks.executeCommand).toHaveBeenCalledTimes(1)
    expect(stderr()).toContain(
      'Request interaction-1 is a select request, which --text cannot answer. Answer it with --choice <item> or --dismiss.',
    )
  })

  it('points an approval request answered with request-respond at approval-respond', async () => {
    mocks.executeCommand.mockResolvedValueOnce(
      requestsList([
        interaction({ kind: 'confirm', purpose: 'authorization', title: 'Run?', message: 'ls' }),
      ]),
    )

    await expect(
      runSessionsCli(['request-respond', SESSION, RUN, 'interaction-1', '--confirm', '--json']),
    ).resolves.toBe(6)
    // The Session Host's answer, and the probe's for a caller that cannot see the approval.
    expect(JSON.parse(stderr())).toMatchObject({
      error: {
        kind: 'conflict',
        code: 'interaction-mismatch',
        message: expect.stringContaining(
          `openwaggle hive approval-respond ${SESSION} ${RUN} interaction-1 allow|deny`,
        ),
      },
    })
  })

  it('fails with the error kind of a refused read of the pending requests', async () => {
    mocks.executeCommand.mockResolvedValueOnce({
      contract: 'session-query-v2',
      response: {
        contractVersion: 2,
        requestId: 'request-list',
        outcome: {
          operation: 'requests-list',
          error: { code: 'session_not_found', kind: 'not_found', message: 'Session not found.' },
        },
      },
    })

    await expect(
      runSessionsCli(['request-respond', SESSION, RUN, 'interaction-1', '--dismiss', '--json']),
    ).resolves.toBe(5)
    expect(process.stdout.write).not.toHaveBeenCalled()
    expect(JSON.parse(stderr())).toMatchObject({
      type: 'error',
      error: {
        kind: 'not_found',
        message: expect.stringContaining('session_not_found: Session not found.'),
        code: 'session_not_found',
      },
    })
  })

  it('carries the code of a capability the Session Host refused before reading', async () => {
    // The Host checks capabilities before it dispatches, so the refusal is an error frame.
    mocks.executeCommand.mockRejectedValueOnce(
      new LocalSessionClientProtocolError('capability_denied', 'sessions:read is required.'),
    )

    await expect(
      runSessionsCli(['request-respond', SESSION, RUN, 'interaction-1', '--dismiss', '--json']),
    ).resolves.toBe(4)
    expect(JSON.parse(stderr())).toMatchObject({
      type: 'error',
      error: { kind: 'authorization', code: 'capability_denied' },
    })
  })

  it('refuses a --choice that is not one of the request choices as a usage error', async () => {
    mocks.executeCommand.mockResolvedValueOnce(
      requestsList([interaction({ kind: 'select', choices: ['a', 'b'] })]),
    )

    await expect(
      runSessionsCli(['request-respond', SESSION, RUN, 'interaction-1', '--choice', 'c']),
    ).resolves.toBe(2)
    expect(mocks.executeCommand).toHaveBeenCalledTimes(1)
    expect(stderr()).toContain('--choice "c" is not one of this request\'s choices: "a", "b".')
  })

  it.each(['true', 'false'])('answers a select with the choice %s', async (choice) => {
    mocks.executeCommand
      .mockResolvedValueOnce(
        requestsList([interaction({ kind: 'select', choices: ['true', 'false'] })]),
      )
      .mockResolvedValueOnce(accepted())

    await expect(
      runSessionsCli(['request-respond', SESSION, RUN, 'interaction-1', '--choice', choice]),
    ).resolves.toBe(0)
    expect(sent()[1]).toMatchObject({ response: { kind: 'select', selected: choice } })
  })

  it.each([
    [[], 'Answer with exactly one of'],
    [['--choice', 'a', '--dismiss'], 'Answer with exactly one of'],
  ] as const)('refuses the answer %j before contacting the Host', async (answer, message) => {
    await expect(
      runSessionsCli(['request-respond', SESSION, RUN, 'interaction-1', ...answer]),
    ).resolves.toBe(2)
    expect(mocks.createClientInput).not.toHaveBeenCalled()
    expect(stderr()).toContain(message)
  })
})
