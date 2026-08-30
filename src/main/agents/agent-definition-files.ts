import { randomUUID } from 'node:crypto'
import fs, { type FileHandle } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AgentDefinitionDocument, AgentDefinitionScope } from '@shared/types/agent-definition'
import { assertFilesystemWriteScope } from '../utils/filesystem-write-scope'
import { ensureDirectoryPathPinned } from '../utils/pinned-directory-creation'
import { mutateDefinitionInBoundDirectory } from './agent-definition-bound-mutation'
import { parseAgentDefinition } from './agent-definition-parser'
import { agentDefinitionPath } from './agent-definition-paths'
import {
  agentDefinitionDocumentDigest,
  serializeAgentDefinition,
} from './agent-definition-serializer'
import { MAX_AGENT_DEFINITION_SOURCE_BYTES } from './agent-definition-source-reader'
import { ensureTrustedAgentDefinitionRoot } from './agent-definition-trusted-root'

const OWNER_FILE_MODE = 0o600
const OWNER_DIRECTORY_MODE = 0o700
const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_DIRECTORY_NO_FOLLOW =
  filesystemConstants.O_RDONLY |
  (filesystemConstants.O_DIRECTORY ?? 0) |
  (filesystemConstants.O_NOFOLLOW ?? 0)

async function confinedDefinitionDestination(input: {
  readonly projectPath: string
  readonly userHome?: string
  readonly scope: AgentDefinitionScope
  readonly name: string
  readonly beforeDirectoryMutation?: (component: string, index: number) => Promise<void>
}) {
  const root = input.scope === 'user' ? (input.userHome ?? os.homedir()) : input.projectPath
  if (input.scope === 'user') await ensureTrustedAgentDefinitionRoot(root)
  const lexicalDestination = agentDefinitionPath(input)
  const initial = await assertFilesystemWriteScope({
    roots: [root],
    destinationPath: lexicalDestination,
  })
  await ensureDirectoryPathPinned({
    targetDirectory: path.dirname(initial.destinationPath),
    mode: OWNER_DIRECTORY_MODE,
    ...(input.beforeDirectoryMutation
      ? { beforeComponentMutation: input.beforeDirectoryMutation }
      : {}),
  })
  const verified = await assertFilesystemWriteScope({
    roots: [initial.rootPath],
    destinationPath: initial.destinationPath,
  })
  if (
    path.resolve(verified.rootPath) !== path.resolve(initial.rootPath) ||
    path.resolve(verified.destinationPath) !== path.resolve(initial.destinationPath)
  ) {
    throw new Error('Agent definition destination changed outside its selected scope.')
  }
  const directory = path.dirname(verified.destinationPath)
  const directoryHandle = await fs.open(directory, OPEN_DIRECTORY_NO_FOLLOW)
  try {
    const [bound, current] = await Promise.all([directoryHandle.stat(), fs.stat(directory)])
    if (bound.dev !== current.dev || bound.ino !== current.ino) {
      throw new Error('Agent definition directory changed while it was being bound.')
    }
    return {
      rootPath: initial.rootPath,
      destinationPath: verified.destinationPath,
      directoryIdentity: `${bound.dev}:${bound.ino}`,
    }
  } finally {
    await directoryHandle.close()
  }
}

