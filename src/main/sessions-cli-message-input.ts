import { readFile } from 'node:fs/promises'
import { decodeLocalSessionCommandPayload } from '@shared/schemas/local-session-protocol'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
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

function payloadOperation(payload: LocalSessionCommandPayload) {
  if (payload.contract === 'local-ui-v1' || payload.contract === 'local-attachments-v1') {
    throw new Error('GUI-only Session contracts cannot be loaded with --request-json.')
  }
  return payload.contract === 'session-query-v2'
    ? payload.request.query.operation
    : payload.request.command.operation
}

function assertRequestMatchesCommand(command: string, payload: LocalSessionCommandPayload) {
  if (payloadOperation(payload) !== command) {
    throw new Error(`--request-json operation must be ${command}.`)
  }
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
  assertRequestMatchesCommand(input.command, payload)
  return payload
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
