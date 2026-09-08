import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { safeDecodeUnknown } from '@shared/schema'
import { t3ProjectFileSchema } from '@shared/schemas/project-actions'
import {
  PROJECT_ACTION_LIMITS,
  type T3ProjectActionScript,
  type T3ProjectActionsDiscovery,
} from '@shared/types/project-actions'
import { normalizeBrowserPreviewAddress } from '@shared/utils/browser-preview-url'
import { isEnoent } from '@shared/utils/node-error'
import { type ParseError, parse as parseJsonc } from 'jsonc-parser'
import { isPathInsideDirectory } from '../utils/project-path-validation'

const T3_PROJECT_FILE_NAME = 't3.json'
const MAX_REPORTED_DECODE_ISSUES = 3

function invalidDiscovery(error: string): T3ProjectActionsDiscovery {
  return { status: 'invalid', scripts: [], candidates: [], error }
}

function normalizeT3Script(
  script: {
    readonly name: string
    readonly command: string
    readonly icon?: T3ProjectActionScript['icon']
    readonly runOnWorktreeCreate?: boolean
    readonly previewUrl?: string
    readonly autoOpenPreview?: boolean
  },
  sourceIndex: number,
): T3ProjectActionScript {
  const previewUrl = script.previewUrl ? normalizeBrowserPreviewAddress(script.previewUrl) : null
  return {
    sourceIndex,
    name: script.name.trim(),
    command: script.command.trim(),
    icon: script.icon ?? 'play',
    runOnWorktreeCreate: script.runOnWorktreeCreate ?? false,
    ...(previewUrl !== null
      ? { previewUrl, autoOpenPreview: script.autoOpenPreview === true }
      : {}),
  }
}

function decodeT3ProjectFile(raw: string): T3ProjectActionsDiscovery {
  const parseErrors: ParseError[] = []
  const parsed: unknown = parseJsonc(raw, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  })
  if (parseErrors.length > 0 || parsed === undefined) {
    return invalidDiscovery('t3.json contains malformed JSONC.')
  }

  const decoded = safeDecodeUnknown(t3ProjectFileSchema, parsed)
  if (!decoded.success) {
    return invalidDiscovery(
      `Invalid t3.json: ${decoded.issues.slice(0, MAX_REPORTED_DECODE_ISSUES).join('; ')}`,
    )
  }

  const scripts = (decoded.data.scripts ?? []).map(normalizeT3Script)
  return { status: 'valid', scripts, candidates: scripts }
}

async function resolveT3ProjectFile(projectPath: string) {
  const canonicalProjectPath = await realpath(projectPath)
  const requestedPath = path.join(canonicalProjectPath, T3_PROJECT_FILE_NAME)
  try {
    const resolvedPath = await realpath(requestedPath)
    if (!isPathInsideDirectory(canonicalProjectPath, resolvedPath)) {
      return { status: 'invalid', error: 't3.json must resolve inside the project root.' } as const
    }
    return { status: 'found', path: resolvedPath } as const
  } catch (error) {
    if (isEnoent(error)) return { status: 'missing' } as const
    return {
      status: 'invalid',
      error: error instanceof Error ? error.message : String(error),
    } as const
  }
}

/** Loads root `t3.json` without executing any discovered command. */
export async function loadT3ProjectActions(
  projectPath: string,
): Promise<T3ProjectActionsDiscovery> {
  let resolved: Awaited<ReturnType<typeof resolveT3ProjectFile>>
  try {
    resolved = await resolveT3ProjectFile(projectPath)
  } catch (error) {
    return invalidDiscovery(error instanceof Error ? error.message : String(error))
  }
  if (resolved.status === 'missing') {
    return { status: 'missing', scripts: [], candidates: [] }
  }
  if (resolved.status === 'invalid') return invalidDiscovery(resolved.error)

  try {
    const fileStats = await stat(resolved.path)
    if (!fileStats.isFile()) return invalidDiscovery('t3.json must be a regular file.')
    if (fileStats.size > PROJECT_ACTION_LIMITS.T3_FILE_BYTES) {
      return invalidDiscovery('t3.json exceeds the supported file size.')
    }
    return decodeT3ProjectFile(await readFile(resolved.path, 'utf-8'))
  } catch (error) {
    if (isEnoent(error)) return { status: 'missing', scripts: [], candidates: [] }
    return invalidDiscovery(error instanceof Error ? error.message : String(error))
  }
}