async function currentFile(destinationPath: string) {
  let handle: FileHandle | undefined
  try {
    handle = await fs.open(
      destinationPath,
      filesystemConstants.O_RDONLY | (filesystemConstants.O_NOFOLLOW ?? 0),
    )
    const stats = await handle.stat()
    if (!stats.isFile()) {
      throw new Error('Agent definition destination is not a regular file.')
    }
    if (stats.size > MAX_AGENT_DEFINITION_SOURCE_BYTES) {
      throw new Error('Agent definition destination exceeds the 1 MiB size limit.')
    }
    const markdown = await handle.readFile('utf8')
    return {
      markdown,
      digest: agentDefinitionDocumentDigest(markdown),
      identity: `${stats.dev}:${stats.ino}`,
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export async function writeAgentDefinitionFile(input: {
  readonly projectPath: string
  readonly userHome?: string
  readonly scope: AgentDefinitionScope
  readonly document: AgentDefinitionDocument
  readonly replaceExisting: boolean
  readonly expectedContentDigest?: string
  readonly beforeMutation?: () => Promise<void>
  readonly beforeMutationSpawn?: () => Promise<void>
  readonly beforeDirectoryMutation?: (component: string, index: number) => Promise<void>
}) {
  const markdown = serializeAgentDefinition(input.document)
  const parsed = parseAgentDefinition(markdown)
  const { rootPath, destinationPath, directoryIdentity } = await confinedDefinitionDestination({
    ...input,
    name: parsed.name,
  })
  const directory = path.dirname(destinationPath)
  return (async () => {
    const current = await currentFile(destinationPath)
    if (current && !input.replaceExisting) {
      throw new Error(`Agent definition ${JSON.stringify(parsed.name)} already exists.`)
    }
    if (input.expectedContentDigest && current?.digest !== input.expectedContentDigest) {
      throw new Error('Agent definition changed since it was loaded.')
    }
    const workingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-definition-'))
    await fs.chmod(workingRoot, OWNER_DIRECTORY_MODE)
    const sourcePath = path.join(workingRoot, 'definition.pending')
    let sourceHandle: FileHandle | undefined
    try {
      await fs.writeFile(sourcePath, markdown, {
        encoding: 'utf8',
        flag: 'wx',
        mode: OWNER_FILE_MODE,
      })
      sourceHandle = await fs.open(
        sourcePath,
        filesystemConstants.O_RDONLY | (filesystemConstants.O_NOFOLLOW ?? 0),
      )
      await mutateDefinitionInBoundDirectory({
        rootPath,
        directory,
        destinationPath,
        pendingName: `.${parsed.name}.${randomUUID()}.pending`,
        mode: current ? 'replace' : 'create',
        ...(current ? { expectedIdentity: current.identity } : {}),
        ...(current ? { expectedContentDigest: current.digest } : {}),
        expectedDirectoryIdentity: directoryIdentity,
        sourceHandle,
        sourceDigest: agentDefinitionDocumentDigest(markdown),
        ...(input.beforeMutation ? { beforeMutation: input.beforeMutation } : {}),
        ...(input.beforeMutationSpawn ? { beforeSpawn: input.beforeMutationSpawn } : {}),
      })
    } finally {
      await sourceHandle?.close().catch(() => undefined)
      await fs.rm(workingRoot, { recursive: true, force: true })
    }
    return {
      name: parsed.name,
      scope: input.scope,
      destinationPath,
      contentDigest: agentDefinitionDocumentDigest(markdown),
    }
  })()
}

export async function deleteAgentDefinitionFile(input: {
  readonly projectPath: string
  readonly userHome?: string
  readonly scope: AgentDefinitionScope
  readonly name: string
  readonly expectedContentDigest?: string
  readonly beforeMutation?: () => Promise<void>
  readonly beforeMutationSpawn?: () => Promise<void>
}) {
  const { rootPath, destinationPath, directoryIdentity } =
    await confinedDefinitionDestination(input)
  return (async () => {
    const current = await currentFile(destinationPath)
    if (!current) throw new Error(`Agent definition ${JSON.stringify(input.name)} was not found.`)
    if (input.expectedContentDigest && current.digest !== input.expectedContentDigest) {
      throw new Error('Agent definition changed since it was loaded.')
    }
    await mutateDefinitionInBoundDirectory({
      rootPath,
      directory: path.dirname(destinationPath),
      destinationPath,
      pendingName: '.unused',
      mode: 'delete',
      expectedIdentity: current.identity,
      expectedContentDigest: current.digest,
      expectedDirectoryIdentity: directoryIdentity,
      ...(input.beforeMutation ? { beforeMutation: input.beforeMutation } : {}),
      ...(input.beforeMutationSpawn ? { beforeSpawn: input.beforeMutationSpawn } : {}),
    })
    return { name: input.name, scope: input.scope, destinationPath }
  })()
}
