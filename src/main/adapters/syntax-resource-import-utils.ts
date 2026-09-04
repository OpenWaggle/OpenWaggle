import { constants as fsConstants } from 'node:fs'
import fs, { type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import type { JsonObject, JsonValue } from '@shared/types/json'
import type { SyntaxAppearanceVariant } from '@shared/types/syntax'
import type {
  SyntaxAppearanceResource,
  SyntaxLanguageResource,
  SyntaxThemeResource,
} from '@shared/types/syntax-resources'
import { type ParseError, parse as parseJsonc } from 'jsonc-parser'
import plist from 'plist'

export const IMPORT_SIZE_LIMIT_BYTES = 20 * 1024 * 1024
export const SYNTAX_IMPORT_RESOURCE_KIND_LIMIT = 20
export const ARCHIVE_ENTRY_LIMIT = 1_000
export const ARCHIVE_EXPANDED_LIMIT_BYTES = 40 * 1024 * 1024
const THEME_INCLUDE_DEPTH_LIMIT = 16
const RESOURCE_ID_PART_LIMIT = 100
const JSON_STRUCTURE_DEPTH_LIMIT = 64
const JSON_STRUCTURE_NODE_LIMIT = 100_000
const FILE_READ_CHUNK_BYTES = 64 * 1024

export interface ThemeIncludeBudget {
  bytes: number
  jsonValues: number
}

export class SyntaxReadBudgetExceededError extends Error {
  override readonly name = 'SyntaxReadBudgetExceededError'
  readonly code = 'SYNTAX_READ_BUDGET_EXCEEDED'
}

export interface SyntaxReadBudget {
  readonly exceededMessage: string
  remainingBytes: number
}

export function createThemeIncludeBudget(): ThemeIncludeBudget {
  return { bytes: 0, jsonValues: 0 }
}

export function createSyntaxReadBudget(
  maximumBytes: number,
  exceededMessage: string,
): SyntaxReadBudget {
  return { exceededMessage, remainingBytes: maximumBytes }
}

export function chargeSyntaxReadBudget(budget: SyntaxReadBudget, bytes: number) {
  if (bytes > budget.remainingBytes) {
    throw new SyntaxReadBudgetExceededError(budget.exceededMessage)
  }
  budget.remainingBytes -= bytes
}

function assertSyntaxSourceComplexity(value: unknown, budget?: ThemeIncludeBudget) {
  const stack: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 0 }]
  let nodes = 0
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) break
    nodes += 1
    if (nodes > JSON_STRUCTURE_NODE_LIMIT) {
      throw new Error('Syntax source contains too many JSON values.')
    }
    if (budget && budget.jsonValues + nodes > JSON_STRUCTURE_NODE_LIMIT) {
      throw new Error('VS Code theme include chain exceeds the aggregate complexity limit.')
    }
    if (current.depth > JSON_STRUCTURE_DEPTH_LIMIT) {
      throw new Error('Syntax source is nested too deeply.')
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 })
      continue
    }
    if (isRecord(current.value)) {
      for (const child of Object.values(current.value)) {
        stack.push({ value: child, depth: current.depth + 1 })
      }
    }
  }
  if (budget) budget.jsonValues += nodes
}

export interface MutableSyntaxCatalog {
  readonly themes: SyntaxThemeResource[]
  readonly languages: SyntaxLanguageResource[]
  readonly appearances: SyntaxAppearanceResource[]
}

export function emptySyntaxCatalog(): MutableSyntaxCatalog {
  return { themes: [], languages: [], appearances: [] }
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) {
    const array: JsonValue[] = []
    for (const entry of value) {
      const json = toJsonValue(entry)
      if (json !== undefined) array.push(json)
    }
    return array
  }
  if (!isRecord(value)) return undefined
  const object: JsonObject = {}
  for (const [key, entry] of Object.entries(value)) {
    const json = toJsonValue(entry)
    if (json !== undefined) object[key] = json
  }
  return object
}

export function toJsonObject(value: unknown): JsonObject {
  const json = toJsonValue(value)
  if (!json || Array.isArray(json) || typeof json !== 'object') {
    throw new Error('Theme source must contain a JSON object.')
  }
  return json
}

export function stringRecord(value: unknown) {
  const result: Record<string, string> = {}
  if (!isRecord(value)) return result
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry
  }
  return result
}

export function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

export function syntaxResourceSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, RESOURCE_ID_PART_LIMIT)
}

export function parseJsonText(source: string, budget?: ThemeIncludeBudget) {
  const errors: ParseError[] = []
  const parsed: unknown = parseJsonc(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  })
  if (errors.length > 0) throw new Error('Theme JSON/JSONC is malformed.')
  assertSyntaxSourceComplexity(parsed, budget)
  return parsed
}

