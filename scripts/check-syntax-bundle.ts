import fs from 'node:fs/promises'
import path from 'node:path'

const KIBIBYTE = 1024
const ASSETS_DIRECTORY = path.resolve('out/renderer/assets')
const MAX_INITIAL_RENDERER_BYTES = 1024 * KIBIBYTE
const MAX_INITIAL_RENDERER_GRAPH_BYTES = 4_500 * KIBIBYTE
const MAX_SYNTAX_WORKER_BYTES = 768 * KIBIBYTE
const MAX_FOCUSED_EDITOR_BYTES = 512 * KIBIBYTE
const MAX_FOCUSED_EDITOR_WORKER_BYTES = 768 * KIBIBYTE
const FORBIDDEN_INITIAL_ASSET_PATTERN =
  /(?:ChatDiffPane|DiffBlock|FocusedSourceEditor|pierre-syntax-runtime|syntax\.worker|worker-)/u

interface AssetBudget {
  readonly label: string
  readonly pattern: RegExp
  readonly maximumBytes: number
}

const ASSET_BUDGETS: readonly AssetBudget[] = [
  {
    label: 'syntax worker',
    pattern: /^syntax\.worker-[^.]+\.js$/u,
    maximumBytes: MAX_SYNTAX_WORKER_BYTES,
  },
  {
    label: 'focused editor',
    pattern: /^FocusedSourceEditor-[^.]+\.js$/u,
    maximumBytes: MAX_FOCUSED_EDITOR_BYTES,
  },
  {
    label: 'focused editor worker',
    pattern: /^worker-[^.]+\.js$/u,
    maximumBytes: MAX_FOCUSED_EDITOR_WORKER_BYTES,
  },
]

async function matchingAsset(budget: AssetBudget, assets: readonly string[]) {
  const matches = assets.filter((asset) => budget.pattern.test(asset))
  if (matches.length !== 1) {
    throw new Error(`Expected one ${budget.label} asset, found ${String(matches.length)}.`)
  }
  const asset = matches[0]
  if (!asset) throw new Error(`Missing ${budget.label} asset.`)
  const stats = await fs.stat(path.join(ASSETS_DIRECTORY, asset))
  if (stats.size > budget.maximumBytes) {
    throw new Error(
      `${budget.label} is ${String(stats.size)} bytes; budget is ${String(budget.maximumBytes)} bytes.`,
    )
  }
  return { asset, bytes: stats.size }
}

async function initialRendererAssets() {
  const html = await fs.readFile(path.resolve('out/renderer/index.html'), 'utf8')
  const entry = html.match(/<script[^>]+src="\.\/assets\/(?<asset>[^"]+\.js)"/u)?.groups
    ?.asset
  if (!entry) throw new Error('Could not resolve the initial renderer asset from index.html.')
  const preloadPattern = /<link[^>]+rel="modulepreload"[^>]+href="\.\/assets\/(?<asset>[^"]+\.js)"/gu
  const assets = [
    entry,
    ...[...html.matchAll(preloadPattern)].flatMap((match) =>
      match.groups?.asset ? [match.groups.asset] : [],
    ),
  ]
  const uniqueAssets = [...new Set(assets)]
  const forbiddenInitialAssets = uniqueAssets.filter((asset) =>
    FORBIDDEN_INITIAL_ASSET_PATTERN.test(asset),
  )
  if (forbiddenInitialAssets.length > 0) {
    throw new Error(
      `Deferred code-rendering assets entered the initial graph: ${forbiddenInitialAssets.join(', ')}`,
    )
  }
  const measurements = await Promise.all(
    uniqueAssets.map(async (asset) => ({
      asset,
      bytes: (await fs.stat(path.join(ASSETS_DIRECTORY, asset))).size,
    })),
  )
  const entryBytes = measurements.find(({ asset }) => asset === entry)?.bytes
  if (entryBytes === undefined) throw new Error('Could not measure the initial renderer entry.')
  if (entryBytes > MAX_INITIAL_RENDERER_BYTES) {
    throw new Error(
      `initial renderer is ${String(entryBytes)} bytes; budget is ${String(MAX_INITIAL_RENDERER_BYTES)} bytes.`,
    )
  }
  const totalBytes = measurements.reduce((total, measurement) => total + measurement.bytes, 0)
  if (totalBytes > MAX_INITIAL_RENDERER_GRAPH_BYTES) {
    throw new Error(
      `initial renderer graph is ${String(totalBytes)} bytes; budget is ${String(MAX_INITIAL_RENDERER_GRAPH_BYTES)} bytes.`,
    )
  }
  return [
    ...measurements,
    { asset: 'initial-renderer-graph-total', bytes: totalBytes },
  ]
}

async function main() {
  const assets = await fs.readdir(ASSETS_DIRECTORY)
  const legacyAssets = assets.filter((asset) => /monaco|ts\.worker/iu.test(asset))
  if (legacyAssets.length > 0) {
    throw new Error(`Legacy editor assets found: ${legacyAssets.join(', ')}`)
  }
  const measurements = [
    ...(await initialRendererAssets()),
    ...(await Promise.all(ASSET_BUDGETS.map((budget) => matchingAsset(budget, assets)))),
  ]
  process.stdout.write(
    `${measurements.map(({ asset, bytes }) => `${asset}: ${String(bytes)} bytes`).join('\n')}\n`,
  )
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
