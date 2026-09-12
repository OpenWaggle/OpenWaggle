import type {
  TerminalFileActivationTarget,
  TerminalLinkActivationTarget,
  TerminalLinkResolutionContext,
  TerminalLinkSource,
  TerminalUrlActivationTarget,
} from './terminal-link-types'

export interface TerminalFileReference {
  readonly path: string
  readonly line: number | null
  readonly column: number | null
}

interface ReferencePosition {
  readonly pathEnd: number
  readonly line: number | null
  readonly column: number | null
}

type PathFlavor = 'posix' | 'windows'

const WINDOWS_DRIVE_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/u
const WINDOWS_UNC_PATTERN = /^\\\\/u
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/u
const COLON_POSITION_PATTERN = /:(\d+)(?::(\d+))?$/u
const PAREN_POSITION_PATTERN = /\((\d+)\s*(?:,\s*(\d+))?\)$/u
const LAST_CONTROL_CHARACTER = 0x1f
const DELETE_CHARACTER = 0x7f
const COLUMN_CAPTURE_INDEX = 2
const WINDOWS_ROOT_PREFIX_LENGTH = 2
const WINDOWS_DRIVE_PATH_PREFIX_LENGTH = 3

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= LAST_CONTROL_CHARACTER || code === DELETE_CHARACTER) return true
  }
  return false
}

function isWindowsAbsolutePath(value: string) {
  return WINDOWS_DRIVE_ABSOLUTE_PATTERN.test(value) || WINDOWS_UNC_PATTERN.test(value)
}

function isAbsolutePath(value: string) {
  return value.startsWith('/') || isWindowsAbsolutePath(value)
}

function absolutePathFlavor(value: string): PathFlavor | null {
  if (isWindowsAbsolutePath(value)) return 'windows'
  return value.startsWith('/') ? 'posix' : null
}

function pathFlavor(value: string, fallback: string): PathFlavor {
  return absolutePathFlavor(value) ?? absolutePathFlavor(fallback) ?? 'posix'
}

function separatorFor(flavor: PathFlavor) {
  return flavor === 'windows' ? '\\' : '/'
}

function normalizedSegments(segments: readonly string[], absolute: boolean) {
  const output: string[] = []
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.') continue
    if (segment !== '..') {
      output.push(segment)
      continue
    }
    if (output.length > 0 && output.at(-1) !== '..') {
      output.pop()
      continue
    }
    if (!absolute) output.push(segment)
  }
  return output
}

function normalizeWindowsPath(value: string) {
  const slashPath = value.replaceAll('/', '\\')
  if (WINDOWS_UNC_PATTERN.test(slashPath)) {
    const parts = slashPath
      .slice(WINDOWS_ROOT_PREFIX_LENGTH)
      .split('\\')
      .filter((part) => part.length > 0)
    const server = parts[0]
    const share = parts[1]
    if (server === undefined || share === undefined) return slashPath
    const tail = normalizedSegments(parts.slice(WINDOWS_ROOT_PREFIX_LENGTH), true)
    return `\\\\${server}\\${share}${tail.length > 0 ? `\\${tail.join('\\')}` : ''}`
  }

  const drive = WINDOWS_DRIVE_ABSOLUTE_PATTERN.exec(slashPath)?.[0].slice(
    0,
    WINDOWS_ROOT_PREFIX_LENGTH,
  )
  if (drive !== undefined) {
    const tail = normalizedSegments(
      slashPath.slice(WINDOWS_DRIVE_PATH_PREFIX_LENGTH).split('\\'),
      true,
    )
    return `${drive}\\${tail.join('\\')}`
  }
  return normalizedSegments(slashPath.split('\\'), false).join('\\')
}

function normalizePosixPath(value: string) {
  const slashPath = value.replaceAll('\\', '/')
  const absolute = slashPath.startsWith('/')
  const tail = normalizedSegments(slashPath.split('/'), absolute).join('/')
  if (!absolute) return tail || '.'
  return tail.length > 0 ? `/${tail}` : '/'
}

function normalizePath(value: string, flavor: PathFlavor) {
  return flavor === 'windows' ? normalizeWindowsPath(value) : normalizePosixPath(value)
}

function joinPath(base: string, child: string, flavor: PathFlavor) {
  const separator = separatorFor(flavor)
  return normalizePath(`${base.replace(/[\\/]+$/u, '')}${separator}${child}`, flavor)
}

function comparablePath(value: string, flavor: PathFlavor) {
  const normalized = normalizePath(value, flavor)
  return flavor === 'windows' ? normalized.toLocaleLowerCase() : normalized
}

function projectRelativePath(target: string, root: string | null | undefined) {
  if (root === null || root === undefined || root.trim().length === 0) return null
  const targetFlavor = absolutePathFlavor(target)
  const rootFlavor = absolutePathFlavor(root)
  if (targetFlavor === null || rootFlavor === null || targetFlavor !== rootFlavor) return null

  const normalizedTarget = normalizePath(target, targetFlavor)
  const normalizedRoot = normalizePath(root, rootFlavor)
  const comparedTarget = comparablePath(normalizedTarget, targetFlavor)
  const comparedRoot = comparablePath(normalizedRoot, rootFlavor)
  if (comparedTarget === comparedRoot) return '.'

  const separator = separatorFor(targetFlavor)
  const relativeStart = normalizedRoot.endsWith(separator)
    ? normalizedRoot.length
    : normalizedRoot.length + separator.length
  const rootPrefix = normalizedRoot.endsWith(separator)
    ? comparedRoot
    : `${comparedRoot}${separator}`
  if (!comparedTarget.startsWith(rootPrefix)) return null
  return normalizedTarget.slice(relativeStart).replaceAll('\\', '/')
}

