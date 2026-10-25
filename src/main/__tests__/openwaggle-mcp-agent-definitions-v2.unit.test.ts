import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isMcpAgentDefinitionOperation,
  queryMcpAgentDefinitions,
} from '../openwaggle-mcp-agent-definitions-v2'
import { sessionInputSchemaV2 } from '../openwaggle-mcp-session-tool-v2'
import { fakeProjectResolver } from './agent-definition-project.test-support'

const DEFINITION = `---
schemaVersion: 1
name: reviewer
description: Reviews security boundaries
---

These instructions must only enter a Run after explicit selection.
`

describe('openwaggle_hive Agent-definition discovery', () => {
  let root = ''
  let project = ''
  let home = ''

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ow-mcp-agents-')))
    project = path.join(root, 'project')
    home = path.join(root, 'home')
    await fs.mkdir(path.join(project, '.openwaggle', 'agents'), { recursive: true })
    await fs.mkdir(home, { recursive: true })
    await fs.writeFile(path.join(project, '.openwaggle', 'agents', 'reviewer.md'), DEFINITION)
  })

  afterEach(async () => fs.rm(root, { recursive: true, force: true }))

  const scope = (workspaceRoots: readonly string[]) => ({
    workspaceRoots,
    sessionIds: new Set<string>(),
  })

  it('names the operations after the hive tool actions and accepts their fields', () => {
    expect(isMcpAgentDefinitionOperation('agent-definitions-list')).toBe(true)
    expect(isMcpAgentDefinitionOperation('agent-definitions-search')).toBe(true)
    expect(isMcpAgentDefinitionOperation('list')).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({ operation: 'agent-definitions-list', limit: 5 }).success,
    ).toBe(true)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'agent-definitions-search',
        message: 'security',
        projectPath: '/repo',
      }).success,
    ).toBe(true)
    expect(
      sessionInputSchemaV2.safeParse({ operation: 'agent-definitions-list', sessionId: 's' })
        .success,
    ).toBe(false)
  })

  it('answers like the hive tool: names and descriptions, never instructions', async () => {
    const listed = await queryMcpAgentDefinitions(
      scope([project]),
      { operation: 'agent-definitions-list' },
      { userHome: home, resolveProject: fakeProjectResolver({ projects: [project] }) },
    )
    expect(listed).toEqual({
      definitions: [
        {
          name: 'reviewer',
          description: 'Reviews security boundaries',
          scope: 'project',
          valid: true,
        },
      ],
    })
    expect(JSON.stringify(listed)).not.toContain('explicit selection')
    await expect(
      queryMcpAgentDefinitions(
        scope([project]),
        { operation: 'agent-definitions-search', message: 'nothing-matches' },
        { userHome: home, resolveProject: fakeProjectResolver({ projects: [project] }) },
      ),
    ).resolves.toEqual({ definitions: [] })
  })

  it('leaves out a definition turned off for the project, as the tool does', async () => {
    const resolveProject = fakeProjectResolver({
      projects: [project],
      toggles: () => ({ [project]: { reviewer: false } }),
    })
    await expect(
      queryMcpAgentDefinitions(
        scope([project]),
        { operation: 'agent-definitions-list' },
        { userHome: home, resolveProject },
      ),
    ).resolves.toEqual({ definitions: [] })
    await expect(
      queryMcpAgentDefinitions(
        scope([project]),
        { operation: 'agent-definitions-search', message: 'security' },
        { userHome: home, resolveProject },
      ),
    ).resolves.toEqual({ definitions: [] })
  })

  it('reads the project root for a managed-worktree or subdirectory grant', async () => {
    const worktree = path.join(root, 'worktrees', 'project', 'w1')
    const subdirectory = path.join(project, 'src')
    await Promise.all([fs.mkdir(worktree, { recursive: true }), fs.mkdir(subdirectory)])
    let toggles: Readonly<Record<string, boolean>> = {}
    const resolveProject = fakeProjectResolver({
      projects: [project],
      worktrees: { [worktree]: project },
      toggles: () => ({ [project]: toggles }),
    })
    for (const granted of [worktree, subdirectory]) {
      toggles = {}
      // The worktree holds no definitions here, so a listed one came from the project root.
      await expect(
        queryMcpAgentDefinitions(
          scope([granted]),
          { operation: 'agent-definitions-list' },
          { userHome: home, resolveProject },
        ),
      ).resolves.toMatchObject({ definitions: [{ name: 'reviewer' }] })
      toggles = { reviewer: false }
      await expect(
        queryMcpAgentDefinitions(
          scope([granted]),
          { operation: 'agent-definitions-list' },
          { userHome: home, resolveProject },
        ),
      ).resolves.toEqual({ definitions: [] })
    }
  })

  it('lists nothing when Settings cannot be read', async () => {
    await expect(
      queryMcpAgentDefinitions(
        scope([project]),
        { operation: 'agent-definitions-list' },
        {
          userHome: home,
          resolveProject: fakeProjectResolver({
            projects: [project],
            settingsError: new Error('OpenWaggle could not read the saved settings database.'),
          }),
        },
      ),
    ).rejects.toThrow('could not read the saved settings database')
  })

  it('reads only a project inside the caller workspace grants', async () => {
    await expect(
      queryMcpAgentDefinitions(
        scope([]),
        { operation: 'agent-definitions-list' },
        { userHome: home, resolveProject: fakeProjectResolver({ projects: [project] }) },
      ),
    ).rejects.toThrow('requires an explicit MCP workspace grant')
    const other = path.join(root, 'other')
    await fs.mkdir(other)
    await expect(
      queryMcpAgentDefinitions(
        scope([project]),
        { operation: 'agent-definitions-list', projectPath: other },
        { userHome: home, resolveProject: fakeProjectResolver({ projects: [project] }) },
      ),
    ).rejects.toThrow("outside this server profile's workspace grants")
    await expect(
      queryMcpAgentDefinitions(
        scope([project]),
        { operation: 'agent-definitions-search' },
        { userHome: home, resolveProject: fakeProjectResolver({ projects: [project] }) },
      ),
    ).rejects.toThrow('message is required')
  })
})
