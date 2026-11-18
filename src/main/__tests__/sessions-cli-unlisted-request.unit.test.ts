import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClientInput: vi.fn(),
  executeCommand:
    vi.fn<(input: { readonly payload: LocalSessionCommandPayload }) => Promise<unknown>>(),
  watchEvents: vi.fn(),
  readStdin: vi.fn<() => Promise<string>>(),
}))

vi.mock('../local-session-cli-client', () => ({
  createLocalSessionCliClientInput: mocks.createClientInput,
}))

vi.mock('../sessions-cli-message-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sessions-cli-message-input')>()),
  readCliStdin: mocks.readStdin,
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
  RUN,
  rejected,
  requestsList,
  SESSION,
  sentCommands,
  stderr,
} from './sessions-cli-host-input.test-utils'

function sent() {
  return sentCommands(mocks.executeCommand.mock.calls)
}

describe('hive request-respond for a request requests-list does not show', () => {
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
    [['--choice', 'b'], { kind: 'select', selected: 'b' }],
    [['--confirm'], { kind: 'confirm', accepted: true }],
    [['--decline'], { kind: 'confirm', accepted: false }],
  ] as const)(
    'replays a %j retry with its idempotency key once the request is answered',
    async (answer, response) => {
      mocks.executeCommand
        .mockResolvedValueOnce(requestsList([]))
        .mockResolvedValueOnce(rejected('interaction-not-found'))
        .mockResolvedValueOnce(accepted())

      await expect(
        runSessionsCli([
          'request-respond',
          SESSION,
          RUN,
          'interaction-1',
          ...answer,
          '--idempotency-key',
          'answer-once',
        ]),
      ).resolves.toBe(0)
      // The second call asks why the request is missing, with an answer that settles nothing.
      expect(sent()[1]).toMatchObject({ kind: 'notify', response: { kind: 'notify' } })
      expect(sent()[2]).toMatchObject({ kind: response.kind, response })
      expect(mocks.executeCommand.mock.calls[2]?.[0].payload.request).toMatchObject({
        idempotencyKey: 'answer-once',
      })
    },
  )

  it('replays a --value-file retry with its idempotency key', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-cli-value-'))
    const valuePath = path.join(directory, 'value.json')
    try {
      await writeFile(valuePath, '["a"]', 'utf8')
      mocks.executeCommand
        .mockResolvedValueOnce(requestsList([]))
        .mockResolvedValueOnce(rejected('interaction-not-found'))
        .mockResolvedValueOnce(accepted())

      await expect(
        runSessionsCli([
          'request-respond',
          SESSION,
          RUN,
          'interaction-1',
          '--value-file',
          valuePath,
          '--idempotency-key',
          'answer-once',
        ]),
      ).resolves.toBe(0)
      expect(sent()[2]).toMatchObject({
        kind: 'custom',
        response: { kind: 'custom', value: ['a'] },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('exits not-found when a keyed retry finds nothing recorded', async () => {
    mocks.executeCommand
      .mockResolvedValueOnce(requestsList([]))
      .mockResolvedValueOnce(rejected('interaction-not-found'))
      .mockResolvedValueOnce(rejected('interaction-not-found'))

    await expect(
      runSessionsCli([
        'request-respond',
        SESSION,
        RUN,
        'interaction-1',
        '--confirm',
        '--idempotency-key',
        'first-try',
      ]),
    ).resolves.toBe(5)
  })

  it.each([[['--confirm']], [['--text', 'Ada', '--idempotency-key', 'answer-once']]])(
    'fails not-found without answering for %j when the request is not pending',
    async (answer) => {
      mocks.executeCommand
        .mockResolvedValueOnce(requestsList([]))
        .mockResolvedValueOnce(rejected('interaction-not-found'))

      await expect(
        runSessionsCli(['request-respond', SESSION, RUN, 'interaction-1', ...answer, '--json']),
      ).resolves.toBe(5)
      expect(mocks.executeCommand).toHaveBeenCalledTimes(2)
      expect(JSON.parse(stderr())).toMatchObject({
        error: {
          kind: 'not_found',
          code: 'interaction-not-found',
          message: expect.stringContaining('has no pending request interaction-1'),
        },
      })
    },
  )

  it('fails as a conflict, from the Host table, when the caller may not answer a pending approval, keyed or not', async () => {
    for (const key of [[], ['--idempotency-key', 'answer-once']]) {
      mocks.executeCommand
        .mockResolvedValueOnce(requestsList([]))
        .mockResolvedValueOnce(rejected('interaction-mismatch'))
      vi.mocked(process.stderr.write).mockClear()

      await expect(
        runSessionsCli([
          'request-respond',
          SESSION,
          RUN,
          'interaction-1',
          '--confirm',
          ...key,
          '--json',
        ]),
      ).resolves.toBe(6)
      expect(JSON.parse(stderr())).toMatchObject({
        error: {
          kind: 'conflict',
          code: 'interaction-mismatch',
          message: expect.stringContaining('needs approval-respond and sessions:approve'),
        },
      })
    }
  })

  it('fails with authorization when the probe is refused for a missing capability', async () => {
    mocks.executeCommand
      .mockResolvedValueOnce(requestsList([]))
      .mockRejectedValueOnce(
        new LocalSessionClientProtocolError('capability_denied', 'sessions:respond is required.'),
      )

    await expect(
      runSessionsCli(['request-respond', SESSION, RUN, 'interaction-1', '--confirm', '--json']),
    ).resolves.toBe(4)
    expect(mocks.executeCommand).toHaveBeenCalledTimes(2)
    expect(JSON.parse(stderr())).toMatchObject({
      error: { kind: 'authorization', code: 'capability_denied' },
    })
  })

  it('sends no answer when the probe is not refused', async () => {
    mocks.executeCommand.mockResolvedValueOnce(requestsList([])).mockResolvedValueOnce(accepted())

    await expect(
      runSessionsCli([
        'request-respond',
        SESSION,
        RUN,
        'interaction-1',
        '--confirm',
        '--idempotency-key',
        'answer-once',
      ]),
    ).resolves.toBe(1)
    expect(mocks.executeCommand).toHaveBeenCalledTimes(2)
  })

  it.each([
    [['request-respond', 'openwaggle://sessions/', RUN, 'interaction-1', '--choice', 'a']],
    [['delegation-amend', 'queen', 'delegation-1', 'abc', 'Why', '--objective', 'x']],
    [['delegation-propose-amendment', 'worker', 'delegation-1', '2', '--objective', 'x']],
  ])('refuses the rest of %j as a usage error before connecting', async (values) => {
    await expect(runSessionsCli(values)).resolves.toBe(2)
    expect(mocks.createClientInput).not.toHaveBeenCalled()
  })

  it.each([['--stdin'], ['--value-file', '-']])(
    'refuses a bad Session link before reading %j',
    async (...answer) => {
      await expect(
        runSessionsCli(['request-respond', 'openwaggle://sessions/', RUN, 'i-1', ...answer]),
      ).resolves.toBe(2)
      expect(mocks.readStdin).not.toHaveBeenCalled()
      expect(stderr()).toContain('Session')
    },
  )
})
