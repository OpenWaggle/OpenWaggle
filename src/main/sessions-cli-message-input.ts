import { readFile } from 'node:fs/promises'
import { decodeLocalSessionCommandPayload } from '@shared/schemas/local-session-protocol'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { resolveCliProjectPath } from './cli-project-path'
import { hasFlag, option, type ParsedArguments } from './mcp-cli-arguments'

const MAX_CLI_INPUT_BYTES = 16 * 1024 * 1024

const MESSAGE_INPUT_COMMANDS = new Set([
  'launch',
  'spawn',
  'message',
  'start',
  'follow-up',
  'steer',
  'replace',
  'report',
])

export interface ResolvedSessionsCliInput {
  readonly arguments: ParsedArguments
  readonly payload?: LocalSessionCommandPayload
}

function readStdin(): Promise<string> {
  process.stdin.setEncoding('utf8')
  return new Promise((resolve, reject) => {
    let text = ''
    process.stdin.on('data', (chunk: string) => {
      text += chunk
      if (Buffer.byteLength(text, 'utf8') > MAX_CLI_INPUT_BYTES) {
        reject(new Error('CLI input exceeds 16 MiB.'))
        process.stdin.destroy()
      }
    })
    process.stdin.once('end', () => resolve(text))
    process.stdin.once('error', reject)
  })
}

async function readUtf8File(filePath: string) {
  const bytes = await readFile(filePath)
  if (bytes.byteLength > MAX_CLI_INPUT_BYTES) throw new Error('CLI input exceeds 16 MiB.')
  return bytes.toString('utf8')
}

function withResolvedText(arguments_: ParsedArguments, text: string): ParsedArguments {
  if (text.trim().length === 0) throw new Error('Message input must not be empty.')
  const options = new Map(arguments_.options)
  options.set('text', [text])
  return { ...arguments_, options }
}

function requestTargetBinding(payload: LocalSessionCommandPayload, workingDirectory: string) {
  if (payload.contract === 'session-lifecycle-v2') {
    const command = payload.request.command
    if (command.operation === 'launch') {
      const projectPath = resolveCliProjectPath(command.projectPath, workingDirectory)
      return {
        operation: command.operation,
        target: projectPath,
        payload: {
          ...payload,
          request: { ...payload.request, command: { ...command, projectPath } },
        } satisfies LocalSessionCommandPayload,
      }
    }
    if (command.operation === 'spawn') {
      return { operation: command.operation, target: command.parentSessionId, payload }
    }
    return undefined
  }
  if (payload.contract !== 'session-control-v2') return undefined
  const command = payload.request.command
  if (
    command.operation !== 'message' &&
    command.operation !== 'start' &&
    command.operation !== 'follow-up' &&
    command.operation !== 'steer' &&
    command.operation !== 'replace' &&
    command.operation !== 'report'
  ) {
    return undefined
  }
  return { operation: command.operation, target: command.sessionId, payload }
}

function expectedRequestContract(command: string) {
  return command === 'launch' || command === 'spawn' ? 'session-lifecycle-v2' : 'session-control-v2'
}

function assertRequestMatchesCommand(input: {
  readonly command: string
  readonly arguments: ParsedArguments
  readonly payload: LocalSessionCommandPayload
  readonly workingDirectory: string
}) {
  const { command, payload } = input
  const binding = requestTargetBinding(payload, input.workingDirectory)
  if (!binding) {
    throw new Error(
      `--request-json contract must be ${expectedRequestContract(command)} for ${command}.`,
    )
  }
  if (binding.operation !== command) {
    throw new Error(`--request-json operation must be ${command}.`)
  }
  const positionalTarget = input.arguments.positionals[0] ?? ''
  const resolvedPositionalTarget =
    command === 'launch'
      ? resolveCliProjectPath(positionalTarget, input.workingDirectory)
      : positionalTarget
  if (binding.target !== resolvedPositionalTarget) {
    throw new Error(`--request-json target must be the same as the positional ${command} target.`)
  }
  return binding.payload
}

function inputSources(arguments_: ParsedArguments) {
  return [
    option(arguments_, 'text') === undefined ? null : 'text',
    hasFlag(arguments_, 'stdin') ? 'stdin' : null,
    option(arguments_, 'input-file') === undefined ? null : 'input-file',
    option(arguments_, 'request-json') === undefined ? null : 'request-json',
  ].filter((source): source is string => source !== null)
}

async function resolveRequestPayload(input: {
  readonly command: string
  readonly arguments: ParsedArguments
  readonly consumeStdin: () => Promise<string>
  readonly consumeFile: (filePath: string) => Promise<string>
  readonly workingDirectory: string
}) {
  const requestPath = option(input.arguments, 'request-json') ?? ''
  const json =
    requestPath === '-' ? await input.consumeStdin() : await input.consumeFile(requestPath)
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (cause) {
    throw new Error('The typed request is not valid JSON.', { cause })
  }
  const payload = decodeLocalSessionCommandPayload(value)
  return assertRequestMatchesCommand({
    command: input.command,
    arguments: input.arguments,
    payload,
    workingDirectory: input.workingDirectory,
  })
}

async function resolveTextSource(input: {
  readonly source: string
  readonly arguments: ParsedArguments
  readonly consumeStdin: () => Promise<string>
  readonly consumeFile: (filePath: string) => Promise<string>
}) {
  if (input.source === 'text') return option(input.arguments, 'text') ?? ''
  if (input.source === 'stdin') return input.consumeStdin()
  return input.consumeFile(option(input.arguments, 'input-file') ?? '')
}

export async function resolveSessionsCliMessageInput(
  command: string,
  arguments_: ParsedArguments,
  dependencies: {
    readonly readStdin?: () => Promise<string>
    readonly readFile?: (filePath: string) => Promise<string>
    readonly workingDirectory?: string
  } = {},
): Promise<ResolvedSessionsCliInput> {
  const sources = inputSources(arguments_)
  if (!MESSAGE_INPUT_COMMANDS.has(command)) {
    if (sources.length > 0) throw new Error(`${command} does not accept message input.`)
    return { arguments: arguments_ }
  }
  if (sources.length !== 1) {
    throw new Error(
      'Exactly one message input is required: --text, --stdin, --input-file, or --request-json.',
    )
  }
  if (arguments_.positionals.length !== 1) {
    throw new Error(`${command} accepts one target positional; provide message content explicitly.`)
  }
  const source = sources[0]
  const consumeStdin = dependencies.readStdin ?? readStdin
  const consumeFile = dependencies.readFile ?? readUtf8File
  if (source === 'request-json') {
    const payload = await resolveRequestPayload({
      command,
      arguments: arguments_,
      consumeStdin,
      consumeFile,
      workingDirectory: dependencies.workingDirectory ?? process.cwd(),
    })
    return { arguments: arguments_, payload }
  }
  const text = await resolveTextSource({
    source: source ?? '',
    arguments: arguments_,
    consumeStdin,
    consumeFile,
  })
  return { arguments: withResolvedText(arguments_, text) }
}
