import type { Dirent } from 'node:fs'
import path from 'node:path'
import type { AgentTypeDefinition } from '@shared/types/sub-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { readdirMock, readFileMock, realpathMock } = vi.hoisted(() => ({
  readdirMock: vi.fn(),
  readFileMock: vi.fn(),
  realpathMock: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  default: {
    readdir: readdirMock,
    readFile: readFileMock,
    realpath: realpathMock,
  },
  readdir: readdirMock,
  readFile: readFileMock,
  realpath: realpathMock,
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// ---------------------------------------------------------------------------
// Module under test (imported after mocks)
// ---------------------------------------------------------------------------

const { getAgentType, listAgentTypes, refreshCustomAgentTypes } = await import(
  '../agent-type-registry'
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BUILT_IN_IDS = ['general-purpose', 'explorer', 'planner', 'test-engineer', 'ui-engineer']

function makeDirent(name: string, isDir: boolean, parentPath: string): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath,
  } satisfies Dirent
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agent-type-registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── getAgentType ──────────────────────────────────────────────────────────

  describe('getAgentType', () => {
    it('returns a built-in type by id', () => {
      const result = getAgentType('general-purpose')
      expect(result).toBeDefined()
      expect(result?.id).toBe('general-purpose')
      expect(result?.name).toBe('General Purpose')
    })

    it('returns each built-in type by id', () => {
      for (const id of BUILT_IN_IDS) {
        const result = getAgentType(id)
        expect(result).toBeDefined()
        expect(result?.id).toBe(id)
      }
    })

    it('returns undefined for an unknown id', () => {
      const result = getAgentType('nonexistent-agent')
      expect(result).toBeUndefined()
    })

    it('returns undefined for an empty string id', () => {
      const result = getAgentType('')
      expect(result).toBeUndefined()
    })
  })

  // ── listAgentTypes ────────────────────────────────────────────────────────

  describe('listAgentTypes', () => {
    it('includes all 5 built-in types', () => {
      const types = listAgentTypes()
      const ids = types.map((t) => t.id)
      expect(ids).toEqual(expect.arrayContaining(BUILT_IN_IDS))
      expect(types.length).toBeGreaterThanOrEqual(5)
    })

    it('returns at least the built-in types when no projectPath is given', () => {
      const types = listAgentTypes()
      for (const id of BUILT_IN_IDS) {
        expect(types.find((t) => t.id === id)).toBeDefined()
      }
    })
  })

  // ── Built-in type properties ──────────────────────────────────────────────

  describe('built-in type properties', () => {
    it('all built-in types have isBuiltIn: true', () => {
      for (const id of BUILT_IN_IDS) {
        const agentType = getAgentType(id)
        expect(agentType?.isBuiltIn).toBe(true)
      }
    })

    it('all built-in types have non-empty systemPromptAddition', () => {
      for (const id of BUILT_IN_IDS) {
        const agentType = getAgentType(id)
        expect(agentType?.systemPromptAddition).toBeTruthy()
        expect(agentType?.systemPromptAddition.length).toBeGreaterThan(0)
      }
    })

    it('all built-in types have non-empty name and description', () => {
      for (const id of BUILT_IN_IDS) {
        const agentType = getAgentType(id)
        expect(agentType?.name).toBeTruthy()
        expect(agentType?.description).toBeTruthy()
      }
    })
  })

  // ── Tool filters ──────────────────────────────────────────────────────────

  describe('tool filters', () => {
    it('general-purpose has kind: "all"', () => {
      const agentType = getAgentType('general-purpose')
      expect(agentType?.toolFilter).toEqual({ kind: 'all' })
    })

    it('explorer has kind: "allow" with read-only tools', () => {
      const agentType = getAgentType('explorer')
      expect(agentType?.toolFilter).toEqual({
        kind: 'allow',
        names: ['readFile', 'glob', 'listFiles', 'webFetch', 'loadSkill', 'loadAgents'],
      })
    })

    it('planner has kind: "allow" with read-only tools', () => {
      const agentType = getAgentType('planner')
      expect(agentType?.toolFilter).toEqual({
        kind: 'allow',
        names: ['readFile', 'glob', 'listFiles', 'webFetch', 'loadSkill', 'loadAgents'],
      })
    })

    it('test-engineer has kind: "deny" blocking 9 agent/orchestration tools', () => {
      const agentType = getAgentType('test-engineer')
      expect(agentType?.toolFilter.kind).toBe('deny')
      if (agentType?.toolFilter.kind === 'deny') {
        expect(agentType.toolFilter.names).toEqual([
          'orchestrate',
          'spawnAgent',
          'teamCreate',
          'teamDelete',
          'taskCreate',
          'taskUpdate',
          'taskList',
          'taskGet',
          'sendMessage',
        ])
        expect(agentType.toolFilter.names).toHaveLength(9)
      }
    })

    it('ui-engineer has kind: "deny" blocking 10 tools including runCommand', () => {
      const agentType = getAgentType('ui-engineer')
      expect(agentType?.toolFilter.kind).toBe('deny')
      if (agentType?.toolFilter.kind === 'deny') {
        expect(agentType.toolFilter.names).toEqual([
          'runCommand',
          'orchestrate',
          'spawnAgent',
          'teamCreate',
          'teamDelete',
          'taskCreate',
          'taskUpdate',
          'taskList',
          'taskGet',
          'sendMessage',
        ])
        expect(agentType.toolFilter.names).toHaveLength(10)
      }
    })

    it('explorer and planner share the same tool filter', () => {
      const explorer = getAgentType('explorer')
      const planner = getAgentType('planner')
      expect(explorer?.toolFilter).toEqual(planner?.toolFilter)
    })
  })

  // ── refreshCustomAgentTypes ───────────────────────────────────────────────

  describe('refreshCustomAgentTypes', () => {
    const projectPath = '/tmp/test-project'
    const agentsDir = path.join(projectPath, '.openwaggle', 'agents')

    it('returns empty array when agents dir does not exist (ENOENT)', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      readdirMock.mockRejectedValueOnce(enoent)

      const result = await refreshCustomAgentTypes(projectPath)
      expect(result).toEqual([])
    })

    it('returns empty array when agents dir has no subdirectories', async () => {
      readdirMock.mockResolvedValueOnce([makeDirent('readme.txt', false, agentsDir)])

      const result = await refreshCustomAgentTypes(projectPath)
      expect(result).toEqual([])
    })

    it('loads a valid custom agent type from AGENT.md', async () => {
      const agentFolder = 'my-agent'
      const agentMdPath = path.join(agentsDir, agentFolder, 'AGENT.md')

      readdirMock.mockResolvedValueOnce([makeDirent(agentFolder, true, agentsDir)])
      realpathMock.mockResolvedValueOnce(projectPath)
      realpathMock.mockResolvedValueOnce(agentMdPath)

      const agentMd = [
        '---',
        'name: My Custom Agent',
        'description: A custom agent for testing',
        'tools: ["readFile", "glob", "webFetch"]',
        '---',
        'You are a custom testing agent. Follow the project conventions.',
      ].join('\n')

      readFileMock.mockResolvedValueOnce(agentMd)

      const result = await refreshCustomAgentTypes(projectPath)

      expect(result).toHaveLength(1)
      const custom = result[0] as AgentTypeDefinition
      expect(custom.id).toBe('my-agent')
      expect(custom.name).toBe('My Custom Agent')
      expect(custom.description).toBe('A custom agent for testing')
      expect(custom.isBuiltIn).toBe(false)
      expect(custom.toolFilter).toEqual({
        kind: 'allow',
        names: ['readFile', 'glob', 'webFetch'],
      })
      expect(custom.systemPromptAddition).toBe(
        'You are a custom testing agent. Follow the project conventions.',
      )
      expect(custom.sourcePath).toBe(agentMdPath)
    })

    it('custom agent without tools gets kind: "all" filter', async () => {
      const agentFolder = 'open-agent'
      const agentMdPath = path.join(agentsDir, agentFolder, 'AGENT.md')

      readdirMock.mockResolvedValueOnce([makeDirent(agentFolder, true, agentsDir)])
      realpathMock.mockResolvedValueOnce(projectPath)
      realpathMock.mockResolvedValueOnce(agentMdPath)

      const agentMd = [
        '---',
        'name: Open Agent',
        'description: Agent with all tools',
        '---',
        'You have full tool access.',
      ].join('\n')

      readFileMock.mockResolvedValueOnce(agentMd)

      const result = await refreshCustomAgentTypes(projectPath)

      expect(result).toHaveLength(1)
      expect(result[0]?.toolFilter).toEqual({ kind: 'all' })
    })

    it('custom types are available via getAgentType after refresh', async () => {
      const agentFolder = 'lookup-agent'
      const agentMdPath = path.join(agentsDir, agentFolder, 'AGENT.md')

      readdirMock.mockResolvedValueOnce([makeDirent(agentFolder, true, agentsDir)])
      realpathMock.mockResolvedValueOnce(projectPath)
      realpathMock.mockResolvedValueOnce(agentMdPath)

      const agentMd = [
        '---',
        'name: Lookup Agent',
        'description: For lookup test',
        '---',
        'Custom prompt body.',
      ].join('\n')

      readFileMock.mockResolvedValueOnce(agentMd)

      await refreshCustomAgentTypes(projectPath)

      const found = getAgentType('lookup-agent', projectPath)
      expect(found).toBeDefined()
      expect(found?.name).toBe('Lookup Agent')
      expect(found?.isBuiltIn).toBe(false)
    })

    it('custom types are included in listAgentTypes after refresh', async () => {
      const agentFolder = 'listed-agent'
      const agentMdPath = path.join(agentsDir, agentFolder, 'AGENT.md')

      readdirMock.mockResolvedValueOnce([makeDirent(agentFolder, true, agentsDir)])
      realpathMock.mockResolvedValueOnce(projectPath)
      realpathMock.mockResolvedValueOnce(agentMdPath)

      const agentMd = [
        '---',
        'name: Listed Agent',
        'description: Should appear in list',
        '---',
        'Body text.',
      ].join('\n')

      readFileMock.mockResolvedValueOnce(agentMd)

      await refreshCustomAgentTypes(projectPath)

      const allTypes = listAgentTypes(projectPath)
      const ids = allTypes.map((t) => t.id)
      expect(ids).toContain('listed-agent')
      // Built-in types should still be present
      for (const id of BUILT_IN_IDS) {
        expect(ids).toContain(id)
      }
    })

    it('skips agent folders with invalid AGENT.md (missing required fields)', async () => {
      const agentFolder = 'bad-agent'
      const agentMdPath = path.join(agentsDir, agentFolder, 'AGENT.md')

      readdirMock.mockResolvedValueOnce([makeDirent(agentFolder, true, agentsDir)])
      realpathMock.mockResolvedValueOnce(projectPath)
      realpathMock.mockResolvedValueOnce(agentMdPath)

      // Missing description field
      const agentMd = ['---', 'name: Bad Agent', '---', 'No description in frontmatter.'].join('\n')

      readFileMock.mockResolvedValueOnce(agentMd)

      const result = await refreshCustomAgentTypes(projectPath)
      expect(result).toEqual([])
    })

    it('skips agent folders with no frontmatter at all', async () => {
      const agentFolder = 'no-frontmatter'
      const agentMdPath = path.join(agentsDir, agentFolder, 'AGENT.md')

      readdirMock.mockResolvedValueOnce([makeDirent(agentFolder, true, agentsDir)])
      realpathMock.mockResolvedValueOnce(projectPath)
      realpathMock.mockResolvedValueOnce(agentMdPath)

      readFileMock.mockResolvedValueOnce('Just plain markdown with no frontmatter delimiters.')

      const result = await refreshCustomAgentTypes(projectPath)
      expect(result).toEqual([])
    })
  })
})
