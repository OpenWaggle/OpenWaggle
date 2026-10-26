import { randomUUID } from 'node:crypto'
import { decodeLocalSessionProfileManagementResponse } from '@shared/schemas/local-session-profile-management'
import { app } from 'electron'
import { buildCommand, destination, request, required } from './access-cli-command'
import { commitAcceptedProfileCredential } from './access-cli-credential-settlement'
import { settleAccessCliFailure } from './access-cli-failure'
import { validateAccessCliOptions } from './access-cli-option-contract'
import {
  AmbiguousProfileOperationError,
  accessCliRejectedOutcomeKind,
  accessCliResponseText,
  preservedProfileCredentialError,
  writeAccessCliError,
} from './access-cli-output'
import { accessCliUsage } from './access-cli-usage'
import { asUsageErrorsSync } from './cli-error'
import { writeCliStdout } from './cli-stdout'
import { validateImplicitCliHelp } from './command-cli-option-contract'
import { createLocalSessionCliClientInput } from './local-session-cli-client'
import { hasFlag, option, parseMcpCliArguments } from './mcp-cli-arguments'
import { SESSION_CLI_EXIT, sessionCliExitCodeForError } from './session-cli-exit-status'
import { executeLocalSessionCommand } from './session-host/local-session-client'
import { resolveLocalSessionHostPaths } from './session-host/local-session-paths'
import { generateProfileCredential } from './session-host/profile-credential'
import {
  removeStoredProfileCredential,
  removeStoredProfileCredentialCopy,
  stageProfileCredential,
} from './session-host/profile-credential-destination'

const PROFILE_ARGUMENT_OFFSET = 2
/** Stands in for the credential while the command line is checked; never sent. */
const UNREAD_CREDENTIAL = 'unread'

export { accessCliUsage } from './access-cli-usage'

type StagedProfileCredential = Awaited<ReturnType<typeof stageProfileCredential>>

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
        `The profile operation outcome is unknown. Its credential remains protected at ${input.staged.recoveryLocation}; retry with --idempotency-key ${input.idempotencyKey}.`,
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
  readonly idempotencyKey: string
  readonly operation: string
  readonly includeRevoked: boolean
}) {
  const writeOutput = (response: Parameters<typeof accessCliResponseText>[0]['response']) =>
    writeCliStdout(
      accessCliResponseText({
        operation: input.operation,
        response,
        json: input.json,
        includeRevoked: input.includeRevoked,
      }),
    )
  if (input.response.outcome.effect === 'rejected') {
    if (input.staged?.recoveredPending) {
      throw preservedProfileCredentialError(
        new Error(`The profile operation was rejected (${input.response.outcome.code}).`),
        input.staged.recoveryLocation,
      )
    }
    await input.staged?.discard()
    await writeOutput(input.response)
    return sessionCliExitCodeForError(accessCliRejectedOutcomeKind(input.response.outcome))
  }
  const staged = input.staged
  await commitAcceptedProfileCredential({
    response: input.response,
    commit: staged ? () => staged.commit() : undefined,
    idempotencyKey: input.idempotencyKey,
  })
  if (input.response.outcome.effect === 'profile-revoked') {
    await removeStoredProfileCredential({
      stateRoot: input.stateRoot,
      profileName: input.response.outcome.profile.name,
    })
  }
  if (
    (input.response.outcome.effect === 'profile-rotated' ||
      input.response.outcome.effect === 'profile-created') &&
    staged?.metadata.kind === 'file'
  ) {
    // The credential now lives in that file; an older credential-store copy would stay the
    // default for --profile and only fail authentication.
    await removeStoredProfileCredentialCopy({
      stateRoot: input.stateRoot,
      profileName: input.response.outcome.profile.name,
    })
  }
  await writeOutput(
    input.staged
      ? { ...input.response, credentialDestination: input.staged.metadata }
      : input.response,
  )
  return SESSION_CLI_EXIT.SUCCESS
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
    // Read the whole command line before staging a credential or contacting the Host.
    asUsageErrorsSync(() => {
      buildCommand(operation, arguments_, UNREAD_CREDENTIAL)
      if (operation === 'create' || operation === 'rotate') destination(arguments_, paths.stateRoot)
    })
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
    return await finalizeProfileResponse({
      response,
      staged,
      stateRoot: paths.stateRoot,
      json: hasFlag(arguments_, 'json'),
      idempotencyKey,
      operation,
      includeRevoked: hasFlag(arguments_, 'include-revoked'),
    })
  } catch (error) {
    return settleAccessCliFailure({ error, accepted, staged, json: hasFlag(arguments_, 'json') })
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
      await writeCliStdout(`${accessCliUsage()}\n`)
      return SESSION_CLI_EXIT.SUCCESS
    } catch (error) {
      return sessionCliExitCodeForError(
        writeAccessCliError(error, hasFlag(invocation.parsed, 'json')),
      )
    }
  }
  if (invocation.kind === 'usage') {
    if (!invocation.parsed.positionals[0]) {
      try {
        validateImplicitCliHelp('OpenWaggle Access profiles', invocation.parsed)
      } catch (error) {
        return sessionCliExitCodeForError(
          writeAccessCliError(error, hasFlag(invocation.parsed, 'json')),
        )
      }
    }
    if (invocation.parsed.positionals[0]) {
      const error = new Error(
        `Unsupported Access command: ${invocation.parsed.positionals[0]}. Expected profiles.`,
      )
      return sessionCliExitCodeForError(
        writeAccessCliError(error, hasFlag(invocation.parsed, 'json')),
      )
    }
    await writeCliStdout(`${accessCliUsage()}\n`)
    return SESSION_CLI_EXIT.SUCCESS
  }
  if (invocation.operation === 'help') {
    try {
      validateAccessCliOptions(invocation.operation, invocation.arguments_)
      await writeCliStdout(`${accessCliUsage()}\n`)
      return SESSION_CLI_EXIT.SUCCESS
    } catch (error) {
      return sessionCliExitCodeForError(
        writeAccessCliError(error, hasFlag(invocation.arguments_, 'json')),
      )
    }
  }
  return executeProfileOperation(invocation)
}
