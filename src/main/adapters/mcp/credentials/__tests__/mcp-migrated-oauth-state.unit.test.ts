import { describe, expect, it } from 'vitest'
import { withMigratedOAuthState } from '../mcp-migrated-oauth-state'

const KEY = 'mcp__docs|https://docs.example.com/mcp'

describe('adding a migrated sign-in to the merged sign-in states', () => {
  it('adds it next to the other servers', () => {
    const current = JSON.stringify({ other: { tokens: { access_token: 'o' } } })

    const next = withMigratedOAuthState(current, KEY, { tokens: { access_token: 'old' } })

    expect(next && JSON.parse(next)).toEqual({
      other: { tokens: { access_token: 'o' } },
      [KEY]: { tokens: { access_token: 'old' } },
    })
    expect(withMigratedOAuthState(undefined, KEY, { a: 1 })).toBe(
      JSON.stringify({ [KEY]: { a: 1 } }),
    )
  })

  it("never writes over a sign-in the server already has, such as Pi's CLI one", () => {
    const current = JSON.stringify({ [KEY]: { tokens: { access_token: 'from-pi-cli' } } })

    expect(
      withMigratedOAuthState(current, KEY, { tokens: { access_token: 'old' } }),
    ).toBeUndefined()
  })
})
