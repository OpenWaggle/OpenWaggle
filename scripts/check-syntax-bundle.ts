/**
 * The renderer build's shape: no legacy editor assets, no deferred code-rendering asset in what
 * `index.html` loads at boot, exactly one syntax worker, focused editor and editor worker, and a
 * chunk for every chat surface source. Its sizes (the entry, the initial graph, the chat surface,
 * the workers) are budgets in performance/perf-budgets.json, which the `perf-budgets` step checks
 * (scripts/perf-gate/build-metrics.ts); this prints them for reference and fails on none.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  chatSurfaceSources,
  DEFERRED_RENDERER_ASSETS,
  deferredRendererAsset,
  initialRendererScripts,
  lazySurfaceChunkFiles,
  parseRendererManifest,
} from './renderer-chunk-graph'

const RENDERER_DIRECTORY = path.resolve('out/renderer')
const ASSETS_DIRECTORY = path.join(RENDERER_DIRECTORY, 'assets')
const RENDERER_MANIFEST = path.join(RENDERER_DIRECTORY, '.vite/manifest.json')
const FORBIDDEN_INITIAL_ASSET_PATTERN =
  /(?:ChatDiffPane|DiffBlock|FocusedSourceEditor|pierre-syntax-runtime|syntax\.worker|worker-)/u

async function bytesOf(directory: string, files: readonly string[]) {
  const sizes = await Promise.all(
    files.map(async (file) => (await fs.stat(path.join(directory, file))).size),
  )
  return sizes.reduce((total, size) => total + size, 0)
}

async function main() {
  const assets = await fs.readdir(ASSETS_DIRECTORY)
  const legacyAssets = assets.filter((asset) => /monaco|ts\.worker/iu.test(asset))
  if (legacyAssets.length > 0) {
    throw new Error(`Legacy editor assets found: ${legacyAssets.join(', ')}`)
  }
  const initial = initialRendererScripts(
    await fs.readFile(path.join(RENDERER_DIRECTORY, 'index.html'), 'utf8'),
  )
  const forbidden = initial.assets.filter((asset) => FORBIDDEN_INITIAL_ASSET_PATTERN.test(asset))
  if (forbidden.length > 0) {
    throw new Error(
      `Deferred code-rendering assets entered the initial graph: ${forbidden.join(', ')}`,
    )
  }
  const manifest = parseRendererManifest(JSON.parse(await fs.readFile(RENDERER_MANIFEST, 'utf8')))
  const chatSurface = lazySurfaceChunkFiles(
    manifest,
    chatSurfaceSources(manifest),
    new Set(initial.assets.map((asset) => `assets/${asset}`)),
  )
  const lines = [
    `renderer.initial.entry.bytes: ${String(await bytesOf(ASSETS_DIRECTORY, [initial.entry]))} (${initial.entry})`,
    `renderer.initial.bytes: ${String(await bytesOf(ASSETS_DIRECTORY, initial.assets))} in ${String(initial.assets.length)} scripts`,
    `renderer.chat-surface.bytes: ${String(await bytesOf(RENDERER_DIRECTORY, chatSurface))} in ${String(chatSurface.length)} chunks`,
  ]
  for (const deferred of DEFERRED_RENDERER_ASSETS) {
    const asset = deferredRendererAsset(assets, deferred)
    lines.push(`${deferred.metric}: ${String(await bytesOf(ASSETS_DIRECTORY, [asset]))} (${asset})`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
