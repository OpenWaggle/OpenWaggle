import { app } from 'electron'
import { env } from './env'
import { hasFlag, option, type ParsedArguments, readSecretFromStdin } from './mcp-cli-arguments'
import type { executeLocalSessionCommand } from './session-host/local-session-client'
import { ensureLocalSessionHost } from './session-host/local-session-host-launcher'
import {
  prepareLocalSessionHostPaths,
  refreshLocalSessionHostEndpoint,
  resolveLocalSessionHostPaths,
} from './session-host/local-session-paths'
import {
  readProfileCredentialFile,
  readStoredProfileCredential,
} from './session-host/profile-credential-destination'

export type LocalSessionCliClientInput = Omit<
  Parameters<typeof executeLocalSessionCommand>[0],
  'payload'
>

function hasProfileCredentialSource(arguments_: ParsedArguments) {
  return (
    arguments_.options.has('credential-stdin') ||
    arguments_.options.has('profile-credential-file') ||
    Boolean(env.OPENWAGGLE_PROFILE_CREDENTIAL_FILE)
  )
}

export async function createLocalSessionCliClientInput(
  arguments_: ParsedArguments,
  options: { readonly supportedRevisions?: readonly number[] } = {},
): Promise<LocalSessionCliClientInput> {
  const profile = option(arguments_, 'profile') ?? env.OPENWAGGLE_PROFILE
  const credentialFile =
    option(arguments_, 'profile-credential-file') ?? env.OPENWAGGLE_PROFILE_CREDENTIAL_FILE
  if (!profile && hasProfileCredentialSource(arguments_)) {
    throw new Error('Profile credentials require --profile or OPENWAGGLE_PROFILE.')
  }
  if (env.OPENWAGGLE_AGENT_RUN === '1' && !profile) {
    throw new Error(
      'OpenWaggle agents must use their native Sessions tool or an explicit named CLI profile.',
    )
  }
  const paths = await prepareLocalSessionHostPaths(
    resolveLocalSessionHostPaths({ userDataRoot: app.getPath('userData') }),
  )
  const profileCredential = profile
    ? hasFlag(arguments_, 'credential-stdin')
      ? await readSecretFromStdin()
      : credentialFile
        ? await readProfileCredentialFile(credentialFile)
        : await readStoredProfileCredential({ stateRoot: paths.stateRoot, profileName: profile })
    : undefined
  const input = {
    paths,
    clientKind: 'cli' as const,
    clientVersion: app.getVersion(),
    workingDirectory: process.cwd(),
    ...(options.supportedRevisions ? { supportedRevisions: options.supportedRevisions } : {}),
    ...(profile ? { profile } : {}),
    ...(profileCredential ? { profileCredential } : {}),
  }
  await ensureLocalSessionHost(input)
  return { ...input, paths: await refreshLocalSessionHostEndpoint(paths) }
}
