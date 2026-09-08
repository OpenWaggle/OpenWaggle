import { runGit } from './shared'

export function parseConfiguredRemoteNames(stdout: string): readonly string[] {
  return stdout
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean)
}

export interface ResolvedRemoteBranchName {
  readonly remoteName: string
  readonly localName: string
}

/**
 * Resolve a remote-tracking ref against Git's configured remote names.
 *
 * Remote names may contain slashes, so the first path segment is not a reliable boundary. When
 * names overlap, such as `team` and `team/fork`, Git's longest matching remote prefix owns the ref.
 */
export function resolveRemoteBranchName(
  refName: string,
  remoteNames: readonly string[],
): ResolvedRemoteBranchName | null {
  let matchedRemote = ''
  for (const remoteName of remoteNames) {
    const prefix = `${remoteName}/`
    if (refName.startsWith(prefix) && remoteName.length > matchedRemote.length) {
      matchedRemote = remoteName
    }
  }
  if (!matchedRemote) return null
  return {
    remoteName: matchedRemote,
    localName: refName.slice(matchedRemote.length + 1),
  }
}

export function resolveRemoteBranchLocalName(
  refName: string,
  remoteNames: readonly string[],
): string | null {
  return resolveRemoteBranchName(refName, remoteNames)?.localName ?? null
}

export async function listConfiguredRemoteNames(projectPath: string): Promise<readonly string[]> {
  const result = await runGit(projectPath, ['remote'])
  return result.code === 0 ? parseConfiguredRemoteNames(result.stdout) : []
}
