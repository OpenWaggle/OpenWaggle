import { randomUUID } from 'node:crypto'
import { decodeLocalSessionProfileManagementResponse } from '@shared/schemas/local-session-profile-management'
import {
  LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
  type LocalSessionProfileManagementCommand,
} from '@shared/types/local-session-profile-management'
import { app } from 'electron'
import { validateAccessCliOptions } from './access-cli-option-contract'
import { parseProfilePolicy } from './access-cli-policy'
import { isCommandCliUsageError, validateImplicitCliHelp } from './command-cli-option-contract'
import { createLocalSessionCliClientInput } from './local-session-cli-client'
import { hasFlag, option, parseMcpCliArguments } from './mcp-cli-arguments'
import { executeLocalSessionCommand } from './session-host/local-session-client'
import { resolveLocalSessionHostPaths } from './session-host/local-session-paths'
import { generateProfileCredential } from './session-host/profile-credential'
import {
  type ProfileCredentialDestination,
  removeStoredProfileCredential,
  stageProfileCredential,
} from './session-host/profile-credential-destination'

const EXIT = { SUCCESS: 0, FAILURE: 1, USAGE: 2 } as const
const JSON_INDENT_SPACES = 2
const PROFILE_ARGUMENT_OFFSET = 2

export function accessCliUsage() {
  return `OpenWaggle agent access

Usage:
  openwaggle access profiles list [--json]
  openwaggle access profiles create <name> --capability <capability>... [scope]
    (--credential-store|--credential-file <path>) [--replace]
  openwaggle access profiles update <name> --capability <capability>... [scope]
  openwaggle access profiles rotate <name> (--credential-store|--credential-file <path>) [--replace]
  openwaggle access profiles revoke <name>

Scope: --all | --project <path>... | --session <id>... | --hive <root-id>...
Export files: --export-root <path>... (explicit read/write roots; never implied by Session scope)
Attachments: --attachment-root <path>... (explicit file-read roots)
Policy: --authorization ask-for-approval|yolo [--management-envelope-json <json>]
Caller: --profile <name> [--credential-stdin|--profile-credential-file <path>]
Common: --idempotency-key <key> --json
Unknown, missing-value, command-inapplicable, unexpected positional, and -- passthrough input
fail before credentials or profiles change.`
}

function required(value: string | undefined, label: string) {
  if (!value) throw new Error(`${label} is required.`)
  return value
}

function destination(
  arguments_: ReturnType<typeof parseMcpCliArguments>,
  stateRoot: string,
): ProfileCredentialDestination {
  const store = hasFlag(arguments_, 'credential-store')
  const file = option(arguments_, 'credential-file')
  if (store === Boolean(file)) {
    throw new Error('Choose exactly one --credential-store or --credential-file <path>.')
  }
  return store
    ? { kind: 'credential-store', stateRoot }
    : { kind: 'file', path: required(file, '--credential-file') }
}

function request(command: LocalSessionProfileManagementCommand, idempotencyKey: string) {
  return {
    contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
    requestId: randomUUID(),
    idempotencyKey,
    command,
  }
}

function buildCommand(
  operation: string,
  arguments_: ReturnType<typeof parseMcpCliArguments>,
  credential?: string,
): LocalSessionProfileManagementCommand {
  if (operation === 'list') return { operation }
  const profileName = required(arguments_.positionals[0], 'Profile name')
  if (operation === 'create') {
    return {
      operation,
      name: profileName,
      credential: required(credential, 'Credential'),
      ...parseProfilePolicy(arguments_),
    }
  }
  if (operation === 'update') return { operation, profileName, ...parseProfilePolicy(arguments_) }
  if (operation === 'rotate') {
    return { operation, profileName, credential: required(credential, 'Credential') }
  }
  if (operation === 'revoke') return { operation, profileName }
  throw new Error(`Unsupported profile operation: ${operation}.`)
}

function writeOutput(value: unknown, json: boolean) {
  process.stdout.write(`${JSON.stringify(value, null, json ? JSON_INDENT_SPACES : undefined)}\n`)
}

type StagedProfileCredential = Awaited<ReturnType<typeof stageProfileCredential>>

class AmbiguousProfileOperationError extends Error {
  readonly preserveStagedCredential = true
}

async function prepareProfileCredential(input: {
  readonly operation: string
  readonly arguments_: ReturnType<typeof parseMcpCliArguments>
  readonly stateRoot: string
  readonly idempotencyKey: string
}): Promise<StagedProfileCredential | undefined> {
  if (input.operation !== 'create' && input.operation !== 'rotate') return
  return stageProfileCredential({
    destination: destination(input.arguments_, input.stateRoot),
    stateRoot: input.stateRoot,
    profileName: required(input.arguments_.positionals[0], 'Profile name'),
    credential: generateProfileCredential(),
    replace: hasFlag(input.arguments_, 'replace'),
    stagingKey: input.idempotencyKey,
  })
}

