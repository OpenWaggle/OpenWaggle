import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runAgentsCli } from '../agents-cli'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { runAgentDefinitionDiscoveryCommand } from '../sessions-cli-agent-definitions'
import { fakeProjectResolver } from './agent-definition-project.test-support'

const definition = `---
schemaVersion: 1
name: security-reviewer
description: Reviews authorization boundaries
tools: [read_file]
---

Review authorization boundaries and report concrete findings.
`

describe('Hive CLI Agent-definition discovery', () => {
  let root = ''
  let project = ''
  let home = ''
  let stdout: string[] = []
  let stderr: string[] = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-hive-agents-'))
    project = path.join(root, 'project')
    home = path.join(root, 'home')
    await fs.mkdir(path.join(project, '.openwaggle', 'agents'), { recursive: true })
    await fs.mkdir(home, { recursive: true })
    await fs.writeFile(
      path.join(project, '.openwaggle', 'agents', 'security-reviewer.md'),
      definition,
      'utf8',
    )
    stdout = []
    stderr = []
  })

  afterEach(async () => fs.rm(root, { recursive: true, force: true }))

  function run(args: readonly string[]) {
    return runAgentsCli(args, {
      cwd: project,
      home,
      stdout: (value) => {
        stdout.push(value)
      },
      stderr: (value) => stderr.push(value),
      loadSemanticCatalog: async () => ({ models: [], tools: [], skills: [], mcpServers: [] }),
    })
  }

  function parsedError() {
    return JSON.parse(stderr.join(''))
  }

  it('lists and searches definitions through the Hive CLI, not openwaggle agents (ADR 0053)', async () => {
    await expect(run(['search', 'security'])).resolves.toBe(2)
    expect(stderr.join('')).toContain("Use 'openwaggle hive agent-definitions-search'.")
    stderr = []
    await expect(run(['list', '--json'])).resolves.toBe(2)
    expect(stdout).toEqual([])
    expect(parsedError()).toEqual({
      schemaVersion: 1,
      error: {
        message:
          "Unsupported OpenWaggle Agents command: list. Use 'openwaggle hive agent-definitions-list'.",
      },
    })

    let toggles: Readonly<Record<string, boolean>> = {}
    const worktree = path.join(root, 'worktrees', 'project', 'w1')
    const subdirectory = path.join(project, 'src')
    await Promise.all([fs.mkdir(worktree, { recursive: true }), fs.mkdir(subdirectory)])
    const resolveProject = fakeProjectResolver({
      projects: [project],
      worktrees: { [worktree]: project },
      toggles: () => ({ [project]: toggles }),
    })
    const discover = (args: readonly string[], cwd = project) => {
      const parsed = parseMcpCliArguments(args)
      return runAgentDefinitionDiscoveryCommand(
        parsed.positionals[0] ?? '',
        { ...parsed, positionals: parsed.positionals.slice(1) },
        { cwd, home, stdout: (value) => void stdout.push(value), resolveProject },
      )
    }
    await expect(discover(['agent-definitions-list', '--json'])).resolves.toBe(0)
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      schemaVersion: 1,
      type: 'response',
      command: 'agent-definitions-list',
      result: { definitions: [{ name: 'security-reviewer', scope: 'project', valid: true }] },
    })
    stdout = []
    await expect(
      discover(['agent-definitions-search', 'authorization', 'boundaries']),
    ).resolves.toBe(0)
    expect(stdout.join('')).toContain('security-reviewer\tproject\tvalid')

    // From a managed worktree or a subdirectory, discovery reads the project root.
    for (const cwd of [worktree, subdirectory]) {
      stdout = []
      await expect(discover(['agent-definitions-list', '--json'], cwd)).resolves.toBe(0)
      expect(JSON.parse(stdout.join(''))).toMatchObject({
        result: { definitions: [{ name: 'security-reviewer' }] },
      })
    }

    // A definition turned off for the project is hidden, as the hive tool hides it.
    toggles = { 'security-reviewer': false }
    for (const cwd of [project, worktree, subdirectory]) {
      stdout = []
      await expect(discover(['agent-definitions-list', '--json'], cwd)).resolves.toBe(0)
      expect(JSON.parse(stdout.join(''))).toMatchObject({ result: { definitions: [] } })
      stdout = []
      await expect(discover(['agent-definitions-search', 'authorization'], cwd)).resolves.toBe(0)
      expect(stdout.join('')).not.toContain('security-reviewer')
    }
  })

  it('lists nothing when Settings cannot be read', async () => {
    const parsed = parseMcpCliArguments(['agent-definitions-list', '--json'])
    await expect(
      runAgentDefinitionDiscoveryCommand(
        'agent-definitions-list',
        { ...parsed, positionals: [] },
        {
          cwd: project,
          home,
          stdout: (value) => void stdout.push(value),
          resolveProject: fakeProjectResolver({
            projects: [project],
            settingsError: new Error('OpenWaggle could not read the saved settings database.'),
          }),
        },
      ),
    ).rejects.toThrow('could not read the saved settings database')
    expect(stdout).toEqual([])
  })
})
