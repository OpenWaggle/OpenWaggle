import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DOUBLE_FACTOR } from '@shared/constants/math'
import type { AgentToolFilter, AgentTypeDefinition } from '@shared/types/sub-agent'
import { formatErrorMessage, isEnoent } from '@shared/utils/node-error'
import { isPathInside } from '@shared/utils/paths'
import { createLogger } from '../logger'

const logger = createLogger('agent-types')

const BUILT_IN_TYPES: readonly AgentTypeDefinition[] = [
  {
    id: 'general-purpose',
    name: 'General Purpose',
    description:
      'General-purpose agent with full access to all tools. Can read, write, edit files, run commands, and perform any task autonomously.',
    toolFilter: { kind: 'all' },
    systemPromptAddition:
      'You are a general-purpose agent with full access to all tools. You can read, write, edit files, run commands, and perform any task autonomously. Return your findings and work results as a clear summary.',
    isBuiltIn: true,
  },
  {
    id: 'explorer',
    name: 'Explorer',
    description:
      'Fast agent specialized for exploring codebases. Read-only access — cannot edit files or run commands.',
    toolFilter: {
      kind: 'allow',
      names: ['readFile', 'glob', 'listFiles', 'webFetch', 'loadSkill', 'loadAgents'],
    },
    systemPromptAddition:
      'You are a fast agent specialized for exploring codebases. Your job is to quickly find files, search code, and answer questions about the codebase. You have read-only access — you cannot edit files or run commands. Be thorough but efficient: search multiple patterns in parallel, check different naming conventions, and explore related directories.',
    isBuiltIn: true,
  },
  {
    id: 'planner',
    name: 'Planner',
    description:
      'Software architect agent for designing implementation plans. Read-only access — outputs plans, not implementation.',
    toolFilter: {
      kind: 'allow',
      names: ['readFile', 'glob', 'listFiles', 'webFetch', 'loadSkill', 'loadAgents'],
    },
    systemPromptAddition:
      'You are a software architect agent for designing implementation plans. Explore the codebase to understand existing patterns and architecture. Produce step-by-step plans, identify critical files to modify, consider architectural trade-offs, and flag risks. You have read-only access — your output is a plan, not implementation.',
    isBuiltIn: true,
  },
  {
    id: 'test-engineer',
    name: 'Test Engineer',
    description:
      'Test automation and quality assurance specialist. Full file and command access, but cannot manage agents or teams.',
    toolFilter: {
      kind: 'deny',
      names: [
        'orchestrate',
        'spawnAgent',
        'teamCreate',
        'teamDelete',
        'taskCreate',
        'taskUpdate',
        'taskList',
        'taskGet',
        'sendMessage',
      ],
    },
    systemPromptAddition:
      'You are a test automation and quality assurance specialist. Write tests, run test suites, analyze coverage, and identify quality issues. You have full file access and can run commands, but cannot spawn sub-agents or manage teams.',
    isBuiltIn: true,
  },
  {
    id: 'ui-engineer',
    name: 'UI Engineer',
    description:
      'Design engineering specialist. Can read and write files but cannot run shell commands or manage agents.',
    toolFilter: {
      kind: 'deny',
      names: [
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
      ],
    },
    systemPromptAddition:
      'You are a design engineering specialist. Build and modify UI components, styles, and layouts. You can read and write files but cannot run shell commands or manage agents.',
    isBuiltIn: true,
  },
]

const builtInMap = new Map<string, AgentTypeDefinition>(BUILT_IN_TYPES.map((t) => [t.id, t]))

const customTypeCache = new Map<string, readonly AgentTypeDefinition[]>()

export function getAgentType(id: string, projectPath?: string): AgentTypeDefinition | undefined {
  const builtIn = builtInMap.get(id)
  if (builtIn) return builtIn

  if (projectPath) {
    const customs = customTypeCache.get(projectPath)
    if (customs) {
      return customs.find((t) => t.id === id)
    }
  }

  return undefined
}

export function listAgentTypes(projectPath?: string): readonly AgentTypeDefinition[] {
  const customs = projectPath ? (customTypeCache.get(projectPath) ?? []) : []
  return [...BUILT_IN_TYPES, ...customs]
}

