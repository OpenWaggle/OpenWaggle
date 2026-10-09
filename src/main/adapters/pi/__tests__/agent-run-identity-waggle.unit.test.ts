import type { ExtensionAPI, ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent'
import {
  PI_WAGGLE_TURN_CUSTOM_TYPE,
  PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
} from '@openwaggle/pi-waggle/protocol'
import { isRecord } from '@shared/utils/validation'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import {
  createAgentRunContextExtension,
  RUN_IDENTITY_CUSTOM_TYPE,
} from '../agent-run-context-extension'

type ContextHandler = (
  event: { readonly messages: readonly unknown[] },
  ctx: ExtensionContext,
) => { readonly messages?: readonly unknown[] } | undefined

/**
 * One Run of the context extension over a Pi branch that grows as the Run stores entries. A
 * Waggle Run starts with `sendCustomMessage`, so `before_agent_start` never fires.
 */
function waggleRun(runIdentityContext: string, branch: SessionEntry[]) {
  let context: ContextHandler | undefined
  const pi = fromPartial<ExtensionAPI>({
    on: (event: string, handler: ContextHandler) => {
      if (event === 'context') context = handler
    },
    appendEntry: vi.fn((customType: string, data: unknown) => {
      branch.push(fromPartial<SessionEntry>({ type: 'custom', customType, data, timestamp: '' }))
    }),
  })
  createAgentRunContextExtension({
    sessionIdentityContext: '- Hive role: Queen',
    runIdentityContext,
  })(pi)
  return (messages: readonly unknown[]) =>
    context?.(
      { messages },
      fromPartial<ExtensionContext>({ sessionManager: { getBranch: () => branch } }),
    )?.messages ?? messages
}

const waggleRequest = (text: string, timestamp: number) => ({
  role: 'custom',
  customType: PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
  content: text,
  display: true,
  timestamp,
})
const waggleTurn = (text: string, timestamp: number) => ({
  role: 'custom',
  customType: PI_WAGGLE_TURN_CUSTOM_TYPE,
  content: [{ type: 'text', text }],
  display: false,
  timestamp,
})
const answer = (text: string, timestamp: number) => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  timestamp,
})
const identityContents = (messages: readonly unknown[]) =>
  messages.flatMap((message) =>
    isRecord(message) && message.customType === RUN_IDENTITY_CUSTOM_TYPE ? [message.content] : [],
  )

describe('the Run identity of a Waggle Run', () => {
  it('is stored and sent after the Waggle prompt in a Waggle-only Session', () => {
    const branch: SessionEntry[] = []
    const send = waggleRun('run-waggle', branch)
    const turn0 = [waggleRequest('Debate it', 10), waggleTurn('Turn 0', 10)]

    const first = send(turn0)
    const second = send([...turn0, answer('Agent A', 11), waggleTurn('Turn 1', 12)])

    expect(branch).toHaveLength(1)
    expect(first).toMatchObject([
      { content: 'Debate it' },
      { content: [{ text: 'Turn 0' }] },
      { content: 'run-waggle' },
    ])
    // Each later request of the Run keeps the earlier one as its prefix.
    expect(second.slice(0, first.length)).toEqual(first)
    expect(identityContents(second)).toEqual(['run-waggle'])
  })

  it('anchors on the Waggle prompt, not an older classic prompt, in a mixed Session', () => {
    const branch: SessionEntry[] = []
    const classic = { role: 'user', content: 'Classic question', timestamp: 5 }
    const history = [classic, answer('Classic answer', 6)]
    const send = waggleRun('run-waggle', branch)

    const first = send([...history, waggleRequest('Debate it', 10), waggleTurn('Turn 0', 10)])

    expect(first.slice(0, history.length)).toEqual(history)
    expect(first.at(-1)).toMatchObject({
      customType: RUN_IDENTITY_CUSTOM_TYPE,
      content: 'run-waggle',
    })

    // The next classic Run sends the Waggle Run's identity where it was, after its prompt.
    const next = waggleRun(
      'run-classic',
      branch,
    )([
      ...first.filter((message) => identityContents([message]).length === 0),
      answer('Agent A', 11),
      { role: 'user', content: 'Follow-up', timestamp: 20 },
    ])
    expect(next.slice(0, first.length)).toEqual(first)
    expect(identityContents(next)).toEqual(['run-waggle', 'run-classic'])
  })
})
