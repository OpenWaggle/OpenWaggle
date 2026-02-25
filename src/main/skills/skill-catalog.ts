import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SkillCatalogResult, SkillDiscoveryItem } from '@shared/types/standards'
import { isEnoent } from '@shared/utils/node-error'
import { isPathInside } from '@shared/utils/paths'

interface ParsedSkillDocument {
  readonly name: string
  readonly description: string
  readonly body: string
}

export type LoadedSkillDefinition = SkillDiscoveryItem

export interface LoadedSkillCatalog extends SkillCatalogResult {
  readonly skills: readonly LoadedSkillDefinition[]
}

export interface LoadedSkillInstructions extends SkillDiscoveryItem {
  readonly instructions: string
}

export async function loadSkillCatalog(
  projectPath: string,
  toggles: Readonly<Record<string, boolean>> = {},
): Promise<LoadedSkillCatalog> {
  const skillsRoot = path.join(projectPath, '.openwaggle', 'skills')
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
      .map((entry) => loadSkillMetadata(projectPath, skillsRoot, entry.name, toggles)),
  )

  skills.sort((a, b) => a.id.localeCompare(b.id))

  return {
    projectPath,
    skills,
  }
}

export function toSkillCatalogResult(catalog: LoadedSkillCatalog): SkillCatalogResult {
  return catalog
}

export async function loadSkillInstructions(
  projectPath: string,
  skillId: string,
  toggles: Readonly<Record<string, boolean>> = {},
): Promise<LoadedSkillInstructions> {
  const canonicalSkillId = normalizeRequestedSkillId(skillId)
  const skillsRoot = path.join(projectPath, '.openwaggle', 'skills')
  const folderEntries = await readDirectoryEntries(skillsRoot)
  if (folderEntries === null) {
    throw new Error(`Skill "${canonicalSkillId}" was not found.`)
  }

  const matchingFolders = folderEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((folderName) => normalizeSkillId(folderName) === canonicalSkillId)

  if (matchingFolders.length === 0) {
    throw new Error(`Skill "${canonicalSkillId}" was not found.`)
  }

  if (matchingFolders.length > 1) {
    throw new Error(
      `Skill "${canonicalSkillId}" is ambiguous (${matchingFolders.join(', ')}). Use a unique folder id.`,
    )
  }

  const folderName = matchingFolders[0]
  if (!folderName) {
    throw new Error(`Skill "${canonicalSkillId}" was not found.`)
  }

  const folderPath = path.join(skillsRoot, folderName)
  const skillPath = path.join(folderPath, 'SKILL.md')
  const enabled = toggles[canonicalSkillId] ?? true
  const hasScripts = await hasScriptsFolder(folderPath)

  try {
    const raw = await readSkillFileWithinProject(projectPath, skillPath)
    const parsed = parseSkillDocument(raw)

    return {
      id: canonicalSkillId,
      name: parsed.name,
      description: parsed.description,
      folderPath,
      skillPath,
      hasScripts,
      enabled,
      loadStatus: 'ok',
      instructions: parsed.body,
    }
  } catch (error) {
    throw new Error(formatSkillError(projectPath, folderName, error))
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
  }
}

async function loadSkillMetadata(
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
    const raw = await readSkillFileWithinProject(projectPath, skillPath)
    const parsed = parseSkillDocument(raw)
    return {
      ...base,
      name: parsed.name,
      description: parsed.description,
      hasScripts,
      loadStatus: 'ok',
    }
  } catch (error) {
    return {
      ...base,
      hasScripts,
      loadError: formatSkillError(projectPath, folderName, error),
    }
  }
}

async function readSkillFileWithinProject(projectPath: string, skillPath: string): Promise<string> {
  const projectRootReal = await resolveRealPath(projectPath)
  const skillRealPath = await resolveRealPath(skillPath)

  if (!isPathInside(projectRootReal, skillRealPath)) {
    throw new Error('SKILL.md resolves outside the project directory (symlink)')
  }

  return fs.readFile(skillRealPath, 'utf8')
}

async function resolveRealPath(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath)
  } catch (error) {
    if (isEnoent(error)) {
      return path.resolve(targetPath)
    }
    throw error
  }
}

function formatSkillError(projectPath: string, folderName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const relativePath = path.join(projectPath, '.openwaggle', 'skills', folderName, 'SKILL.md')
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

export function normalizeRequestedSkillId(skillId: string): string {
  const canonicalSkillId = skillId.trim().toLowerCase()
  if (!canonicalSkillId) {
    throw new Error('skillId is required')
  }

  if (normalizeSkillId(canonicalSkillId) !== canonicalSkillId) {
    throw new Error(`Invalid skill id "${skillId}". Use lowercase letters, numbers, '-' or '_'.`)
  }

  return canonicalSkillId
}

export function normalizeSkillId(folderName: string): string {
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
    if (isEnoent(error)) {
      return null
    }
    throw error
  }
}
