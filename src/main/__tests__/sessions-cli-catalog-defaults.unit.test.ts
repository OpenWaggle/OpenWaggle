import { describe, expect, it } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { buildSessionsCliPayload } from '../sessions-cli'
import { validateSessionsCliOptions } from '../sessions-cli-option-contract'

function payload(arguments_: readonly string[]) {
  const parsed = parseMcpCliArguments(arguments_)
  const name = parsed.positionals[0] ?? ''
  const rest = { ...parsed, positionals: parsed.positionals.slice(1) }
  validateSessionsCliOptions(name, rest)
  return buildSessionsCliPayload(name, rest, { workingDirectory: '/repo/.worktrees/w1' })
}

describe('Hive CLI catalog defaults', () => {
  it.each([['list'], ['search', 'reviewer'], ['delegations-list'], ['delegations-conflicts']])(
    'scopes %s to the current project from the working directory',
    (...arguments_) => {
      expect(payload(arguments_)).toMatchObject({
        request: { query: { workingPath: '/repo/.worktrees/w1' } },
      })
    },
  )

  it('lists unarchived Sessions by default and only archived ones with --archived', () => {
    expect(payload(['list'])).toMatchObject({ request: { query: { archived: false } } })
    expect(payload(['list', '--archived'])).toMatchObject({
      request: { query: { archived: true } },
    })
  })

  it('lists the direct Workers of --parent', () => {
    expect(payload(['list', '--parent', 'openwaggle://sessions/session-queen'])).toMatchObject({
      request: { query: { operation: 'list', parentSessionId: 'session-queen' } },
    })
  })

  it('lists every Delegation state unless --state narrows it', () => {
    expect(JSON.stringify(payload(['delegations-list']))).not.toContain('"states"')
  })
})
