import { Schema } from '@shared/schema'
/** The part of a Vite build manifest (`out/renderer/.vite/manifest.json`) the bundle budget reads. */
export interface RendererManifestChunk {
  readonly file: string
  readonly imports?: readonly string[]
}

export type RendererManifest = Readonly<Record<string, RendererManifestChunk>>

/** A Vite manifest chunk: its file and, when it has any, the chunks it imports. */
const manifestChunkSchema = Schema.Struct({
  file: Schema.String,
  imports: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
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
