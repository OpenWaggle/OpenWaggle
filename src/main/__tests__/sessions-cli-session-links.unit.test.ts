import { describe, expect, it } from 'vitest'
import { buildDelegationsCliPayload } from '../delegations-cli-payload'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { buildSessionsCliPayload } from '../sessions-cli'

const SESSION_ID = '4bc96a8e-3b0a-456f-8ac3-64b8be7dc940'
const LINK = `openwaggle://sessions/${SESSION_ID}`
const SECOND_ID = 'session-two'
const SECOND_LINK = `openwaggle://sessions/${SECOND_ID}`

function command(arguments_: readonly string[]) {
  const parsed = parseMcpCliArguments(arguments_)
  return {
    name: parsed.positionals[0] ?? '',
    arguments: { ...parsed, positionals: parsed.positionals.slice(1) },
  }
}

/** Request identities are generated per call; everything else must match exactly. */
function withoutGeneratedIdentities(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutGeneratedIdentities)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'requestId' && key !== 'idempotencyKey')
      .map(([key, entry]) => [key, withoutGeneratedIdentities(entry)]),
  )
}

function sessionsPayload(arguments_: readonly string[]) {
  const parsed = command(arguments_)
  return withoutGeneratedIdentities(
    buildSessionsCliPayload(parsed.name, parsed.arguments, { workingDirectory: '/repo' }),
  )
}

describe('Sessions CLI Session links', () => {
  it.each([
    [['read', '{id}']],
    [['status', '{id}']],
    [['turns', '{id}']],
    [['items', '{id}']],
    [['queue', 'list', '{id}']],
    [['archive', '{id}']],
    [['rename', '{id}', 'New', 'title']],
    [['follow-up', '{id}', '--text', 'Next step.']],
    [['interrupt-descendants', '{id}']],
    [['fork', '{id}']],
    [['wait', '{id}', '{second}', '--timeout-ms', '0']],
    [['report', 'session-caller', '--target', '{id}', '--text', 'Context.']],
    [['report', 'session-caller', '--worker', '{id}', '--text', 'Context.']],
    [['report', 'session-caller', '--target', '{id}', '--target', '{second}', '--text', 'Hi.']],
  ])('builds the same command for a link as for the identity: %j', (template) => {
    const fill = (id: string, second: string) =>
      template.map((token) => token.replace('{id}', id).replace('{second}', second))

    const byLink = sessionsPayload(fill(LINK, SECOND_LINK))
    expect(byLink).toEqual(sessionsPayload(fill(SESSION_ID, SECOND_ID)))
    expect(JSON.stringify(byLink)).not.toContain('openwaggle://')
  })

  it('keeps one wait target for a Session named by its link and its identity', () => {
    expect(sessionsPayload(['wait', LINK, SESSION_ID, '--timeout-ms', '0'])).toEqual(
      sessionsPayload(['wait', SESSION_ID, '--timeout-ms', '0']),
    )
  })

  it('filters Delegations by a parent or Worker given as a link', () => {
    const byLink = command(['list', '--parent', LINK, '--worker', SECOND_LINK])
    const byId = command(['list', '--parent', SESSION_ID, '--worker', SECOND_ID])

    expect(
      withoutGeneratedIdentities(
        buildDelegationsCliPayload(byLink.name, byLink.arguments, { workingDirectory: '/repo' }),
      ),
    ).toEqual(
      withoutGeneratedIdentities(
        buildDelegationsCliPayload(byId.name, byId.arguments, { workingDirectory: '/repo' }),
      ),
    )
  })

  it('refuses an openwaggle URL that is not a Session link', () => {
    const parsed = command(['read', 'openwaggle://app/index.html'])
    expect(() => buildSessionsCliPayload(parsed.name, parsed.arguments)).toThrow(
      'Session ID is not a Session link. A Session link looks like openwaggle://sessions/<session-id>.',
    )
  })
})
