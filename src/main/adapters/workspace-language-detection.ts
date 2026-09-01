import { constants as FS_CONSTANTS } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'jsonc-parser'
import {
  type GlobMatchOperationBudget,
  MAX_WORKSPACE_ASSOCIATION_GLOB_CODE_UNITS,
  matchesWorkspaceAssociationGlob,
} from './workspace-association-glob'

interface AssociationCacheEntry {
  readonly changedAt: number
  readonly device: number
  readonly inode: number
  readonly modifiedAt: number
  readonly size: number
  readonly associations: Readonly<Record<string, string>>
}

const associationCache = new Map<string, AssociationCacheEntry>()
const MAX_ASSOCIATION_BRACE_ALTERNATIVES = 256
const MAX_ASSOCIATION_MATCH_OPERATIONS = 1_000_000
const MAX_ASSOCIATION_SIMPLE_PATTERNS = 256
const MAX_VSCODE_SETTINGS_BYTES = 1024 * 1024

interface AssociationMatchBudget {
  remainingBraceAlternatives: number
  readonly expandedOperations: GlobMatchOperationBudget
  readonly simpleOperations: GlobMatchOperationBudget
  remainingSimplePatterns: number
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function matchesRegularAssociationPattern(
  glob: string,
  candidate: string,
  budget: AssociationMatchBudget,
  expanded: boolean,
) {
  if (!expanded) {
    if (budget.remainingSimplePatterns <= 0) return false
    budget.remainingSimplePatterns -= 1
  }
  const operationBudget = expanded ? budget.expandedOperations : budget.simpleOperations
  return matchesWorkspaceAssociationGlob(glob, candidate, operationBudget)
}

function matchesAssociationPattern(
  glob: string,
  candidate: string,
  budget: AssociationMatchBudget,
  expanded = false,
): boolean {
  if (glob.length > MAX_WORKSPACE_ASSOCIATION_GLOB_CODE_UNITS) return false
  const opening = glob.indexOf('{')
  if (opening < 0) return matchesRegularAssociationPattern(glob, candidate, budget, expanded)
  const closing = glob.indexOf('}', opening + 1)
  if (closing < 0) return matchesRegularAssociationPattern(glob, candidate, budget, expanded)
  const alternatives = glob.slice(opening + 1, closing).split(',')
  if (alternatives.length <= 1 || alternatives.some((alternative) => !alternative)) {
    return matchesRegularAssociationPattern(glob, candidate, budget, expanded)
  }
  const prefix = glob.slice(0, opening)
  const suffix = glob.slice(closing + 1)
  return alternatives.some((alternative) => {
    if (budget.remainingBraceAlternatives <= 0) return false
    budget.remainingBraceAlternatives -= 1
    return matchesAssociationPattern(`${prefix}${alternative}${suffix}`, candidate, budget, true)
  })
}

function matchesAssociation(glob: string, candidate: string, budget: AssociationMatchBudget) {
  return matchesAssociationPattern(glob, candidate, budget)
}

function parsedAssociations(source: string) {
  const settings: unknown = parse(source)
  if (!isRecord(settings) || !isRecord(settings['files.associations'])) return {}
  const associations: Record<string, string> = {}
  for (const [glob, language] of Object.entries(settings['files.associations'])) {
    if (typeof language === 'string' && language.trim()) associations[glob] = language.trim()
  }
  return associations
}

function isMissingSettingsFile(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isWithinProjectRoot(projectRoot: string, candidate: string) {
  const relative = path.relative(projectRoot, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function readBoundedSettings(handle: Awaited<ReturnType<typeof fs.open>>) {
  const buffer = Buffer.alloc(MAX_VSCODE_SETTINGS_BYTES + 1)
  let bytesRead = 0
  while (bytesRead < buffer.length) {
    const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead)
    if (result.bytesRead === 0) break
    bytesRead += result.bytesRead
  }
  return buffer.subarray(0, bytesRead)
}

async function vscodeAssociations(projectRoot: string) {
  const settingsPath = path.join(projectRoot, '.vscode', 'settings.json')
  let cacheKey = projectRoot
  try {
    const settingsLinkStats = await fs.lstat(settingsPath)
    if (!settingsLinkStats.isFile() || settingsLinkStats.isSymbolicLink()) {
      throw new Error('VS Code workspace settings must be a regular non-symlink file.')
    }
    const [canonicalRoot, canonicalSettingsPath] = await Promise.all([
      fs.realpath(projectRoot),
      fs.realpath(settingsPath),
    ])
    cacheKey = canonicalRoot
    if (!isWithinProjectRoot(canonicalRoot, canonicalSettingsPath)) {
      throw new Error('VS Code workspace settings must stay inside the project root.')
    }
    const handle = await fs.open(
      canonicalSettingsPath,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW,
    )
    try {
      const stats = await handle.stat()
      if (!stats.isFile()) {
        throw new Error('VS Code workspace settings must be a regular non-symlink file.')
      }
      if (stats.size > MAX_VSCODE_SETTINGS_BYTES) {
        throw new Error('VS Code workspace settings are limited to 1 MiB.')
      }
      const cached = associationCache.get(canonicalRoot)
      if (
        cached?.changedAt === stats.ctimeMs &&
        cached.device === stats.dev &&
        cached.inode === stats.ino &&
        cached.modifiedAt === stats.mtimeMs &&
        cached.size === stats.size
      ) {
        return cached.associations
      }
      const source = await readBoundedSettings(handle)
      if (source.length > MAX_VSCODE_SETTINGS_BYTES) {
        throw new Error('VS Code workspace settings are limited to 1 MiB.')
      }
      const associations = parsedAssociations(source.toString('utf8'))
      associationCache.set(canonicalRoot, {
        associations,
        changedAt: stats.ctimeMs,
        device: stats.dev,
        inode: stats.ino,
        modifiedAt: stats.mtimeMs,
        size: stats.size,
      })
      return associations
    } finally {
      await handle.close()
    }
  } catch (error) {
    associationCache.delete(cacheKey)
    if (isMissingSettingsFile(error)) return {}
    throw error
  }
}

export async function vscodeLanguageAssociation(projectRoot: string, relativePath: string) {
  const normalized = relativePath.replaceAll('\\', '/')
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1)
  const associations = await vscodeAssociations(projectRoot)
  const matchBudget = {
    expandedOperations: { remaining: MAX_ASSOCIATION_MATCH_OPERATIONS },
    remainingBraceAlternatives: MAX_ASSOCIATION_BRACE_ALTERNATIVES,
    remainingSimplePatterns: MAX_ASSOCIATION_SIMPLE_PATTERNS,
    simpleOperations: { remaining: MAX_ASSOCIATION_MATCH_OPERATIONS },
  }
  for (const [glob, language] of Object.entries(associations)) {
    const candidate = glob.includes('/') ? normalized : basename
    if (matchesAssociation(glob, candidate, matchBudget)) return language
  }
  return null
}

export function shebangLanguage(source: string) {
  const firstLine = source.slice(0, source.indexOf('\n') < 0 ? source.length : source.indexOf('\n'))
  if (!firstLine.startsWith('#!')) return null
  const command = firstLine.toLowerCase()
  if (/\b(?:python|python2|python3)\b/u.test(command)) return 'python'
  if (/\b(?:node|bun|deno)\b/u.test(command)) return 'javascript'
  if (/\b(?:bash|sh|zsh|fish)\b/u.test(command)) return 'shellscript'
  if (/\bruby\b/u.test(command)) return 'ruby'
  if (/\bperl\b/u.test(command)) return 'perl'
  if (/\bphp\b/u.test(command)) return 'php'
  return null
}
