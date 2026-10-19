import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import {
  createAssistantToolMessage,
  createUserMessage,
  getAssistantMessageRows,
} from './useBuildChatRows.test-utils'

function reply(id: string, text: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', content: text }] }
}

/** ADR 0055 through the whole row build: the fold runs first, then the replies are marked. */
describe('buildChatRows reply actions', () => {
  it("marks a folded turn's reply and the plain turn's, never the tool step", () => {
    const rows = getAssistantMessageRows([
      createUserMessage('user-1', 'run command'),
      createAssistantToolMessage('assistant-step', 'tool-a'),
      reply('assistant-reply', 'Done.'),
      createUserMessage('user-2', 'thanks'),
      reply('assistant-latest', 'You are welcome.'),
    ])

    expect(
      rows.map((row) => [row.message.id, row.turnPresentation ?? null, row.replyActions ?? null]),
    ).toEqual([
      ['assistant-reply', 'folded', 'reply'],
      ['assistant-latest', null, 'latest'],
    ])
  })
})
