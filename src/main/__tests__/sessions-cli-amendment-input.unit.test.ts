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
import { runSessionsCli } from '../sessions-cli'
import {
  accepted,
  captureCliOutput,
  delegationPage,
  PROPOSED,
  SPECIFICATION,
  sentCommands,
  stderr,
} from './sessions-cli-host-input.test-utils'

function sent() {
  return sentCommands(mocks.executeCommand.mock.calls)
}

describe('hive delegation amendments change only the fields they name', () => {
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

  it('changes only the fields an amendment names and keeps the rest', async () => {
    mocks.executeCommand
      .mockResolvedValueOnce(
        delegationPage({
          specifications: [{ revision: 1, specification: { ...SPECIFICATION, objective: 'Old' } }],
          nextCursor: 'page-2',
        }),
      )
      .mockResolvedValueOnce(
        delegationPage({ specifications: [{ revision: 2, specification: SPECIFICATION }] }),
      )
      .mockResolvedValueOnce(accepted())

    await expect(
      runSessionsCli([
        'delegation-amend',
        'queen',
        'delegation-1',
        '2',
        'Narrow',
        'it',
        '--accept',
        'Docs updated',
        '--accept',
        'Tests pass',
        '--depends-on',
        'delegation-9',
        '--no-handoff',
      ]),
    ).resolves.toBe(0)

    const commands = sent()
    expect(commands[1]).toMatchObject({ operation: 'delegations-read', cursor: 'page-2' })
    expect(commands[2]).toEqual(
      expect.objectContaining({
        operation: 'delegation-amend',
        expectedSpecificationRevision: 2,
        reason: 'Narrow it',
        specification: {
          objective: SPECIFICATION.objective,
          deliverables: SPECIFICATION.deliverables,
          acceptanceCriteria: ['Docs updated', 'Tests pass'],
          dependencies: [{ delegationId: 'delegation-9', requiredState: 'ready_for_review' }],
          resourceReferences: SPECIFICATION.resourceReferences,
        },
      }),
    )
  })

  it('applies a proposal as proposed when --proposal is the only change', async () => {
    mocks.executeCommand
      .mockResolvedValueOnce(
        delegationPage({
          specifications: [{ revision: 2, specification: SPECIFICATION }],
          proposals: [{ proposalId: 'proposal-1', specification: PROPOSED }],
        }),
      )
      .mockResolvedValueOnce(accepted())

    await expect(
      runSessionsCli([
        'delegation-amend',
        'queen',
        'delegation-1',
        '2',
        'Apply',
        '--proposal',
        'proposal-1',
      ]),
    ).resolves.toBe(0)
    expect(sent()[1]).toMatchObject({
      proposalId: 'proposal-1',
      specification: PROPOSED,
    })
  })

  it('proposes an amendment on top of the current specification', async () => {
    mocks.executeCommand
      .mockResolvedValueOnce(
        delegationPage({ specifications: [{ revision: 2, specification: SPECIFICATION }] }),
      )
      .mockResolvedValueOnce(accepted())

    await expect(
      runSessionsCli([
        'delegation-propose-amendment',
        'worker',
        'delegation-1',
        '2',
        'Docs',
        '--objective',
        PROPOSED.objective,
        '--depends-on',
        'delegation-0:accepted',
        '--depends-on',
        'delegation-8',
      ]),
    ).resolves.toBe(0)
    expect(sent()[1]).toMatchObject({
      operation: 'delegation-propose-amendment',
      baseSpecificationRevision: 2,
      specification: {
        ...PROPOSED,
        dependencies: [
          { delegationId: 'delegation-0', requiredState: 'accepted' },
          { delegationId: 'delegation-8', requiredState: 'ready_for_review' },
        ],
      },
    })
  })

  it.each([
    [['delegation-propose-amendment', 'worker', 'delegation-1', '2', 'Why'], 'Change at least one'],
    [
      [
        'delegation-amend',
        'queen',
        'delegation-1',
        '2',
        'Why',
        '--deliverable',
        'x',
        '--no-deliverables',
      ],
      'Choose either --deliverable or --no-deliverables',
    ],
    [
      [
        'delegation-amend',
        'queen',
        'delegation-1',
        '2',
        'Why',
        '--depends-on',
        'delegation-2:done',
      ],
      '--depends-on takes <delegation-id>[:accepted]',
    ],
    [
      [
        'delegation-amend',
        'queen',
        'delegation-1',
        '2',
        'Why',
        '--proposal',
        'proposal-1',
        '--objective',
        'x',
      ],
      '--proposal applies the proposal as proposed',
    ],
  ] as const)('refuses the amendment %j before contacting the Host', async (values, message) => {
    await expect(runSessionsCli(values)).resolves.toBe(2)
    expect(mocks.createClientInput).not.toHaveBeenCalled()
    expect(stderr()).toContain(message)
  })

  it('builds on the revision it names, so a keyed retry sends the same command', async () => {
    const amended = { ...SPECIFICATION, objective: 'x' }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // The first try finds revision 1 current; the retry finds the amendment it made, revision 2.
      const specifications = [{ revision: 1, specification: SPECIFICATION }]
      if (attempt === 1) specifications.unshift({ revision: 2, specification: amended })
      mocks.executeCommand
        .mockResolvedValueOnce(
          delegationPage({ specifications, currentSpecificationRevision: attempt + 1 }),
        )
        .mockResolvedValueOnce(accepted())
    }
    const amend = [
      'delegation-amend',
      'queen',
      'delegation-1',
      '1',
      'Why',
      '--objective',
      'x',
      '--idempotency-key',
      'k1',
    ]

    await expect(runSessionsCli(amend)).resolves.toBe(0)
    await expect(runSessionsCli(amend)).resolves.toBe(0)
    const commands = sent()
    expect(commands[3]).toEqual(commands[1])
    expect(commands[1]).toMatchObject({ expectedSpecificationRevision: 1, specification: amended })
  })

  it('refuses a revision ahead of the current one before sending it', async () => {
    mocks.executeCommand.mockResolvedValueOnce(
      delegationPage({ specifications: [{ revision: 2, specification: SPECIFICATION }] }),
    )

    await expect(
      runSessionsCli(['delegation-amend', 'queen', 'delegation-1', '3', 'Why', '--objective', 'x']),
    ).resolves.toBe(6)
    expect(mocks.executeCommand).toHaveBeenCalledTimes(1)
    expect(stderr()).toContain('is at specification revision 2, not 3')
  })

  it('fails with the error kind of a refused Delegation read', async () => {
    mocks.executeCommand.mockResolvedValueOnce({
      contract: 'session-query-v2',
      response: {
        contractVersion: 2,
        requestId: 'request-read',
        outcome: {
          operation: 'delegations-read',
          error: {
            code: 'delegation_not_found',
            kind: 'not_found',
            message: 'Delegation not found.',
          },
        },
      },
    })

    await expect(
      runSessionsCli(['delegation-amend', 'queen', 'missing', '2', 'Why', '--objective', 'x']),
    ).resolves.toBe(5)
    expect(mocks.executeCommand).toHaveBeenCalledTimes(1)
    expect(process.stdout.write).not.toHaveBeenCalled()
    expect(stderr()).toContain('delegation_not_found')
  })
})