async function requestProfileOperation(input: {
  readonly operation: string
  readonly arguments_: ReturnType<typeof parseMcpCliArguments>
  readonly idempotencyKey: string
  readonly staged?: StagedProfileCredential
  readonly client: Awaited<ReturnType<typeof createLocalSessionCliClientInput>>
}) {
  const result = await executeLocalSessionCommand({
    ...input.client,
    payload: {
      contract: 'local-access-v1',
      request: request(
        buildCommand(input.operation, input.arguments_, input.staged?.credential),
        input.idempotencyKey,
      ),
    },
  })
  if (typeof result !== 'object' || result === null || !('response' in result)) {
    throw new Error('Local Session Host returned an invalid profile response.')
  }
  return decodeLocalSessionProfileManagementResponse(result.response)
}

async function reconcileProfileOperation(input: {
  readonly operation: string
  readonly arguments_: ReturnType<typeof parseMcpCliArguments>
  readonly idempotencyKey: string
  readonly staged?: StagedProfileCredential
}) {
  const client = await createLocalSessionCliClientInput(input.arguments_)
  try {
    return await requestProfileOperation({ ...input, client })
  } catch (firstError) {
    if (!input.staged) throw firstError
    try {
      return await requestProfileOperation({ ...input, client })
    } catch (retryError) {
      throw new AmbiguousProfileOperationError(
        `The profile operation outcome is unknown. Its credential remains protected; retry with --idempotency-key ${input.idempotencyKey}.`,
        { cause: retryError },
      )
    }
  }
}

async function finalizeProfileResponse(input: {
  readonly response: Awaited<ReturnType<typeof requestProfileOperation>>
  readonly staged?: StagedProfileCredential
  readonly stateRoot: string
  readonly json: boolean
}) {
  if (input.response.outcome.effect === 'rejected') {
    await input.staged?.discard()
    writeOutput(input.response, input.json)
    return EXIT.FAILURE
  }
  await input.staged?.commit()
  if (input.response.outcome.effect === 'profile-revoked') {
    await removeStoredProfileCredential({
      stateRoot: input.stateRoot,
      profileName: input.response.outcome.profile.name,
    })
  }
  writeOutput(
    input.staged
      ? { ...input.response, credentialDestination: input.staged.metadata }
      : input.response,
    input.json,
  )
  return EXIT.SUCCESS
}

async function executeProfileOperation(input: {
  readonly operation: string
  readonly arguments_: ReturnType<typeof parseMcpCliArguments>
}) {
  const { operation, arguments_ } = input
  let staged: StagedProfileCredential | undefined
  let accepted = false
  try {
    validateAccessCliOptions(operation, arguments_)
    const paths = resolveLocalSessionHostPaths({ userDataRoot: app.getPath('userData') })
    const idempotencyKey = option(arguments_, 'idempotency-key') ?? randomUUID()
    staged = await prepareProfileCredential({
      operation,
      arguments_,
      stateRoot: paths.stateRoot,
      idempotencyKey,
    })
    const response = await reconcileProfileOperation({
      operation,
      arguments_,
      idempotencyKey,
      staged,
    })
    accepted = true
    return finalizeProfileResponse({
      response,
      staged,
      stateRoot: paths.stateRoot,
      json: hasFlag(arguments_, 'json'),
    })
  } catch (error) {
    if (
      !accepted &&
      !(error instanceof AmbiguousProfileOperationError && error.preserveStagedCredential)
    ) {
      await staged?.discard()
    }
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return isCommandCliUsageError(error) ||
      (error instanceof Error && error.message.includes('required'))
      ? EXIT.USAGE
      : EXIT.FAILURE
  }
}

function profileInvocation(args: readonly string[]) {
  const parsed = parseMcpCliArguments(args)
  if (parsed.positionals[0] !== 'profiles') return { kind: 'usage', parsed } as const
  const operation = parsed.positionals[1]
  if (!operation) return { kind: 'help', parsed } as const
  return {
    kind: 'execute',
    operation,
    arguments_: { ...parsed, positionals: parsed.positionals.slice(PROFILE_ARGUMENT_OFFSET) },
  } as const
}

export async function runAccessCli(args: readonly string[]) {
  const invocation = profileInvocation(args)
  if (invocation.kind === 'help') {
    try {
      validateImplicitCliHelp('OpenWaggle Access profiles', invocation.parsed)
      process.stdout.write(`${accessCliUsage()}\n`)
      return EXIT.SUCCESS
    } catch (error) {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
      return EXIT.USAGE
    }
  }
  if (invocation.kind === 'usage') {
    if (!invocation.parsed.positionals[0]) {
      try {
        validateImplicitCliHelp('OpenWaggle Access profiles', invocation.parsed)
      } catch (error) {
        process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
        return EXIT.USAGE
      }
    }
    process.stdout.write(`${accessCliUsage()}\n`)
    return invocation.parsed.positionals[0] ? EXIT.USAGE : EXIT.SUCCESS
  }
  if (invocation.operation === 'help') {
    try {
      validateAccessCliOptions(invocation.operation, invocation.arguments_)
      process.stdout.write(`${accessCliUsage()}\n`)
      return EXIT.SUCCESS
    } catch (error) {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
      return isCommandCliUsageError(error) ? EXIT.USAGE : EXIT.FAILURE
    }
  }
  return executeProfileOperation(invocation)
}
