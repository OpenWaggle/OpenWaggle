import fs from 'node:fs/promises'
import path from 'node:path'

const DIST_DIR = 'dist'
const APP_NAME = 'OpenWaggle.app'
const RESOURCES_PATH = ['Contents', 'Resources'] as const
const ASAR_FILE = 'app.asar'
const DOCS_DIR = 'openwaggle-docs'
const SESSION_EMBEDDING_MODEL_DIR = 'session-embedding-model'
const PACKAGE_JSON = 'package.json'
const NODE_MODULES_DIR = 'node_modules'
const OUT_DIR = 'out'
const ASAR_HEADER_PREFIX_BYTES = 16
const ASAR_JSON_SIZE_OFFSET = 12
const FIRST_USER_ARGUMENT_INDEX = 2
const PREVIEW_LIMIT = 20
const ALLOWED_OUT_ROOTS = ['/out/main', '/out/preload', '/out/renderer'] as const

const REQUIRED_ASAR_ROOTS = [NODE_MODULES_DIR, OUT_DIR, PACKAGE_JSON]
const REQUIRED_DOCS_FILES = ['README.md', 'index.json']
const REQUIRED_SESSION_EMBEDDING_MODEL_FILES = [
  'Xenova/multilingual-e5-small/config.json',
  'Xenova/multilingual-e5-small/tokenizer_config.json',
  'Xenova/multilingual-e5-small/tokenizer.json',
  'Xenova/multilingual-e5-small/onnx/model_quantized.onnx',
  'Xenova/multilingual-e5-small/openwaggle-model-manifest.json',
  'Xenova/multilingual-e5-small/THIRD_PARTY_NOTICE.md',
]
const ALLOWED_ASAR_ROOTS = new Set(REQUIRED_ASAR_ROOTS)

interface AsarNode {
  readonly files?: { readonly [name: string]: AsarNode }
}

function isObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAsarNode(value: unknown): AsarNode | null {
  if (!isObject(value)) return null

  const files = value.files
  if (files === undefined) return {}
  if (!isObject(files)) return null

  const parsedFiles: { [name: string]: AsarNode } = {}
  for (const [name, child] of Object.entries(files)) {
    const parsedChild = parseAsarNode(child)
    if (parsedChild === null) return null
    parsedFiles[name] = parsedChild
  }

  return { files: parsedFiles }
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function findPackagedApp() {
  const explicitAppPath = process.argv[FIRST_USER_ARGUMENT_INDEX]
  if (explicitAppPath) return explicitAppPath

  const distEntries = await fs.readdir(DIST_DIR, { withFileTypes: true })
  const appPaths: string[] = []

  for (const entry of distEntries) {
    if (!entry.isDirectory()) continue

    const appPath = path.join(DIST_DIR, entry.name, APP_NAME)
    if (await pathExists(appPath)) {
      appPaths.push(appPath)
    }

    const unpackedResourcesPath = path.join(DIST_DIR, entry.name, 'resources', ASAR_FILE)
    if (await pathExists(unpackedResourcesPath)) {
      appPaths.push(path.join(DIST_DIR, entry.name))
    }
  }

  if (appPaths.length === 1) return appPaths[0]

  throw new Error(
    `Expected exactly one packaged ${APP_NAME} under ${DIST_DIR}, found ${appPaths.length}.`,
  )
}

async function packagedAppResourcesPath(appPath: string) {
  const macResourcesPath = path.join(appPath, ...RESOURCES_PATH)
  if (await pathExists(macResourcesPath)) return macResourcesPath

  const directResourcesPath = path.join(appPath, 'resources')
  if (await pathExists(directResourcesPath)) return directResourcesPath

  throw new Error(`Cannot find packaged resources directory for ${appPath}.`)
}

async function readAsarHeader(asarPath: string) {
  const file = await fs.open(asarPath, 'r')

  try {
    const prefix = Buffer.alloc(ASAR_HEADER_PREFIX_BYTES)
    await file.read(prefix, 0, ASAR_HEADER_PREFIX_BYTES, 0)

    const jsonSize = prefix.readUInt32LE(ASAR_JSON_SIZE_OFFSET)
    const headerBuffer = Buffer.alloc(jsonSize)
    await file.read(headerBuffer, 0, jsonSize, ASAR_HEADER_PREFIX_BYTES)

    const parsed: unknown = JSON.parse(headerBuffer.toString('utf8'))
    const header = parseAsarNode(parsed)
    if (header === null) {
      throw new Error(`${asarPath} has an invalid asar header shape.`)
    }

    return header
  } finally {
    await file.close()
  }
}

function collectAsarEntries(header: AsarNode) {
  const entries: string[] = []

  function walk(node: AsarNode, currentPath: string) {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const nextPath = `${currentPath}/${name}`
      entries.push(nextPath)
      walk(child, nextPath)
    }
  }

  walk(header, '')
  return entries
}

