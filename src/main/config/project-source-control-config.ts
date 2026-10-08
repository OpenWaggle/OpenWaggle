import type { SourceControlProviderId } from '@shared/types/change-request'
import type { JsonObject } from '@shared/types/json'
import {
  type ChangeRequestOpenDestination,
  isSourceControlHostName,
  type SourceControlHostDeclarations,
  sourceControlHostKey,
} from '@shared/types/source-control'
import { createLogger } from '../logger'
import { loadProjectConfig, updateProjectConfig } from './project-config'

const logger = createLogger('project-source-control-config')

const MAX_DECLARED_HOSTS = 100

/** A project's shared source-control configuration from `.openwaggle/settings.json`. */
export interface ProjectSourceControlConfig {
  readonly hosts: SourceControlHostDeclarations
  readonly changeRequestOpenDestination?: ChangeRequestOpenDestination
}

/** `null` removes an entry; an absent key leaves it alone. */
export interface ProjectSourceControlConfigUpdate {
  readonly hosts?: Readonly<Record<string, SourceControlProviderId | null>>
  readonly changeRequestOpenDestination?: ChangeRequestOpenDestination | null
}

function isProvider(value: unknown): value is SourceControlProviderId {
  return value === 'github' || value === 'gitlab'
}

function isDestination(value: unknown): value is ChangeRequestOpenDestination {
  return value === 'inspector' || value === 'website'
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalHost(host: string) {
  const key = sourceControlHostKey(host)
  return isSourceControlHostName(key) ? key : null
}

/** Valid entries only; invalid ones are logged and skipped rather than failing the file. */
export function parseProjectSourceControlConfig(
  raw: unknown,
  projectPath: string,
): ProjectSourceControlConfig {
  if (!isJsonObject(raw)) return { hosts: {} }
  const hosts: Record<string, SourceControlProviderId> = {}
  const skipped: string[] = []
  const declared = isJsonObject(raw.hosts) ? Object.entries(raw.hosts) : []
  for (const [host, provider] of declared.slice(0, MAX_DECLARED_HOSTS)) {
    const key = canonicalHost(host)
    if (key && isProvider(provider)) hosts[key] = provider
    else skipped.push(host)
  }
  const destination = raw.changeRequestOpenDestination
  if (destination !== undefined && !isDestination(destination))
    skipped.push('changeRequestOpenDestination')
  if (skipped.length > 0 || declared.length > MAX_DECLARED_HOSTS) {
    logger.warn('Ignoring invalid source-control entries in project settings', {
      projectPath,
      skipped,
      truncated: declared.length > MAX_DECLARED_HOSTS,
    })
  }
  return isDestination(destination)
    ? { hosts, changeRequestOpenDestination: destination }
    : { hosts }
}

export async function readProjectSourceControlConfig(
  projectPath: string,
): Promise<ProjectSourceControlConfig> {
  const config = await loadProjectConfig(projectPath)
  return parseProjectSourceControlConfig(config.sourceControl, projectPath)
}

function applyHostUpdates(
  current: SourceControlHostDeclarations,
  updates: ProjectSourceControlConfigUpdate['hosts'],
) {
  const next: Record<string, SourceControlProviderId> = { ...current }
  for (const [host, provider] of Object.entries(updates ?? {})) {
    const key = canonicalHost(host)
    if (!key) throw new Error(`Invalid Source control host: ${host}`)
    if (provider === null) delete next[key]
    else next[key] = provider
  }
  return next
}

export async function updateProjectSourceControlConfig(
  projectPath: string,
  update: ProjectSourceControlConfigUpdate,
): Promise<ProjectSourceControlConfig> {
  let written: ProjectSourceControlConfig = { hosts: {} }
  await updateProjectConfig(projectPath, (current) => {
    const existing = parseProjectSourceControlConfig(current.sourceControl, projectPath)
    const hosts = applyHostUpdates(existing.hosts, update.hosts)
    const destination =
      update.changeRequestOpenDestination === undefined
        ? existing.changeRequestOpenDestination
        : (update.changeRequestOpenDestination ?? undefined)
    written = destination ? { hosts, changeRequestOpenDestination: destination } : { hosts }
    const section: JsonObject = {
      ...(Object.keys(hosts).length > 0 ? { hosts } : {}),
      ...(destination ? { changeRequestOpenDestination: destination } : {}),
    }
    const { sourceControl: _previous, ...rest } = current
    return Object.keys(section).length > 0 ? { ...rest, sourceControl: section } : rest
  })
  return written
}
