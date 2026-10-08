import { safeDecodeUnknown } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'
import type { SourceControlFailure, SourceControlRepositoryIdentity } from '@shared/types/git'
import type { ForkParentLookup } from '../../ports/source-control-provider'
import type { CliResult } from './cli-runner'
import { githubRepositorySelector } from './repository-context'

/** Runs one repository-scoped gh command, possibly as a specific Provider account. */
export type GhRun = (args: readonly string[], cwd: string) => Promise<CliResult>

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** The repository a GitHub repository was forked from, when gh reports one. */
export async function viewForkParent(
  run: GhRun,
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
): Promise<ForkParentLookup> {
  const result = await run(
    ['repo', 'view', githubRepositorySelector(repository), '--json', 'parent'],
    projectPath,
  )
  if (result.code !== 0) return { ok: false }
  const parent = jsonObjectProperty(safeJsonParse(result.stdout), 'parent')
  const name = parent ? stringProperty(parent, 'name') : null
  const ownerRecord = parent ? jsonObjectProperty(parent, 'owner') : null
  const owner = ownerRecord ? stringProperty(ownerRecord, 'login') : null
  return {
    ok: true,
    parent:
      name && owner ? { provider: 'github', host: repository.host, owner, repository: name } : null,
  }
}

function jsonObjectProperty(raw: unknown, property: string) {
  const decoded = safeDecodeUnknown(jsonObjectSchema, raw)
  if (!decoded.success) return null
  const value = safeDecodeUnknown(jsonObjectSchema, decoded.data[property])
  return value.success ? value.data : null
}

function stringProperty(record: Readonly<Record<string, unknown>>, property: string) {
  const value = record[property]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** None of the host's signed-in accounts can see the repository. */
export function noAccountAccessFailure(
  repository: SourceControlRepositoryIdentity,
  accounts: readonly string[],
): SourceControlFailure {
  const name = `${repository.owner}/${repository.repository}`
  return {
    ok: false,
    code: 'not-authenticated',
    message: `None of your GitHub accounts on ${repository.host} can see ${name}.`,
    attention: {
      kind: 'no-account-access',
      provider: 'github',
      host: repository.host,
      cli: 'gh',
      repository: name,
      accounts,
    },
  }
}
