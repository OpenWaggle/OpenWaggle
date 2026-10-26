import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { routeTopLevelCli } from '../top-level-cli-route'

function route(argv: readonly string[]) {
  return routeTopLevelCli(argv, {
    workingDirectory: path.resolve('/work/project'),
    homeDirectory: path.resolve('/home/ada'),
    pathKind: () => 'missing',
    isPackaged: false,
  })
}

describe('former command groups (ADR 0053, #351)', () => {
  it.each([
    [['sessions', 'list', '--all'], 'sessions list', 'hive list'],
    [['sessions'], 'sessions', 'hive'],
    [['sessions', 'queue', 'withdraw', 's-1'], 'sessions queue', 'hive queue-withdraw'],
    [['delegations', 'list'], 'delegations list', 'hive delegations-list'],
    [['delegations', 'accept', 'p', 'd', '1'], 'delegations accept', 'hive delegation-accept'],
    [['delegations'], 'delegations', 'hive'],
  ])('refuses the former %j and names its hive command', (argv, typed, now) => {
    expect(route(argv)).toEqual({
      kind: 'usage-error',
      message: `unknown command '${typed}'. It is now '${now}'.`,
    })
  })

  it('reports a former group as a --json error envelope when the command asked for JSON', () => {
    expect(route(['sessions', 'list', '--json'])).toEqual({
      kind: 'usage-error',
      message: "unknown command 'sessions list'. It is now 'hive list'.",
      machine: true,
    })
    expect(route(['sessions', 'watch', '--jsonl'])).toMatchObject({ machine: true })
  })
})
