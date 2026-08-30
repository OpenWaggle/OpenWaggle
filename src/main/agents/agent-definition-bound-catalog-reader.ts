import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getSafeChildEnv } from '../env'

const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_DIRECTORY_NO_FOLLOW =
  filesystemConstants.O_RDONLY |
  (filesystemConstants.O_DIRECTORY ?? 0) |
  (filesystemConstants.O_NOFOLLOW ?? 0)
const MAX_DEFINITION_FILES = 1_000
const MAX_DEFINITION_BYTES = 64 * 1024
const MAX_CATALOG_OUTPUT_BYTES = 96 * 1024 * 1024

const BOUND_CATALOG_READER = `
const fs = require('node:fs')
const path = require('node:path')
const expectedIdentity = process.argv[1]
const directory = fs.statSync('.')
if (directory.dev + ':' + directory.ino !== expectedIdentity) process.exit(73)
const canonicalDirectory = fs.realpathSync('.')
const entries = fs.readdirSync('.', { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
  .sort((left, right) => left.name.localeCompare(right.name))
if (entries.length > ${String(MAX_DEFINITION_FILES)}) process.exit(74)
const files = entries.map((entry) => {
  const lexical = path.resolve(entry.name)
  const visible = fs.lstatSync(lexical)
  if (visible.isSymbolicLink() || !visible.isFile()) process.exit(75)
  const handle = fs.openSync(entry.name, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    const stats = fs.fstatSync(handle)
    const current = fs.statSync(lexical)
    const canonical = fs.realpathSync(lexical)
    const relative = path.relative(canonicalDirectory, canonical)
    if (
      !stats.isFile() ||
      stats.size > ${String(MAX_DEFINITION_BYTES)} ||
      stats.dev !== visible.dev ||
      stats.ino !== visible.ino ||
      stats.dev !== current.dev ||
      stats.ino !== current.ino ||
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      path.dirname(canonical) !== canonicalDirectory
    ) process.exit(75)
    return { name: entry.name, markdown: fs.readFileSync(handle, 'utf8') }
  } finally {
    fs.closeSync(handle)
  }
})
process.stdout.write(JSON.stringify(files))
`

export interface BoundAgentDefinitionSource {
  readonly name: string
  readonly markdown: string
}

export function agentDefinitionCatalogChildEnvironment() {
  return { ...getSafeChildEnv(), ELECTRON_RUN_AS_NODE: '1' }
}

function filesystemCode(error: unknown) {
  return error instanceof Error && 'code' in error ? error.code : undefined
}

async function bindWindowsCatalogDirectory(current: string, canonicalRoot: string) {
  const [bound, visible, canonicalDirectory] = await Promise.all([
    fs.lstat(current),
    fs.stat(current),
    fs.realpath(current),
  ])
  const confined = path.relative(canonicalRoot, canonicalDirectory)
  if (
    bound.isSymbolicLink() ||
    !bound.isDirectory() ||
    bound.dev !== visible.dev ||
    bound.ino !== visible.ino ||
    confined.startsWith('..') ||
    path.isAbsolute(confined)
  ) {
    throw new Error('Agent definition catalog directory changed outside its selected scope.')
  }
  return { path: current, identity: `${bound.dev}:${bound.ino}` }
}

async function bindDescriptorCatalogDirectory(current: string, canonicalRoot: string) {
  const handle = await fs.open(current, OPEN_DIRECTORY_NO_FOLLOW)
  try {
    const [bound, visible, canonicalDirectory] = await Promise.all([
      handle.stat(),
      fs.stat(current),
      fs.realpath(current),
    ])
    const confined = path.relative(canonicalRoot, canonicalDirectory)
    if (
      bound.dev !== visible.dev ||
      bound.ino !== visible.ino ||
      confined.startsWith('..') ||
      path.isAbsolute(confined)
    ) {
      throw new Error('Agent definition catalog directory changed outside its selected scope.')
    }
    return { path: current, identity: `${bound.dev}:${bound.ino}` }
  } finally {
    await handle.close()
  }
}

async function confinedDirectory(input: {
  readonly root: string
  readonly directory: string
  readonly platform: NodeJS.Platform
}) {
  let canonicalRoot: string
  try {
    canonicalRoot = await fs.realpath(input.root)
  } catch (error) {
    if (filesystemCode(error) === 'ENOENT') return undefined
    throw error
  }
  const relative = path.relative(path.resolve(input.root), path.resolve(input.directory))
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Agent definition catalog directory is outside its selected scope.')
  }
  let current = canonicalRoot
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component)
    let stats: Awaited<ReturnType<typeof fs.lstat>>
    try {
      stats = await fs.lstat(current)
    } catch (error) {
      if (filesystemCode(error) === 'ENOENT') return undefined
      throw error
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('Agent definition catalog directories must not be symbolic links.')
    }
  }
  return input.platform === 'win32'
    ? bindWindowsCatalogDirectory(current, canonicalRoot)
    : bindDescriptorCatalogDirectory(current, canonicalRoot)
}

async function readChildOutput(child: ReturnType<typeof spawn>) {
  const chunks: Buffer[] = []
  let bytes = 0
  child.stdout?.on('data', (chunk: Buffer) => {
    bytes += chunk.byteLength
    if (bytes > MAX_CATALOG_OUTPUT_BYTES) child.kill()
    else chunks.push(chunk)
  })
  let diagnostic = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    if (diagnostic.length < MAX_DEFINITION_BYTES) diagnostic += chunk
  })
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  if (exitCode !== 0 || bytes > MAX_CATALOG_OUTPUT_BYTES) {
    throw new Error(
      `Descriptor-bound Agent definition catalog read failed (${String(exitCode)}): ${diagnostic.trim()}`,
    )
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!Array.isArray(value))
    throw new Error('Agent definition catalog reader returned invalid data.')
  return value.map((entry: unknown) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('name' in entry) ||
      typeof entry.name !== 'string' ||
      !('markdown' in entry) ||
      typeof entry.markdown !== 'string'
    ) {
      throw new Error('Agent definition catalog reader returned an invalid entry.')
    }
    return { name: entry.name, markdown: entry.markdown } satisfies BoundAgentDefinitionSource
  })
}

export async function readBoundAgentDefinitionSources(input: {
  readonly root: string
  readonly directory: string
  readonly beforeRead?: () => Promise<void>
  readonly platform?: NodeJS.Platform
}) {
  const platform = input.platform ?? process.platform
  const bound = await confinedDirectory({ ...input, platform })
  if (!bound) return []
  await input.beforeRead?.()
  return readChildOutput(
    spawn(process.execPath, ['-e', BOUND_CATALOG_READER, bound.identity], {
      cwd: bound.path,
      env: agentDefinitionCatalogChildEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
}
