import type { ContextEvent, SessionEntry } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { RUN_IDENTITY_CUSTOM_TYPE } from '../agent-run-context-extension'
import { runIdentityEntryData, withRunIdentities } from '../agent-run-identity'

type ContextMessage = ContextEvent['messages'][number]

const command = (timestamp: number) =>
  fromPartial<ContextMessage>({
    role: 'custom',
    customType: 'qa.command',
    content: 'Command: go',
    display: true,
    timestamp,
  })
const user = (content: string, timestamp: number) =>
  fromPartial<ContextMessage>({ role: 'user', content, timestamp })
const answer = (timestamp: number) =>
  fromPartial<ContextMessage>({ role: 'assistant', content: [], timestamp })

function stored(content: string, messages: readonly ContextMessage[]) {
  return fromPartial<SessionEntry>({
    type: 'custom',
    customType: RUN_IDENTITY_CUSTOM_TYPE,
    data: runIdentityEntryData(content, messages),
  })
}

const contents = (messages: readonly ContextMessage[] | undefined) =>
  messages?.map((message) => ('content' in message ? message.content : undefined))

describe('the Run identity of a turn an extension command starts', () => {
  it('follows the command message, not the previous Run prompt', () => {
    const history = [user('Audit it', 1), answer(2)]

    const data = runIdentityEntryData('run-command', [...history, command(3)])

    expect(data?.prompt).toMatchObject({ customType: 'qa.command' })
    expect(
      contents(
        withRunIdentities(
          [...history, command(3)],
          [stored('run-command', [...history, command(3)])],
        ),
      ),
    ).toEqual(['Audit it', [], 'Command: go', 'run-command'])
  })

  it('finds the command message again when the file gives it another time', () => {
    const live = [command(3)]
    // Reloaded from the file, a custom message carries its entry's time.
    const reloaded = [command(7), answer(8), user('Next', 9)]

    expect(contents(withRunIdentities(reloaded, [stored('run-command', live)]))).toEqual([
      'Command: go',
      'run-command',
      [],
      'Next',
    ])
  })

  it('puts each identity after its own run of a command sent twice with the same text', () => {
    const first = [command(3)]
    const second = [command(3), answer(4), command(5)]

    const result = withRunIdentities(
      [command(3), answer(4), command(5), answer(6)],
      [stored('run-1', first), stored('run-2', second)],
    )

    expect(contents(result)).toEqual(['Command: go', 'run-1', [], 'Command: go', 'run-2', []])
  })

  it('keeps the current identity on the current command when an earlier one sent the same text without one', () => {
    // Run 1 (OpenWaggle) prompted; a Run with no identity (the pi CLI) sent the command; Run 3
    // (OpenWaggle) sent it again.
    const run3 = [user('U1', 1), answer(2), command(3), answer(4), command(5)]

    const result = withRunIdentities(run3, [stored('r1', [user('U1', 1)]), stored('r3', run3)])

    expect(contents(result)).toEqual(['U1', 'r1', [], 'Command: go', [], 'Command: go', 'r3'])
  })

  it("drops an identity whose command was compacted away instead of taking a later Run's", () => {
    const summary = fromPartial<ContextMessage>({
      role: 'compactionSummary',
      summary: 'S',
      timestamp: 50,
    })
    const runD = [summary, user('kept', 60), answer(61), command(70)]

    const result = withRunIdentities(runD, [stored('rA', [command(3)]), stored('rD', runD)])

    expect(contents(result)).toEqual([undefined, 'kept', [], 'Command: go', 'rD'])
  })
})
