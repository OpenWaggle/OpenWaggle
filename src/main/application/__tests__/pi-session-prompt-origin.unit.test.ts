import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { PiSessionFiles, type PiSessionPromptOrigin } from '../../ports/pi-session-discovery'
import { withPiSessionPromptOrigin } from '../pi-session-prompt-origin'

function detail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return fromPartial<SessionDetail>({
    id: SessionId('session-1'),
    piSessionFile: '/sessions/one.jsonl',
    messages: [],
    ...overrides,
  })
}

function decorate(session: SessionDetail | null, origin: PiSessionPromptOrigin | null) {
  const read: string[] = []
  const files = fromPartial<PiSessionFiles['Type']>({
    lastPromptOrigin: (file: string) =>
      Effect.sync(() => {
        read.push(file)
        return origin
      }),
  })
  const result = Effect.runSync(
    withPiSessionPromptOrigin(session).pipe(Effect.provideService(PiSessionFiles, files)),
  )
  return { result, read }
}

describe('withPiSessionPromptOrigin', () => {
  it('marks a Session whose latest prompt came from outside OpenWaggle', () => {
    expect(decorate(detail(), 'outside').result).toMatchObject({ piSessionLastPromptOutside: true })
  })

  it('leaves a Session OpenWaggle wrote last as it is', () => {
    const { result } = decorate(detail(), 'openwaggle')
    expect(result).not.toHaveProperty('piSessionLastPromptOutside')
  })

  it('reads nothing for a Session without a Pi file, or one whose file was deleted', () => {
    expect(decorate(detail({ piSessionFile: undefined }), 'outside').read).toEqual([])
    expect(decorate(detail({ piSessionFileDeleted: 'gone' }), 'outside').read).toEqual([])
    expect(decorate(null, 'outside').result).toBeNull()
  })
})
