import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { match } from '@diegogbrisa/ts-match'
import type { SourceControlProviderId } from '@shared/types/change-request'
import {
  type ChangeRequestOpenDestinationResolution,
  DEFAULT_CHANGE_REQUEST_OPEN_DESTINATION,
  isSourceControlHostName,
  type SourceControlCli,
  type SourceControlConfigureRequest,
  type SourceControlConfigureResult,
  type SourceControlHostChoice,
  type SourceControlHostDeclarations,
  sourceControlHostKey,
} from '@shared/types/source-control'
import {
  readProjectSourceControlConfig,
  updateProjectSourceControlConfig,
} from '../../config/project-source-control-config'
import { getSourceControlCliEnv } from '../../env'
import { resolveRepositoryRoot } from '../git/repository-root'
import { readSourceControlCliHosts, type SourceControlCliHosts } from './cli-host-config'
import { projectSettingsKey } from './project-root'
import type { SourceControlSettingsAccess } from './source-control-settings-access'

const execFileAsync = promisify(execFile)
const CLI_VERSION_TIMEOUT_MS = 5_000
/** `host/owner/repository`: a host plus at least an owner and a repository segment. */
const MIN_REPOSITORY_KEY_SEGMENTS = 3

export interface SourceControlConfigurationDeps {
  readonly readCliHosts: () => Promise<SourceControlCliHosts>
  readonly isCliInstalled: (cli: SourceControlCli) => Promise<boolean>
}

async function isCliInstalled(cli: SourceControlCli) {
  try {
    await execFileAsync(cli, ['--version'], {
      env: getSourceControlCliEnv(),
      timeout: CLI_VERSION_TIMEOUT_MS,
    })
    return true
  } catch {
    return false
  }
}

/** Whether a path is the root of a Git work tree, the only place a shared file is written. */
async function isWorkTreeRoot(candidate: string) {
  if (!path.isAbsolute(candidate)) return false
  const top = await resolveRepositoryRoot(candidate)
  if (!top) return false
  try {
    const [left, right] = await Promise.all([realpath(candidate), realpath(top)])
    return left === right
  } catch {
    return false
  }
}

async function sharedFileRoot(candidate: string) {
  return (await isWorkTreeRoot(candidate)) ? candidate : null
}

export const LIVE_SOURCE_CONTROL_CONFIGURATION_DEPS: SourceControlConfigurationDeps = {
  readCliHosts: () => readSourceControlCliHosts(),
  isCliInstalled,
}

/** Private project override, then the user choice, then the project's shared file, then default. */
export async function resolveChangeRequestOpenDestination(
  projectPath: string | null,
  access: SourceControlSettingsAccess,
): Promise<ChangeRequestOpenDestinationResolution> {
  const settings = await access.read()
  const key = projectPath ? await projectSettingsKey(projectPath) : null
  const local = key ? settings.changeRequestOpenDestinationByProject[key] : undefined
  if (local) return { destination: local, source: 'project-local' }
  if (settings.changeRequestOpenDestination) {
    return { destination: settings.changeRequestOpenDestination, source: 'user' }
  }
  const shared = projectPath
    ? (await readProjectSourceControlConfig(key ?? projectPath)).changeRequestOpenDestination
    : undefined
  if (shared) return { destination: shared, source: 'project-shared' }
  return { destination: DEFAULT_CHANGE_REQUEST_OPEN_DESTINATION, source: 'default' }
}

function canonicalHost(host: string) {
  const key = sourceControlHostKey(host)
  return isSourceControlHostName(key) ? key : null
}

function failure(message: string): SourceControlConfigureResult {
  return { ok: false, message }
}

async function setHostProvider(
  host: string,
  provider: SourceControlHostChoice | null,
  access: SourceControlSettingsAccess,
): Promise<SourceControlConfigureResult> {
  const key = canonicalHost(host)
  if (!key) return failure(`"${host}" is not a hostname.`)
  await access.patch(
    provider
      ? { sourceControlHostProviders: { [key]: provider } }
      : {
          sourceControlHostProviders: { [key]: null },
          sourceControlDetectedHostProviders: { [key]: null },
        },
  )
  return { ok: true }
}

function canonicalDeclarations(hosts: SourceControlHostDeclarations) {
  const canonical: Record<string, SourceControlProviderId> = {}
  for (const [host, provider] of Object.entries(hosts)) {
    const key = canonicalHost(host)
    if (!key) return null
    canonical[key] = provider
  }
  return canonical
}

/**
 * Record the user's decision on exactly the declarations shown, per host: other hosts keep their
 * own decisions, and a host moves between approved and declined when decided again.
 */
