import fs from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'jsonc-parser'

interface AssociationCacheEntry {
  readonly modifiedAt: number
  readonly associations: Readonly<Record<string, string>>
}

const associationCache = new Map<string, AssociationCacheEntry>()
const GLOBSTAR_DIRECTORY_END_OFFSET = 2
const MAX_ASSOCIATION_MATCH_STEPS = 256

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function escapeRegularExpression(character: string) {
  return /[\\^$.*+?()[\]{}|]/u.test(character) ? `\\${character}` : character
}

function globRegularExpression(glob: string) {
  let pattern = '^'
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]
    if (character === '*') {
      if (glob[index + 1] === '*') {
        if (glob[index + GLOBSTAR_DIRECTORY_END_OFFSET] === '/') {
          pattern += '(?:.*/)?'
          index += GLOBSTAR_DIRECTORY_END_OFFSET
        } else {
          pattern += '.*'
          index += 1
        }
      } else {
        pattern += '[^/]*'
      }
      continue
    }
    if (character === '?') {
      pattern += '[^/]'
      continue
    }
    pattern += escapeRegularExpression(character ?? '')
  }
  return new RegExp(`${pattern}$`, 'u')
}

function matchesAssociationPattern(
  glob: string,
  candidate: string,
  budget: { remaining: number },
): boolean {
  if (budget.remaining <= 0) return false
  budget.remaining -= 1
  const opening = glob.indexOf('{')
  if (opening < 0) return globRegularExpression(glob).test(candidate)
  const closing = glob.indexOf('}', opening + 1)
  if (closing < 0) return globRegularExpression(glob).test(candidate)
  const alternatives = glob.slice(opening + 1, closing).split(',')
  if (alternatives.length <= 1 || alternatives.some((alternative) => !alternative)) {
    return globRegularExpression(glob).test(candidate)
  }
  const prefix = glob.slice(0, opening)
  const suffix = glob.slice(closing + 1)
  return alternatives.some((alternative) =>
    matchesAssociationPattern(`${prefix}${alternative}${suffix}`, candidate, budget),
  )
}

function matchesAssociation(glob: string, candidate: string) {
  return matchesAssociationPattern(glob, candidate, {
    remaining: MAX_ASSOCIATION_MATCH_STEPS,
  })
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

async function vscodeAssociations(projectRoot: string) {
  const settingsPath = path.join(projectRoot, '.vscode', 'settings.json')
  try {
    const stats = await fs.stat(settingsPath)
    const cached = associationCache.get(projectRoot)
    if (cached?.modifiedAt === stats.mtimeMs) return cached.associations
    const associations = parsedAssociations(await fs.readFile(settingsPath, 'utf8'))
    associationCache.set(projectRoot, { modifiedAt: stats.mtimeMs, associations })
    return associations
  } catch {
    associationCache.delete(projectRoot)
    return {}
  }
}

export async function vscodeLanguageAssociation(projectRoot: string, relativePath: string) {
  const normalized = relativePath.replaceAll('\\', '/')
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1)
  const associations = await vscodeAssociations(projectRoot)
  for (const [glob, language] of Object.entries(associations)) {
    const candidate = glob.includes('/') ? normalized : basename
    if (matchesAssociation(glob, candidate)) return language
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
