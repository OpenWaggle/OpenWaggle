import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SkillCatalogResult, SkillDiscoveryItem } from '@shared/types/standards'

interface ParsedSkillDocument {
  readonly name: string
  readonly description: string
  readonly body: string
}

export interface LoadedSkillDefinition extends SkillDiscoveryItem {
  readonly body: string | null
}

export interface LoadedSkillCatalog extends SkillCatalogResult {
  readonly skills: readonly LoadedSkillDefinition[]
}

export async function loadSkillCatalog(
  projectPath: string,
  toggles: Readonly<Record<string, boolean>> = {},
): Promise<LoadedSkillCatalog> {
  const skillsRoot = path.join(projectPath, '.openhive', 'skills')
  const folderEntries = await readDirectoryEntries(skillsRoot)
  if (folderEntries === null) {
    return {
      projectPath,
      skills: [],
    }
  }

  const skills = await Promise.all(
    folderEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => loadSkillDefinition(projectPath, skillsRoot, entry.name, toggles)),
  )

  skills.sort((a, b) => a.id.localeCompare(b.id))

  return {
    projectPath,
    skills,
  }
}

export function toSkillCatalogResult(catalog: LoadedSkillCatalog): SkillCatalogResult {
  return {
    projectPath: catalog.projectPath,
    skills: catalog.skills.map(({ body: _body, ...skill }) => skill),
  }
}

function createDefaultSkillDefinition(
  skillId: string,
  folderPath: string,
  skillPath: string,
  enabled: boolean,
): LoadedSkillDefinition {
  return {
    id: skillId,
    name: skillId,
    description: '',
    folderPath,
    skillPath,
    hasScripts: false,
    enabled,
    loadStatus: 'error',
    body: null,
  }
}

async function loadSkillDefinition(
  projectPath: string,
  skillsRoot: string,
  folderName: string,
  toggles: Readonly<Record<string, boolean>>,
): Promise<LoadedSkillDefinition> {
  const folderPath = path.join(skillsRoot, folderName)
  const skillPath = path.join(folderPath, 'SKILL.md')
  const skillId = normalizeSkillId(folderName)
  const enabled = toggles[skillId] ?? true
  const hasScripts = await hasScriptsFolder(folderPath)
  const base = createDefaultSkillDefinition(skillId, folderPath, skillPath, enabled)

  try {
    const raw = await fs.readFile(skillPath, 'utf8')
    const parsed = parseSkillDocument(raw)
    return {
      ...base,
      name: parsed.name,
      description: parsed.description,
      hasScripts,
      loadStatus: 'ok',
      body: parsed.body,
    }
  } catch (error) {
    return {
      ...base,
      hasScripts,
      loadError: formatSkillError(projectPath, folderName, error),
    }
  }
}

function formatSkillError(projectPath: string, folderName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const relativePath = path.join(projectPath, '.openhive', 'skills', folderName, 'SKILL.md')
  return `${relativePath}: ${message}`
}

async function hasScriptsFolder(folderPath: string): Promise<boolean> {
  const scriptsPath = path.join(folderPath, 'scripts')
  try {
    const stat = await fs.stat(scriptsPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

function normalizeSkillId(folderName: string): string {
  const normalized = folderName
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9-_]+/g, '-')
    .replaceAll(/-{2,}/g, '-')
    .replaceAll(/^-+|-+$/g, '')
  return normalized || 'skill'
}

function parseSkillDocument(markdown: string): ParsedSkillDocument {
  const trimmed = markdown.trimStart()
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(trimmed)
  if (!frontmatterMatch) {
    if (!trimmed.startsWith('---')) {
      throw new Error('SKILL.md is missing YAML frontmatter')
    }
    throw new Error('SKILL.md frontmatter closing delimiter is missing')
  }

  const frontmatter = frontmatterMatch[1] ?? ''
  const body = (frontmatterMatch[2] ?? '').trim()
  const fields = parseFrontmatterFields(frontmatter)

  const name = fields.name?.trim()
  const description = fields.description?.trim()
  if (!name) {
    throw new Error('SKILL.md frontmatter requires "name"')
  }
  if (!description) {
    throw new Error('SKILL.md frontmatter requires "description"')
  }

  return { name, description, body }
}

function parseFrontmatterFields(frontmatter: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const lines = frontmatter.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf(':')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
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

async function readDirectoryEntries(dirPath: string): Promise<Dirent[] | null> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true })
  } catch (error) {
    if (isMissingError(error)) {
      return null
    }
    throw error
  }
}

function isMissingError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