async function recordDeclarationDecision(
  projectPath: string,
  decision: 'approved' | 'declined',
  hosts: SourceControlHostDeclarations,
  access: SourceControlSettingsAccess,
  removedHost: string | null = null,
) {
  const key = await projectSettingsKey(projectPath)
  const previous = (await access.read()).sourceControlProjectDeclarations[key]
  const approved: Record<string, SourceControlProviderId> = { ...previous?.approved }
  const declined: Record<string, SourceControlProviderId> = { ...previous?.declined }
  const [chosen, other] = decision === 'approved' ? [approved, declined] : [declined, approved]
  for (const [host, provider] of Object.entries(hosts)) {
    chosen[host] = provider
    delete other[host]
  }
  if (removedHost) {
    delete approved[removedHost]
    delete declined[removedHost]
  }
  await access.patch({ sourceControlProjectDeclarations: { [key]: { approved, declined } } })
}

async function declareProjectHost(
  request: Extract<SourceControlConfigureRequest, { kind: 'declare-project-host' }>,
  access: SourceControlSettingsAccess,
): Promise<SourceControlConfigureResult> {
  const { projectPath, host, provider } = request
  const key = canonicalHost(host)
  if (!key) return failure(`"${host}" is not a hostname.`)
  const root = await sharedFileRoot(request.workingPath ?? projectPath)
  if (!root) return failure('The project settings file can only be written at a repository root.')
  await updateProjectSourceControlConfig(root, { hosts: { [key]: provider } })
  // The user authorized this one declaration, so it applies to every Session of the project now.
  // Other hosts in the file are judged on their own and still ask if nobody approved them.
  await recordDeclarationDecision(
    projectPath,
    'approved',
    provider ? { [key]: provider } : {},
    access,
    provider ? null : key,
  )
  return { ok: true }
}

async function setOpenDestination(
  request: Extract<SourceControlConfigureRequest, { kind: 'set-open-destination' }>,
  access: SourceControlSettingsAccess,
): Promise<SourceControlConfigureResult> {
  if (request.scope === 'user') {
    await access.patch({ changeRequestOpenDestination: request.destination })
    return { ok: true }
  }
  if (!request.projectPath) return failure('A project is required for a project destination.')
  if (request.scope === 'project-shared') {
    const root = await sharedFileRoot(request.workingPath ?? request.projectPath)
    if (!root) {
      return failure('The project settings file can only be written at a repository root.')
    }
    await updateProjectSourceControlConfig(root, {
      changeRequestOpenDestination: request.destination,
    })
    return { ok: true }
  }
  await access.patch({
    changeRequestOpenDestinationByProject: {
      [await projectSettingsKey(request.projectPath)]: request.destination,
    },
  })
  return { ok: true }
}

function cliAccounts(host: string, cliHosts: SourceControlCliHosts) {
  return [
    ...(cliHosts.github.find((entry) => entry.host === host)?.accounts ?? []),
    ...(cliHosts.gitlab.find((entry) => entry.host === host)?.accounts ?? []),
  ]
}

async function setRepositoryAccount(
  repository: string,
  login: string | null,
  access: SourceControlSettingsAccess,
  deps: SourceControlConfigurationDeps,
): Promise<SourceControlConfigureResult> {
  const key = repository.trim().toLowerCase()
  const host = canonicalHost(key.split('/')[0] ?? '')
  if (!host || key.split('/').length < MIN_REPOSITORY_KEY_SEGMENTS) {
    return failure(`"${repository}" is not a host/owner/repository reference.`)
  }
  if (login === null) {
    await access.patch({ sourceControlRepositoryAccounts: { [key]: null } })
    return { ok: true }
  }
  const accounts = cliAccounts(host, await deps.readCliHosts())
  if (!accounts.some((account) => account.login === login)) {
    return failure(`No signed-in account "${login}" for ${host}.`)
  }
  await access.patch({ sourceControlRepositoryAccounts: { [key]: login } })
  return { ok: true }
}

/** Apply one source-control change the same way for Settings, the Session Summary, and agents. */
export async function configureSourceControl(
  request: SourceControlConfigureRequest,
  access: SourceControlSettingsAccess,
  deps: Partial<SourceControlConfigurationDeps> = {},
): Promise<SourceControlConfigureResult> {
  const resolvedDeps = { ...LIVE_SOURCE_CONTROL_CONFIGURATION_DEPS, ...deps }
  try {
    return await match(request)
      .with({ kind: 'set-host-provider' }, (value) =>
        setHostProvider(value.host, value.provider, access),
      )
      .with({ kind: 'declare-project-host' }, (value) => declareProjectHost(value, access))
      .with({ kind: 'decide-project-declaration' }, async (value) => {
        const hosts = canonicalDeclarations(value.hosts)
        if (!hosts) return failure('A declared host is not a hostname.')
        await recordDeclarationDecision(value.projectPath, value.decision, hosts, access)
        return { ok: true } satisfies SourceControlConfigureResult
      })
      .with({ kind: 'set-open-destination' }, (value) => setOpenDestination(value, access))
      .with({ kind: 'set-repository-account' }, (value) =>
        setRepositoryAccount(value.repository, value.login, access, resolvedDeps),
      )
      .exhaustive()
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}
