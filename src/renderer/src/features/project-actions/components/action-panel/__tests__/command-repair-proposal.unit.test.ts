import { describe, expect, it } from 'vitest'
import { commandRepairProposalFrom } from '../CommandRepairProposalCard'

const proposal = {
  type: 'command-repair-proposal',
  actionId: 'test',
  actionName: 'Test',
  current: { command: 'pnpm test', directory: '.' },
  proposed: { command: 'pnpm test -- --run', directory: '.' },
  reason: 'Watch mode never exits here.',
}

describe('commandRepairProposalFrom', () => {
  it.each([
    { label: 'a live tool result', content: { content: [], details: proposal } },
    {
      label: 'a serialized tool result',
      content: JSON.stringify({ content: [], details: proposal }),
    },
    { label: 'bare details', content: proposal },
  ])('reads a proposal from $label', ({ content }) => {
    expect(commandRepairProposalFrom(content)).toEqual(proposal)
  })

  it('ignores other project_actions results', () => {
    expect(
      commandRepairProposalFrom({ content: [], details: { revision: 'r', actions: [] } }),
    ).toBeNull()
    expect(
      commandRepairProposalFrom({
        content: [],
        details: { ...proposal, proposed: { command: '', directory: '.' } },
      }),
    ).toBeNull()
  })
})
