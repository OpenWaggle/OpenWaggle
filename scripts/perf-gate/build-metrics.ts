/**
 * The build's sizes and counts, read from `out/` after `electron-vite build`. They are budgets in
 * performance/perf-budgets.json, with no ceiling in code: the `perf-budgets` step fails when the
 * file differs from the measurement, and the Performance Gate when a value grew over main's.
 *
 * - the boot shim, compiled from source on every launch before V8's compile cache exists
 *   (src/main/boot.ts), so whatever it imports every process pays;
 * - the main bundle bytes each kind of process loads at startup (main-bundle-graph.ts);
 * - the source modules the desktop app evaluates before its window shows: every module of the
 *   chunks its startup reaches (one file today, so the whole main bundle), and how many of them
 *   come from packages;
 * - the main-process workers and the preload script;
 * - the renderer's entry and everything `index.html` preloads, the chat surface's chunks
 *   (renderer-chunk-graph.ts), the syntax worker, the focused editor and its worker;
 * - every renderer asset, and the requests and chunks the window makes before the chat is ready:
 *   `index.html`, what it references, and the chat surface's chunks and stylesheets.
 *
 * A dev build names its branch in the bundle (scripts/build-identity.ts), which would make bytes
 * differ by checkout, so the measured build uses one slug (`PERF_BUILD_ENV`).
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseJsonUnknown } from '@shared/schema'
import {
  MAIN_ENTRY_CHUNK,
  MAIN_PROCESSES,
  parseMainChunkManifest,
  processStartupChunks,
} from '../main-bundle-graph'
import {
  CHAT_SURFACE_SOURCES,
  chatSurfaceSources,
  DEFERRED_RENDERER_ASSETS,
  deferredRendererAsset,
  initialRendererScripts,
  lazySurfaceChunkFiles,
  parseRendererManifest,
  type RendererManifest,
} from '../renderer-chunk-graph'
import { MAIN_CHUNK_MANIFEST_PATH } from '../vite/main-chunk-manifest'

const MAIN_BOOT_FILE = 'boot.js'
const GUI_METRIC = 'main.startup.gui.bytes'
const PERF_BUILD_SLUG = 'perf-budgets'
/** The environment of the build the budgets measure: `bun run check` and `perf:budgets:update`. */
export const PERF_BUILD_ENV: Readonly<Record<string, string>> = {
  OPENWAGGLE_DEV_SLUG: PERF_BUILD_SLUG,
}
const PERF_BUILD_MARK = `OpenWaggle Dev (${PERF_BUILD_SLUG})`
const PAGE_REFERENCE = /(?:src|href)="\.\/(?<file>assets\/[^"]+)"/gu
/** `index.html` itself. */
const DOCUMENT_REQUESTS = 1

function readJson(file: string) {
  return parseJsonUnknown(fs.readFileSync(file, 'utf8'))
}

function files(directory: string) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.endsWith('.map'))
    .map((entry) => entry.name)
}

function bytesOf(directory: string, names: readonly string[]) {
  return names.reduce((total, name) => total + fs.statSync(path.join(directory, name)).size, 0)
}

