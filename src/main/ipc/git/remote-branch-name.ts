import { runGit } from './shared'

export interface ResolvedRemoteBranchName {
  readonly remoteName: string
  readonly localName: string
}

export function parseConfiguredRemoteNames(stdout: string) {
  return stdout
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean)
}

/**
 * Resolve a remote-tracking ref against Git's configured remote names.
 *
 * Remote names may contain slashes, so the first path segment is not a reliable boundary. When
 * names overlap, such as `team` and `team/fork`, Git's longest matching remote prefix owns the ref.
 */
export function resolveRemoteBranchName(refName: string, remoteNames: readonly string[]) {
  let matchedRemote = ''
  for (const remoteName of remoteNames) {
    const prefix = `${remoteName}/`
    if (refName.startsWith(prefix) && remoteName.length > matchedRemote.length) {
      matchedRemote = remoteName
    }
  }
  if (!matchedRemote) return null
  const name: ResolvedRemoteBranchName | null = {
    remoteName: matchedRemote,
    localName: refName.slice(matchedRemote.length + 1),
  }
  return name
}

export function resolveRemoteBranchLocalName(refName: string, remoteNames: readonly string[]) {
  return resolveRemoteBranchName(refName, remoteNames)?.localName ?? null
}

export async function listConfiguredRemoteNames(projectPath: string) {
  const result = await runGit(projectPath, ['remote'])
  return result.code === 0 ? parseConfiguredRemoteNames(result.stdout) : []
}
