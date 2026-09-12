import { describe, expect, it } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { buildSessionsCliPayload } from '../sessions-cli-payload'

function command(arguments_: readonly string[]) {
  const parsed = parseMcpCliArguments(arguments_)
  return {
    name: parsed.positionals[0] ?? '',
    arguments: { ...parsed, positionals: parsed.positionals.slice(1) },
  }
}

describe('Sessions CLI project paths', () => {
  it('resolves lifecycle and explicit catalog paths against the caller cwd', () => {
    const launch = command(['launch', '.', '--text', 'Plan', '--workspace', 'current'])
    const list = command(['list', '--project', '../project'])

    expect(
      buildSessionsCliPayload(launch.name, launch.arguments, { workingDirectory: '/repo/project' }),
    ).toMatchObject({ request: { command: { projectPath: '/repo/project' } } })
    expect(
      buildSessionsCliPayload(list.name, list.arguments, { workingDirectory: '/repo/worktree' }),
    ).toMatchObject({ request: { query: { projectPath: '/repo/project' } } })
  })
})