function mainMetrics(out: string) {
  const main = path.join(out, 'main')
  const manifest = parseMainChunkManifest(readJson(path.join(main, MAIN_CHUNK_MANIFEST_PATH)))
  if (!fs.readFileSync(path.join(main, MAIN_BOOT_FILE), 'utf8').includes(PERF_BUILD_MARK)) {
    throw new Error(
      `out/ was not built with OPENWAGGLE_DEV_SLUG=${PERF_BUILD_SLUG} and no release channel, so its sizes are not the budgets'. Run bun run perf:budgets:update, or bun run check.`,
    )
  }
  const gui = MAIN_PROCESSES.find((startup) => startup.metric === GUI_METRIC)
  if (gui === undefined) throw new Error(`MAIN_PROCESSES has no ${GUI_METRIC}.`)
  const chunks = new Set(processStartupChunks(manifest, gui.startupModules))
  const modules = manifest
    .filter((entry) => chunks.has(entry.file))
    .flatMap((entry) => entry.modules)
    .filter((module) => !module.startsWith('\0'))
  const chunkFiles = new Set(manifest.map((entry) => entry.file))
  const workers = files(main).filter(
    (name) => name.endsWith('.js') && name !== MAIN_BOOT_FILE && !chunkFiles.has(name),
  )
  if (!chunkFiles.has(MAIN_ENTRY_CHUNK)) throw new Error(`out/main has no ${MAIN_ENTRY_CHUNK}.`)
  const preload = path.join(out, 'preload')
  const startupBytes: Record<string, number> = {}
  for (const startup of MAIN_PROCESSES) {
    startupBytes[startup.metric] = bytesOf(
      main,
      processStartupChunks(manifest, startup.startupModules),
    )
  }
  return {
    'main.boot.bytes': bytesOf(main, [MAIN_BOOT_FILE]),
    ...startupBytes,
    'main.startup.modules': modules.length,
    'main.startup.package-modules': modules.filter((module) => module.includes('node_modules/'))
      .length,
    'main.workers.bytes': bytesOf(main, workers),
    'preload.bytes': bytesOf(preload, files(preload)),
  }
}

/** The chat surface's chunks and stylesheets beyond what `index.html` already loads. */
function chatSurfaceFiles(manifest: RendererManifest, initial: ReadonlySet<string>) {
  const patterns = chatSurfaceSources(manifest)
  const pending = Object.keys(manifest).filter((key) => patterns.some((p) => p.test(key)))
  if (pending.length < CHAT_SURFACE_SOURCES.length) {
    throw new Error('The renderer manifest has no chat surface chunks (renderer-chunk-graph.ts).')
  }
  const visited = new Set<string>()
  const found = new Set<string>()
  for (let key = pending.pop(); key !== undefined; key = pending.pop()) {
    if (visited.has(key)) continue
    visited.add(key)
    const chunk = manifest[key]
    if (chunk === undefined) continue
    for (const file of [chunk.file, ...(chunk.css ?? [])]) if (!initial.has(file)) found.add(file)
    pending.push(...(chunk.imports ?? []))
  }
  return [...found]
}

function rendererMetrics(out: string) {
  const renderer = path.join(out, 'renderer')
  const assets = files(path.join(renderer, 'assets'))
  const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8')
  const initial = new Set(
    [...html.matchAll(PAGE_REFERENCE)].flatMap((match) =>
      match.groups?.file ? [match.groups.file] : [],
    ),
  )
  const manifest = parseRendererManifest(readJson(path.join(renderer, '.vite', 'manifest.json')))
  const requests = [...initial, ...chatSurfaceFiles(manifest, initial)]
  const assetsDirectory = path.join(renderer, 'assets')
  const scripts = initialRendererScripts(html)
  const chatSurface = lazySurfaceChunkFiles(
    manifest,
    chatSurfaceSources(manifest),
    new Set(scripts.assets.map((asset) => `assets/${asset}`)),
  )
  const deferred: Record<string, number> = {}
  for (const asset of DEFERRED_RENDERER_ASSETS) {
    deferred[asset.metric] = bytesOf(assetsDirectory, [deferredRendererAsset(assets, asset)])
  }
  return {
    'renderer.initial.entry.bytes': bytesOf(assetsDirectory, [scripts.entry]),
    'renderer.initial.bytes': bytesOf(assetsDirectory, scripts.assets),
    'renderer.chat-surface.bytes': bytesOf(renderer, chatSurface),
    ...deferred,
    'renderer.assets.files': assets.length,
    'renderer.assets.bytes': bytesOf(path.join(renderer, 'assets'), assets),
    'renderer.chat-ready.requests': DOCUMENT_REQUESTS + requests.length,
    'renderer.chat-ready.chunks': requests.filter((file) => file.endsWith('.js')).length,
  }
}

/** Every build metric of `out/` (the electron-vite output directory). */
export function measureBuild(out = path.resolve('out')) {
  return { ...mainMetrics(out), ...rendererMetrics(out) }
}
