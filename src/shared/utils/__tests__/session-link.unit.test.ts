import { describe, expect, it } from 'vitest'
import {
  channelClaimsSessionLinks,
  hasSessionLinkScheme,
  parseSessionLink,
  sessionIdFromReference,
  sessionIdsFromReferences,
  sessionLink,
} from '../session-link'

const SESSION_ID = '4bc96a8e-3b0a-456f-8ac3-64b8be7dc940'
const LINK = `openwaggle://sessions/${SESSION_ID}`

describe('sessionLink', () => {
  it('names the Session under the sessions host', () => {
    expect(sessionLink(SESSION_ID)).toBe(LINK)
  })

  it('round-trips through the parser', () => {
    expect(parseSessionLink(sessionLink(SESSION_ID) ?? '')).toBe(SESSION_ID)
  })

  it.each(['', 'a.b', 'a/b', '-leading', 'a b', 'x'.repeat(513)])(
    'has no link for an identity a link cannot carry: %j',
    (sessionId) => {
      expect(sessionLink(sessionId)).toBeNull()
    },
  )
})

describe('parseSessionLink', () => {
  it.each([
    [LINK, SESSION_ID],
    [`${LINK}/`, SESSION_ID],
    [`  ${LINK}\n`, SESSION_ID],
    [`OpenWaggle://Sessions/${SESSION_ID}`, SESSION_ID],
    ['openwaggle://sessions/Mixed_Case-1', 'Mixed_Case-1'],
  ])('reads %j', (value, expected) => {
    expect(parseSessionLink(value)).toBe(expected)
  })

  it.each([
    '',
    SESSION_ID,
    'openwaggle://sessions/',
    'openwaggle://sessions',
    `openwaggle://app/sessions/${SESSION_ID}`,
    `openwaggle://app/${SESSION_ID}`,
    `openwaggle://session/${SESSION_ID}`,
    `openwaggle://sessions/${SESSION_ID}/items`,
    `openwaggle://sessions/${SESSION_ID}?prompt=hi`,
    `openwaggle://sessions/${SESSION_ID}#top`,
    `openwaggle://user@sessions/${SESSION_ID}`,
    `openwaggle://sessions:80/${SESSION_ID}`,
    `openwaggle:sessions/${SESSION_ID}`,
    `openwaggle:///sessions/${SESSION_ID}`,
    `https://sessions/${SESSION_ID}`,
    'openwaggle://sessions/%2e%2e',
    'openwaggle://sessions/../app',
    'openwaggle://sessions/-leading-dash',
    `openwaggle://sessions/${'a'.repeat(513)}`,
  ])('refuses %j', (value) => {
    expect(parseSessionLink(value)).toBeNull()
  })
})

describe('hasSessionLinkScheme', () => {
  it('recognizes the scheme whether or not the link is valid', () => {
    expect(hasSessionLinkScheme(LINK)).toBe(true)
    expect(hasSessionLinkScheme('OPENWAGGLE://app/')).toBe(true)
    expect(hasSessionLinkScheme(SESSION_ID)).toBe(false)
    expect(hasSessionLinkScheme('openwaggle-extension://x')).toBe(false)
  })
})

describe('sessionIdFromReference', () => {
  it('returns a bare identity unchanged', () => {
    expect(sessionIdFromReference(SESSION_ID)).toBe(SESSION_ID)
    expect(sessionIdFromReference('not validated here')).toBe('not validated here')
  })

  it('reads a Session link', () => {
    expect(sessionIdFromReference(LINK)).toBe(SESSION_ID)
  })

  it('refuses an openwaggle URL that is not a Session link, naming the field', () => {
    expect(() => sessionIdFromReference('openwaggle://app/index.html')).toThrow(
      /^The value is not a Session link.*openwaggle:\/\/sessions\/<session-id>/,
    )
    expect(() => sessionIdFromReference('openwaggle://app/', '--target')).toThrow(
      /^--target is not a Session link/,
    )
  })
})

describe('sessionIdsFromReferences', () => {
  it('resolves every entry and drops repeats that only match once resolved', () => {
    expect(sessionIdsFromReferences([LINK, SESSION_ID, 'other', `${LINK}/`])).toEqual([
      SESSION_ID,
      'other',
    ])
  })
})

describe('channelClaimsSessionLinks', () => {
  it('is true for release channels only', () => {
    expect(channelClaimsSessionLinks('dev')).toBe(false)
    for (const channel of ['stable', 'alpha', 'beta', 'rc'] as const) {
      expect(channelClaimsSessionLinks(channel)).toBe(true)
    }
  })
})