export async function readBoundedFile(
  filePath: string,
  budget?: ThemeIncludeBudget,
  readBudget?: SyntaxReadBudget,
  options: { readonly followSymbolicLink?: boolean } = {},
) {
  const followSymbolicLink = options.followSymbolicLink ?? true
  if (!followSymbolicLink && (await fs.lstat(filePath)).isSymbolicLink()) {
    throw new Error('Theme import source must not be a symbolic link.')
  }

  let handle: FileHandle
  try {
    handle = await fs.open(
      filePath,
      fsConstants.O_RDONLY |
        fsConstants.O_NONBLOCK |
        (followSymbolicLink ? 0 : fsConstants.O_NOFOLLOW),
    )
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ELOOP') {
      throw new Error('Theme import source must not be a symbolic link.', { cause: error })
    }
    throw error
  }
  try {
    return await readBoundedFileHandle(handle, budget, readBudget)
  } finally {
    await handle.close()
  }
}

async function readBoundedFileHandle(
  handle: FileHandle,
  budget?: ThemeIncludeBudget,
  readBudget?: SyntaxReadBudget,
) {
  const stats = await handle.stat()
  if (!stats.isFile()) throw new Error('Theme import source must be a file.')
  if (stats.size > IMPORT_SIZE_LIMIT_BYTES) throw new Error('Theme import exceeds the size limit.')

  const chunks: Buffer[] = []
  let totalBytes = 0
  while (true) {
    const remainingWithOverflowByte = IMPORT_SIZE_LIMIT_BYTES - totalBytes + 1
    const chunk = Buffer.allocUnsafe(Math.min(FILE_READ_CHUNK_BYTES, remainingWithOverflowByte))
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
    if (bytesRead === 0) break
    totalBytes += bytesRead
    if (totalBytes > IMPORT_SIZE_LIMIT_BYTES) {
      throw new Error('Theme import exceeds the size limit.')
    }
    if (readBudget) chargeSyntaxReadBudget(readBudget, bytesRead)
    if (budget) {
      if (budget.bytes + bytesRead > ARCHIVE_EXPANDED_LIMIT_BYTES) {
        throw new Error('VS Code theme include chain exceeds the aggregate byte limit.')
      }
      budget.bytes += bytesRead
    }
    chunks.push(chunk.subarray(0, bytesRead))
  }
  return Buffer.concat(chunks, totalBytes)
}

export function parseTextMatePlist(source: string) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(source)) {
    throw new Error('TextMate plist imports cannot contain document types or entities.')
  }
  const parsed: unknown = plist.parse(source)
  assertSyntaxSourceComplexity(parsed)
  return parsed
}

export function safeArchivePath(value: string) {
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'))
  if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error('Theme archive contains an unsafe path.')
  }
  return normalized.replace(/^\.\//, '')
}

export function confinedExtensionPath(root: string, declaredPath: string) {
  const resolved = path.resolve(root, declaredPath)
  const relative = path.relative(root, resolved)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Syntax extension contains a resource path outside its package.')
  }
  return resolved
}

export function appearanceVariantFromUiTheme(value: unknown): SyntaxAppearanceVariant | undefined {
  return match(value)
    .with('hc-light', () => 'high-contrast-light' as const)
    .with('hc-black', () => 'high-contrast-dark' as const)
    .with('vs', () => 'light' as const)
    .with('vs-dark', () => 'dark' as const)
    .otherwise(() => undefined)
}

interface ResolvedThemeDeclaration {
  readonly raw: Readonly<Record<string, unknown>>
  readonly original: Readonly<Record<string, unknown>>
}

function themeRules(raw: Readonly<Record<string, unknown>>) {
  const normalized = toJsonValue(raw.tokenColors ?? raw.settings)
  return Array.isArray(normalized) ? normalized : []
}

function mergeThemeDeclarations(
  base: Readonly<Record<string, unknown>>,
  child: Readonly<Record<string, unknown>>,
) {
  return {
    ...base,
    ...child,
    colors: { ...stringRecord(base.colors), ...stringRecord(child.colors) },
    tokenColors: [...themeRules(base), ...themeRules(child)],
  }
}

export async function resolveThemeDeclaration(
  entryPath: string,
  load: (resourcePath: string) => Promise<unknown>,
  resolveInclude: (resourcePath: string, includePath: string) => string | Promise<string>,
  visited = new Set<string>(),
): Promise<ResolvedThemeDeclaration> {
  if (visited.has(entryPath)) throw new Error('VS Code theme include chain contains a cycle.')
  if (visited.size >= THEME_INCLUDE_DEPTH_LIMIT) {
    throw new Error('VS Code theme include chain is too deep.')
  }
  const nextVisited = new Set(visited)
  nextVisited.add(entryPath)
  const parsed = await load(entryPath)
  if (!isRecord(parsed)) throw new Error('VS Code theme declaration must contain an object.')
  const includePath = parsed.include
  if (typeof includePath !== 'string') return { raw: parsed, original: parsed }
  const includedPath = await resolveInclude(entryPath, includePath)
  const base = await resolveThemeDeclaration(includedPath, load, resolveInclude, nextVisited)
  return { raw: mergeThemeDeclarations(base.raw, parsed), original: parsed }
}
