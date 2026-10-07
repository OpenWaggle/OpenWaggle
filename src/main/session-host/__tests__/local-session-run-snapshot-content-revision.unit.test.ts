import { SessionId, SupportedModelId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  applyEventToStreamBuffer,
  clearStreamBuffer,
  getStreamBuffer,
  startStreamBuffer,
} from '../../utils/stream-buffer'
import { negotiateLocalSessionProtocol } from '../local-session-negotiation'

/*
 * Revision 22: an active Run snapshot names each text and reasoning part's content block, which a
 * revision-21 client decodes exactly and would reject mid-stream. Such a client is refused at the
 * handshake instead (and a revision-22 desktop app refuses a revision-21 Host the same way), so a
 * Host never sends a client a snapshot it cannot decode.
 */
describe('Local Session run snapshot content revision', () => {
  const SESSION_ID = SessionId('session-run-snapshot-content')

  it('sends text parts that name their content block', () => {
    startStreamBuffer(SESSION_ID, SupportedModelId('provider/model'), 'classic', 'run-1')
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_update',
      messageId: 'assistant-1',
      role: 'assistant',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Partial answer' },
      timestamp: 0,
    })
    expect(getStreamBuffer(SESSION_ID)?.parts).toEqual([
      { type: 'text', text: 'Partial answer', contentIndex: 0 },
    ])
    clearStreamBuffer(SESSION_ID)
  })

  it.each(['gui', 'cli', 'mcp', 'internal'] as const)(
    'refuses a revision-21 %s client that would reject those snapshots mid-stream',
    (clientKind) => {
      const result = negotiateLocalSessionProtocol(
        {
          protocol: 'openwaggle-local-session',
          supportedRevisions: [21],
          clientKind,
          clientVersion: 'test',
        },
        'host',
      )
      expect(result).toMatchObject({ accepted: false, code: 'incompatible_protocol' })
    },
  )

  it('advertises the run snapshot content capability at revision 22', () => {
    const result = negotiateLocalSessionProtocol(
      {
        protocol: 'openwaggle-local-session',
        supportedRevisions: [22],
        clientKind: 'gui',
        clientVersion: 'test',
      },
      'host',
    )
    expect(result).toMatchObject({
      accepted: true,
      revision: 22,
      capabilities: expect.arrayContaining(['events:run-snapshot-content-v1']),
    })
  })
})