function isWorkspacePackageSourceOrConfig(entry: string) {
  if (!entry.startsWith('/node_modules/@openwaggle/')) return false
  if (entry.includes('/src/')) return true

  const basename = path.posix.basename(entry)
  return basename.startsWith('tsconfig') && basename.endsWith('.json')
}

function isUnexpectedOutEntry(entry: string) {
  if (!entry.startsWith(`/${OUT_DIR}/`)) return false
  return !ALLOWED_OUT_ROOTS.some((root) => entry === root || entry.startsWith(`${root}/`))
}

function assertAsarRoots(header: AsarNode) {
  const rootNames = Object.keys(header.files ?? {}).sort((left, right) => left.localeCompare(right))
  const missingRoots = REQUIRED_ASAR_ROOTS.filter((root) => !rootNames.includes(root))
  const unexpectedRoots = rootNames.filter((root) => !ALLOWED_ASAR_ROOTS.has(root))

  if (missingRoots.length > 0 || unexpectedRoots.length > 0) {
    const issues = [
      ...missingRoots.map((root) => `missing ${root}`),
      ...unexpectedRoots.map((root) => `unexpected ${root}`),
    ]
    throw new Error(`Packaged app asar roots are invalid: ${issues.join('; ')}.`)
  }
}

function assertAsarEntries(header: AsarNode) {
  const forbiddenEntries = collectAsarEntries(header).filter(
    (entry) =>
      isWorkspacePackageSourceOrConfig(entry) ||
      isUnexpectedOutEntry(entry) ||
      entry.includes('/node_modules/pi-mcp-adapter/'),
  )

  if (forbiddenEntries.length > 0) {
    const preview = forbiddenEntries.slice(0, PREVIEW_LIMIT).join(', ')
    throw new Error(
      `Packaged app asar contains non-runtime source, config, output, or legacy MCP adapter files: ${preview}.`,
    )
  }
}

async function assertRequiredFiles(rootPath: string, relativeFiles: readonly string[]) {
  const missingFiles: string[] = []

  for (const relativeFile of relativeFiles) {
    const absolutePath = path.join(rootPath, relativeFile)
    if (!(await pathExists(absolutePath))) {
      missingFiles.push(relativeFile)
    }
  }

  if (missingFiles.length > 0) {
    throw new Error(`${rootPath} is missing required files: ${missingFiles.join(', ')}.`)
  }
}

async function main() {
  const appPath = await findPackagedApp()
  const resourcesPath = await packagedAppResourcesPath(appPath)
  const asarPath = path.join(resourcesPath, ASAR_FILE)
  const asarHeader = await readAsarHeader(asarPath)

  assertAsarRoots(asarHeader)
  assertAsarEntries(asarHeader)
  await assertRequiredFiles(path.join(resourcesPath, DOCS_DIR), REQUIRED_DOCS_FILES)
  await assertRequiredFiles(
    path.join(resourcesPath, SESSION_EMBEDDING_MODEL_DIR),
    REQUIRED_SESSION_EMBEDDING_MODEL_FILES,
  )

  console.log(`packaged app smoke passed: ${appPath}`)
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