function inferHomePath(cwd: string) {
  const macHome = /^(\/Users\/[^/]+)/u.exec(cwd)?.[1]
  if (macHome !== undefined) return macHome
  const linuxHome = /^(\/home\/[^/]+)/u.exec(cwd)?.[1]
  if (linuxHome !== undefined) return linuxHome
  return /^([A-Za-z]:[\\/]Users[\\/][^\\/]+)/u.exec(cwd)?.[1]
}

function positiveSafeInteger(value: string | undefined) {
  if (value === undefined) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null
}

function referencePosition(value: string): ReferencePosition | null {
  const match = PAREN_POSITION_PATTERN.exec(value) ?? COLON_POSITION_PATTERN.exec(value)
  if (match === null) return { pathEnd: value.length, line: null, column: null }
  const line = positiveSafeInteger(match[1])
  const column = positiveSafeInteger(match[COLUMN_CAPTURE_INDEX])
  if (line === null || (match[COLUMN_CAPTURE_INDEX] !== undefined && column === null)) return null
  return { pathEnd: match.index, line, column }
}

function invalidReferencePath(path: string) {
  return (
    path.length === 0 || path === '.' || path === '..' || path.endsWith('/') || path.endsWith('\\')
  )
}

export function parseTerminalFileReference(rawValue: string): TerminalFileReference | null {
  const value = rawValue.trim()
  if (value.length === 0 || hasControlCharacter(value)) return null
  if (SCHEME_PATTERN.test(value) && !WINDOWS_DRIVE_ABSOLUTE_PATTERN.test(value)) return null
  const position = referencePosition(value)
  if (position === null) return null
  const path = value.slice(0, position.pathEnd)
  return invalidReferencePath(path) ? null : { path, line: position.line, column: position.column }
}

function resolveFilePath(reference: TerminalFileReference, context: TerminalLinkResolutionContext) {
  const cwd = context.cwd.trim()
  if (!isAbsolutePath(cwd)) return null
  const homePath =
    reference.path === '~' || reference.path.startsWith('~/') || reference.path.startsWith('~\\')
  if (homePath) {
    const home = context.homePath?.trim() || inferHomePath(cwd)
    if (home === undefined || !isAbsolutePath(home)) {
      return { resolvedPath: reference.path, resolution: 'home-unresolved' as const }
    }
    const flavor = pathFlavor(home, cwd)
    const child = reference.path.slice(1).replace(/^[\\/]+/u, '')
    return { resolvedPath: joinPath(home, child, flavor), resolution: 'home-relative' as const }
  }
  if (isAbsolutePath(reference.path)) {
    return {
      resolvedPath: normalizePath(reference.path, pathFlavor(reference.path, cwd)),
      resolution: 'absolute' as const,
    }
  }
  return {
    resolvedPath: joinPath(cwd, reference.path, pathFlavor(cwd, reference.path)),
    resolution: 'cwd-relative' as const,
  }
}

export function resolveTerminalFileTarget(
  rawValue: string,
  source: TerminalLinkSource,
  context: TerminalLinkResolutionContext,
): TerminalFileActivationTarget | null {
  const reference = parseTerminalFileReference(rawValue)
  if (reference === null) return null
  if (source === 'plain' && !/[\p{L}\p{M}_]/u.test(reference.path)) return null
  const resolved = resolveFilePath(reference, context)
  if (resolved === null) return null
  const relative =
    resolved.resolution === 'home-unresolved'
      ? null
      : projectRelativePath(resolved.resolvedPath, context.projectRoot)
  return {
    kind: 'file',
    source,
    rawPath: reference.path,
    resolvedPath: resolved.resolvedPath,
    line: reference.line,
    column: reference.column,
    projectRelativePath: relative,
    route: relative === null ? 'external-editor' : 'workspace-preview',
    resolution: resolved.resolution,
  }
}

export function resolveTerminalUrlTarget(
  rawValue: string,
  source: TerminalLinkSource,
): TerminalUrlActivationTarget | null {
  if (hasControlCharacter(rawValue)) return null
  let parsed: URL
  try {
    parsed = new URL(rawValue)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.hostname.length === 0 || parsed.username.length > 0 || parsed.password.length > 0) {
    return null
  }
  return { kind: 'url', source, url: parsed.href, route: 'url-preview' }
}

function fileUriPath(parsed: URL) {
  if (parsed.username.length > 0 || parsed.password.length > 0 || parsed.port.length > 0)
    return null
  if (parsed.search.length > 0 || parsed.hash.length > 0) return null
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }
  if (hasControlCharacter(decodedPath)) return null
  const host = parsed.hostname
  if (host.length > 0 && host.toLocaleLowerCase() !== 'localhost') {
    return `\\\\${host}${decodedPath.replaceAll('/', '\\')}`
  }
  if (/^\/[A-Za-z]:\//u.test(decodedPath)) return decodedPath.slice(1)
  return decodedPath
}

/** Validates a URI delivered by xterm's OSC 8 linkHandler. */
export function resolveTerminalOsc8Target(
  uri: string,
  context: TerminalLinkResolutionContext,
): TerminalLinkActivationTarget | null {
  const value = uri.trim()
  const urlTarget = resolveTerminalUrlTarget(value, 'osc8')
  if (urlTarget !== null) return urlTarget
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'file:') return null
  const path = fileUriPath(parsed)
  return path === null ? null : resolveTerminalFileTarget(path, 'osc8', context)
}
