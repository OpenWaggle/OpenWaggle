import path from 'node:path'
import {
  type AgentDefinitionSemanticCatalogLoader,
  executeAgentDefinitionManagement,
} from './agents/agent-definition-management'
import { parseAgentDefinition } from './agents/agent-definition-parser'
import {
  MAX_AGENT_DEFINITION_SOURCE_BYTES,
  readBoundedAgentDefinitionSource,
} from './agents/agent-definition-source-reader'
import { managementContext, parseAgentDefinitionScope, required } from './agents-cli-options'
import { option, type ParsedArguments } from './mcp-cli-arguments'

const SOURCE_SIZE_ERROR = 'Agent definition source exceeds the 1 MiB size limit.'

export function readBoundedAgentsCliStdin() {
  process.stdin.setEncoding('utf8')
  return new Promise<string>((resolve, reject) => {
    let content = ''
    const cleanup = () => {
      process.stdin.removeListener('data', onData)
      process.stdin.removeListener('end', onEnd)
      process.stdin.removeListener('error', onError)
    }
    const onData = (chunk: string) => {
      content += chunk
      if (Buffer.byteLength(content, 'utf8') <= MAX_AGENT_DEFINITION_SOURCE_BYTES) return
      cleanup()
      process.stdin.pause()
      reject(new Error(SOURCE_SIZE_ERROR))
    }
    const onEnd = () => {
      cleanup()
      resolve(content)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    process.stdin.on('data', onData)
    process.stdin.once('end', onEnd)
    process.stdin.once('error', onError)
  })
}

export async function readAgentsCliDocumentSource(input: {
  readonly argument: string | undefined
  readonly label: string
  readonly cwd: string
  readonly readStdin: () => Promise<string>
}) {
  const argument = required(input.argument, input.label)
  if (argument !== '-') {
    return readBoundedAgentDefinitionSource({ sourcePath: path.resolve(input.cwd, argument) })
  }
  const content = await input.readStdin()
  if (Buffer.byteLength(content, 'utf8') > MAX_AGENT_DEFINITION_SOURCE_BYTES) {
    throw new Error(SOURCE_SIZE_ERROR)
  }
  return { sourcePath: '<stdin>', content }
}

export async function writeAgentsCliDocument(input: {
  readonly command: 'create' | 'update'
  readonly arguments_: ParsedArguments
  readonly cwd: string
  readonly home: string
  readonly projectPath: string
  readonly readStdin: () => Promise<string>
  readonly loadSemanticCatalog: AgentDefinitionSemanticCatalogLoader
}) {
  const source = await readAgentsCliDocumentSource({
    argument: input.arguments_.positionals[0],
    label: 'Agent definition file',
    cwd: input.cwd,
    readStdin: input.readStdin,
  })
  const document = parseAgentDefinition(source.content)
  return executeAgentDefinitionManagement(
    {
      operation: 'write',
      projectPath: input.projectPath,
      scope: parseAgentDefinitionScope(option(input.arguments_, 'scope')),
      document,
      replaceExisting: input.command === 'update',
      ...(option(input.arguments_, 'expected-digest')
        ? { expectedContentDigest: option(input.arguments_, 'expected-digest') }
        : {}),
    },
    managementContext(input),
  )
}
