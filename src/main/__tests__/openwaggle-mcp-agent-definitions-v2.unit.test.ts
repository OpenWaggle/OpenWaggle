import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isMcpAgentDefinitionOperation,
  queryMcpAgentDefinitions,
} from '../openwaggle-mcp-agent-definitions-v2'
import { sessionInputSchemaV2 } from '../openwaggle-mcp-session-tool-v2'

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
      { userHome: home, loadToggles: async () => ({}) },
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
        { userHome: home, loadToggles: async () => ({}) },
      ),
    ).resolves.toEqual({ definitions: [] })
  })

  it('leaves out a definition turned off for the project, as the tool does', async () => {
    const asked: string[] = []
    await expect(
      queryMcpAgentDefinitions(
        scope([project]),
        { operation: 'agent-definitions-list' },
        {
          userHome: home,
          loadToggles: async (projectPath) => {
            asked.push(projectPath)
            return { reviewer: false }
          },
        },
      ),
    ).resolves.toEqual({ definitions: [] })
    await expect(
      queryMcpAgentDefinitions(
        scope([project]),
        { operation: 'agent-definitions-search', message: 'security' },
        { userHome: home, loadToggles: async () => ({ reviewer: false }) },
      ),
    ).resolves.toEqual({ definitions: [] })
    expect(asked).toEqual([project])
  })

  it('reads only a project inside the caller workspace grants', async () => {
    await expect(
      queryMcpAgentDefinitions(
        scope([]),
        { operation: 'agent-definitions-list' },
        { userHome: home, loadToggles: async () => ({}) },
      ),
    ).rejects.toThrow('requires an explicit MCP workspace grant')
    const other = path.join(root, 'other')
    await fs.mkdir(other)
    await expect(
      queryMcpAgentDefinitions(
        scope([project]),
        { operation: 'agent-definitions-list', projectPath: other },
        { userHome: home, loadToggles: async () => ({}) },
      ),
    ).rejects.toThrow("outside this server profile's workspace grants")
    await expect(
      queryMcpAgentDefinitions(
        scope([project]),
        { operation: 'agent-definitions-search' },
        { userHome: home, loadToggles: async () => ({}) },
      ),
    ).rejects.toThrow('message is required')
  })
})
