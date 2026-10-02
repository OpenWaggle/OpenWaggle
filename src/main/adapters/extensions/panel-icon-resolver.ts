import { formatErrorMessage, isEnoent } from '@shared/utils/node-error'
import { Effect, Layer } from 'effect'
import {
  SVG_ICON_MAX_BYTES,
  sanitizeSvgIcon,
} from '../../domain/extension-panel-icon/svg-icon-sanitizer'
import {
  type ExtensionPanelIconRequest,
  type ExtensionPanelIconResolution,
  ExtensionPanelIconResolver,
  type ExtensionPanelIconResolverShape,
} from '../../ports/extension-panel-icon-resolver'
import { readBoundedFile } from './bounded-file-read'
import { type LucideIconCatalog, loadBundledLucideIcons, lucideIconSvg } from './lucide-panel-icon'
import { resolveSafePackageFilePath } from './package-files'

/**
 * A failed read is `retryable` when it may succeed later without the package changing (for
 * example EMFILE, EACCES or EBUSY); such failures are reported but never cached.
 */
export type PanelIconFileRead =
  | { readonly ok: true; readonly source: string }
  | { readonly ok: false; readonly message: string; readonly retryable: boolean }

export interface ExtensionPanelIconResolverDependencies {
  readonly readIconFile?: (packagePath: string, relativePath: string) => Promise<PanelIconFileRead>
  readonly loadLucideIcons?: () => Promise<LucideIconCatalog>
}

/** Bounds memory for long sessions that install and update many packages. */
const MAX_CACHED_SVG_ICONS = 256
const KEY_SEPARATOR = '\u0000'

function deterministicReadFailure(message: string): PanelIconFileRead {
  return { ok: false, message, retryable: false }
}

/** Reads a package SVG once, confined by realpath to the package root and capped in size. */
export async function readPackageIconFile(
  packagePath: string,
  relativePath: string,
): Promise<PanelIconFileRead> {
  try {
    const filePath = await resolveSafePackageFilePath(packagePath, relativePath)
    if (filePath === null) {
      return deterministicReadFailure('The SVG icon resolves outside the extension package root.')
    }
    const read = await readBoundedFile(filePath, SVG_ICON_MAX_BYTES)
    if (read.kind === 'not-file') return deterministicReadFailure('The SVG icon is not a file.')
    if (read.kind === 'oversized') {
      return deterministicReadFailure(
        `The SVG icon is larger than ${String(SVG_ICON_MAX_BYTES)} bytes.`,
      )
    }
    return { ok: true, source: read.content.toString('utf8') }
  } catch (error) {
    return isEnoent(error)
      ? deterministicReadFailure('The SVG icon file does not exist.')
      : {
          ok: false,
          message: `The SVG icon could not be read: ${formatErrorMessage(error)}`,
          retryable: true,
        }
  }
}

function rememberBounded<V>(cache: Map<string, V>, key: string, value: V) {
  cache.set(key, value)
  if (cache.size <= MAX_CACHED_SVG_ICONS) return
  const oldestKey = cache.keys().next().value
  if (oldestKey !== undefined) cache.delete(oldestKey)
}

export function createExtensionPanelIconResolver(
  dependencies: ExtensionPanelIconResolverDependencies = {},
): ExtensionPanelIconResolverShape {
  const readIconFile = dependencies.readIconFile ?? readPackageIconFile
  const loadLucideIcons = dependencies.loadLucideIcons ?? loadBundledLucideIcons
  const lucideCache = new Map<string, ExtensionPanelIconResolution>()
  const svgCache = new Map<string, Promise<ExtensionPanelIconResolution>>()

  async function resolveLucide(name: string): Promise<ExtensionPanelIconResolution> {
    const cached = lucideCache.get(name)
    if (cached) return cached
    const svg = lucideIconSvg(await loadLucideIcons(), name)
    const resolution: ExtensionPanelIconResolution =
      svg === null
        ? { status: 'invalid', message: `"${name}" is not a bundled Lucide icon name.` }
        : { status: 'resolved', icon: { source: 'lucide', svg } }
    rememberBounded(lucideCache, name, resolution)
    return resolution
  }

  async function readAndSanitize(
    packagePath: string,
    relativePath: string,
  ): Promise<{ readonly resolution: ExtensionPanelIconResolution; readonly cacheable: boolean }> {
    const read = await readIconFile(packagePath, relativePath).catch(
      (error: unknown): PanelIconFileRead => ({
        ok: false,
        message: `The SVG icon could not be read: ${formatErrorMessage(error)}`,
        retryable: true,
      }),
    )
    if (!read.ok) {
      return {
        resolution: { status: 'invalid', message: read.message, path: relativePath },
        cacheable: !read.retryable,
      }
    }
    const sanitized = sanitizeSvgIcon(read.source)
    return {
      resolution: sanitized.ok
        ? { status: 'resolved', icon: { source: 'svg', svg: sanitized.svg } }
        : { status: 'invalid', message: sanitized.reason, path: relativePath },
      cacheable: true,
    }
  }

  /** Resolved icons and deterministic failures are cached; retryable failures are forgotten. */
  async function readSanitizeAndRemember(
    key: string,
    packagePath: string,
    relativePath: string,
  ): Promise<ExtensionPanelIconResolution> {
    const outcome = await readAndSanitize(packagePath, relativePath)
    if (!outcome.cacheable) svgCache.delete(key)
    return outcome.resolution
  }

  function resolveSvg(request: ExtensionPanelIconRequest, relativePath: string) {
    const key = [request.packagePath, request.contentHash, relativePath].join(KEY_SEPARATOR)
    const cached = svgCache.get(key)
    if (cached) return cached
    const pending = readSanitizeAndRemember(key, request.packagePath, relativePath)
    rememberBounded(svgCache, key, pending)
    return pending
  }

  return {
    resolve: (request) =>
      Effect.tryPromise(() =>
        typeof request.icon === 'string'
          ? resolveLucide(request.icon)
          : resolveSvg(request, request.icon.svg),
      ).pipe(
        Effect.catchAll((error) =>
          Effect.succeed<ExtensionPanelIconResolution>({
            status: 'invalid',
            message: `The icon could not be resolved: ${formatErrorMessage(error.cause)}`,
          }),
        ),
      ),
  }
}

export const FilesystemExtensionPanelIconResolverLive = Layer.sync(ExtensionPanelIconResolver, () =>
  createExtensionPanelIconResolver(),
)
