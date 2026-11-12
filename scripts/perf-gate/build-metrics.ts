/**
 * The build's sizes and counts that no other bundle budget holds, read from `out/` after
 * `electron-vite build`. The bytes that already have a cap stay with it (scripts/check-syntax-bundle.ts:
 * the initial renderer, its graph, the chat surface, the syntax and editor workers;
 * scripts/check-main-bundle.ts and main-bundle-graph.ts: the boot shim and what each process loads);
 * this adds what they leave out:
 *
 * - the source modules the desktop app evaluates before its window shows: every module of the
 *   chunks its startup reaches (one file today, so the whole main bundle), and how many of them
 *   come from packages;
 * - the main-process workers and the preload script;
 * - every renderer asset, and the requests and chunks the window makes before the chat is ready:
 *   `index.html`, what it references, and the chat surface's chunks and stylesheets.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  MAIN_ENTRY_CHUNK,
  MAIN_PROCESS_BUDGETS,
  parseMainChunkManifest,
  processStartupChunks,
} from '../main-bundle-graph'
import {
  CHAT_SURFACE_SOURCES,
  OPTIONAL_CHAT_SURFACE_SOURCES,
  parseRendererManifest,
  type RendererManifest,
} from '../renderer-chunk-graph'
import { MAIN_CHUNK_MANIFEST_PATH } from '../vite/main-chunk-manifest'

const MAIN_BOOT_FILE = 'boot.js'
const GUI_LABEL = 'desktop app (GUI)'
const PAGE_REFERENCE = /(?:src|href)="\.\/(?<file>assets\/[^"]+)"/gu
/** `index.html` itself. */
const DOCUMENT_REQUESTS = 1

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
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
  const gui = MAIN_PROCESS_BUDGETS.find((budget) => budget.label === GUI_LABEL)
  if (gui === undefined) throw new Error(`MAIN_PROCESS_BUDGETS has no ${GUI_LABEL}.`)
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
  return {
    'main.startup.modules': modules.length,
    'main.startup.package-modules': modules.filter((module) => module.includes('node_modules/'))
      .length,
    'main.workers.bytes': bytesOf(main, workers),
    'preload.bytes': bytesOf(preload, files(preload)),
  }
}

/** The chat surface's chunks and stylesheets beyond what `index.html` already loads. */
function chatSurfaceFiles(manifest: RendererManifest, initial: ReadonlySet<string>) {
  const patterns = [
    ...CHAT_SURFACE_SOURCES,
    ...OPTIONAL_CHAT_SURFACE_SOURCES.filter((pattern) =>
      Object.keys(manifest).some((key) => pattern.test(key)),
    ),
  ]
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
      match.groups?.['file'] ? [match.groups['file']] : [],
    ),
  )
  const manifest = parseRendererManifest(readJson(path.join(renderer, '.vite', 'manifest.json')))
  const requests = [...initial, ...chatSurfaceFiles(manifest, initial)]
  return {
    'renderer.assets.files': assets.length,
    'renderer.assets.bytes': bytesOf(path.join(renderer, 'assets'), assets),
    'renderer.chat-ready.requests': DOCUMENT_REQUESTS + requests.length,
    'renderer.chat-ready.chunks': requests.filter((file) => file.endsWith('.js')).length,
  }
}

/** Every build metric of `out/` (the electron-vite output directory). */
export function measureBuild(out = path.resolve('out')): Record<string, number> {
  return { ...mainMetrics(out), ...rendererMetrics(out) }
}