export async function refreshCustomAgentTypes(
  projectPath: string,
): Promise<readonly AgentTypeDefinition[]> {
  const agentsDir = path.join(projectPath, '.openwaggle', 'agents')
  const entries = await readDirSafe(agentsDir)
  if (!entries) {
    customTypeCache.set(projectPath, [])
    return []
  }

  const customs = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map((e) => loadCustomAgentType(projectPath, agentsDir, e.name)),
  )
  const valid = customs.filter((t): t is AgentTypeDefinition => t !== null)
  customTypeCache.set(projectPath, valid)
  logger.info('Refreshed custom agent types', { projectPath, count: valid.length })
  return valid
}

async function loadCustomAgentType(
  projectPath: string,
  agentsDir: string,
  folderName: string,
): Promise<AgentTypeDefinition | null> {
  const agentMdPath = path.join(agentsDir, folderName, 'AGENT.md')
  try {
    const realProject = await resolveRealPath(projectPath)
    const realAgent = await resolveRealPath(agentMdPath)
    if (!isPathInside(realProject, realAgent)) {
      logger.warn('AGENT.md resolves outside project', { agentMdPath })
      return null
    }

    const raw = await fs.readFile(realAgent, 'utf8')
    const parsed = parseAgentDocument(raw)
    if (!parsed) {
      logger.warn('Invalid AGENT.md frontmatter', { agentMdPath })
      return null
    }

    const toolFilter = parseToolFilter(parsed.tools)

    return {
      id: normalizeAgentId(folderName),
      name: parsed.name,
      description: parsed.description,
      toolFilter,
      systemPromptAddition: parsed.body,
      isBuiltIn: false,
      sourcePath: agentMdPath,
    }
  } catch (error) {
    if (!isEnoent(error)) {
      logger.warn('Failed to load custom agent', {
        folder: folderName,
        error: formatErrorMessage(error),
      })
    }
    return null
  }
}

function parseToolFilter(tools: readonly string[] | undefined): AgentToolFilter {
  if (!tools || tools.length === 0) return { kind: 'all' }
  return { kind: 'allow', names: tools }
}

interface ParsedAgentDocument {
  readonly name: string
  readonly description: string
  readonly tools?: readonly string[]
  readonly body: string
}

function parseAgentDocument(markdown: string): ParsedAgentDocument | null {
  const trimmed = markdown.trimStart()
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(trimmed)
  if (!match) return null

  const frontmatter = match[1] ?? ''
  const body = (match[DOUBLE_FACTOR] ?? '').trim()
  const fields = parseFrontmatterFields(frontmatter)

  const name = fields.name?.trim()
  const description = fields.description?.trim()
  if (!name || !description) return null

  const toolsRaw = fields.tools?.trim()
  let tools: string[] | undefined
  if (toolsRaw) {
    // Parse YAML-like array: ["readFile", "glob", "webFetch"]
    const arrayMatch = /^\[([^\]]*)\]$/.exec(toolsRaw)
    if (arrayMatch) {
      tools = (arrayMatch[1] ?? '')
        .split(',')
        .map((s) => stripQuotes(s.trim()))
        .filter(Boolean)
    }
  }

  return { name, description, tools, body }
}

function parseFrontmatterFields(frontmatter: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of frontmatter.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const sep = trimmed.indexOf(':')
    if (sep <= 0) continue
    const key = trimmed.slice(0, sep).trim()
    const rawValue = trimmed.slice(sep + 1).trim()
    fields[key] = stripQuotes(rawValue)
  }
  return fields
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function normalizeAgentId(folderName: string): string {
  return folderName
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9-_]+/g, '-')
    .replaceAll(/-{2,}/g, '-')
    .replaceAll(/^-+|-+$/g, '')
}

async function resolveRealPath(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath)
  } catch (error) {
    if (isEnoent(error)) return path.resolve(targetPath)
    throw error
  }
}

async function readDirSafe(dirPath: string): Promise<Dirent[] | null> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true })
  } catch (error) {
    if (isEnoent(error)) return null
    throw error
  }
}
