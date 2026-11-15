import { Schema } from '@shared/schema'
import { namedGroups } from '@shared/utils/regex-named-groups'

/** The part of a Vite build manifest (`out/renderer/.vite/manifest.json`) the bundle budgets read. */
export interface RendererManifestChunk {
  readonly file: string
  readonly imports?: readonly string[]
  readonly css?: readonly string[]
}

/** The chat surface: the welcome and Session route chunks the shell loads before the composer. */
export const CHAT_SURFACE_SOURCES: readonly RegExp[] = [
  /^src\/routes\/_chat\.index\.tsx\?tsr-split=component$/u,
  /^src\/routes\/sessions\.\$sessionId\.tsx\?tsr-split=component$/u,
]
/** A chunk of its own before B1 moved the surface into the route chunks; counted if it is one again. */
export const OPTIONAL_CHAT_SURFACE_SOURCES: readonly RegExp[] = [
  /^src\/routes\/-chat-route-surface\.tsx$/u,
]

export type RendererManifest = Readonly<Record<string, RendererManifestChunk>>

/** The chat surface's source patterns in this build: the optional ones only when they are chunks. */
export function chatSurfaceSources(manifest: RendererManifest) {
  const keys = Object.keys(manifest)
  return [
    ...CHAT_SURFACE_SOURCES,
    ...OPTIONAL_CHAT_SURFACE_SOURCES.filter((pattern) => keys.some((key) => pattern.test(key))),
  ]
}

const ENTRY_SCRIPT = /<script[^>]+src="\.\/assets\/(?<asset>[^"]+\.js)"/u
const MODULE_PRELOAD = /<link[^>]+rel="modulepreload"[^>]+href="\.\/assets\/(?<asset>[^"]+\.js)"/gu

/**
 * The scripts `index.html` loads at boot, as file names under `assets/`: its entry and every chunk
 * it preloads, the entry first.
 */
export function initialRendererScripts(html: string) {
  const entry = namedGroups(html.match(ENTRY_SCRIPT), ['asset'])?.asset
  if (!entry) throw new Error('Could not resolve the initial renderer asset from index.html.')
  const preloaded = [...html.matchAll(MODULE_PRELOAD)].flatMap(
    (match) => namedGroups(match, ['asset'])?.asset ?? [],
  )
  return { entry, assets: [...new Set([entry, ...preloaded])] }
}

/** Deferred assets the build emits once each, with the metric that holds their bytes. */
export const DEFERRED_RENDERER_ASSETS = [
  {
    metric: 'renderer.syntax-worker.bytes',
    label: 'syntax worker',
    pattern: /^syntax\.worker-[^.]+\.js$/u,
  },
  {
    metric: 'renderer.focused-editor.bytes',
    label: 'focused editor',
    pattern: /^FocusedSourceEditor-[^.]+\.js$/u,
  },
  {
    metric: 'renderer.focused-editor-worker.bytes',
    label: 'focused editor worker',
    pattern: /^worker-[^.]+\.js$/u,
  },
] as const

/** The one asset in `assets` that matches, or an error naming how many did. */
export function deferredRendererAsset(
  assets: readonly string[],
  deferred: (typeof DEFERRED_RENDERER_ASSETS)[number],
) {
  const matches = assets.filter((asset) => deferred.pattern.test(asset))
  const [only] = matches
  if (matches.length !== 1 || only === undefined) {
    throw new Error(`Expected one ${deferred.label} asset, found ${String(matches.length)}.`)
  }
  return only
}

/** A Vite manifest chunk: its file and, when it has any, the chunks and stylesheets it imports. */
const manifestChunkSchema = Schema.Struct({
  file: Schema.String,
  imports: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  css: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
})

function isManifestChunk(value: unknown): value is RendererManifestChunk {
  return Schema.is(manifestChunkSchema)(value)
}

export function parseRendererManifest(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The renderer build manifest is not an object.')
  }
  const manifest: Record<string, RendererManifestChunk> = {}
  for (const [key, chunk] of Object.entries(value)) {
    if (!isManifestChunk(chunk)) throw new Error(`Malformed renderer manifest entry ${key}.`)
    manifest[key] = chunk
  }
  return manifest
}

/**
 * Chunks a lazily loaded surface needs before it can render: the chunks of its source modules and
 * everything they import statically, minus what the initial `index.html` graph already loaded.
 * Dynamic imports inside the surface load later, so they are not counted.
 */
export function lazySurfaceChunkFiles(
  manifest: RendererManifest,
  sourcePatterns: readonly RegExp[],
  initialFiles: ReadonlySet<string>,
) {
  const starts = Object.keys(manifest).filter((key) =>
    sourcePatterns.some((pattern) => pattern.test(key)),
  )
  const unmatched = sourcePatterns.filter((pattern) => !starts.some((key) => pattern.test(key)))
  if (unmatched.length > 0) {
    throw new Error(`No renderer chunk for ${unmatched.map(String).join(', ')}.`)
  }
  const visited = new Set<string>()
  const pending = [...starts]
  while (pending.length > 0) {
    const key = pending.pop()
    if (key === undefined || visited.has(key)) continue
    visited.add(key)
    pending.push(...(manifest[key]?.imports ?? []))
  }
  const files = [...visited].flatMap((key) => {
    const file = manifest[key]?.file
    return file === undefined ? [] : [file]
  })
  return [...new Set(files)].filter((file) => !initialFiles.has(file)).sort()
}
