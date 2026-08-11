import type { GitBranchInfo } from '@shared/types/git'

/**
 * Base-ref choices for the Branch-diff base-ref combobox (WS6b), ported from
 * T3Code's buildBaseRefChoices. Local branches are paired with their matching
 * remote (preferring origin), and unpaired remotes are surfaced on their own.
 */
export interface BaseRefChoice {
  readonly id: string
  readonly label: string
}

function splitRemoteName(
  name: string,
): { readonly remoteName: string; readonly branch: string } | null {
  const slash = name.indexOf('/')
  if (slash <= 0) return null
  return { remoteName: name.slice(0, slash), branch: name.slice(slash + 1) }
}

export function buildBaseRefChoices(branches: readonly GitBranchInfo[]): readonly BaseRefChoice[] {
  const locals = branches.filter((branch) => !branch.isRemote)
  const remotes = branches.filter((branch) => branch.isRemote)
  const usedRemotes = new Set<string>()

  const pairedChoices = locals.map((local) => {
    const matches = remotes.filter((remote) => {
      if (usedRemotes.has(remote.name)) return false
      return splitRemoteName(remote.name)?.branch === local.name
    })
    const remote =
      matches.find((candidate) => splitRemoteName(candidate.name)?.remoteName === 'origin') ??
      matches[0] ??
      null
    if (remote) usedRemotes.add(remote.name)
    return { id: `local:${local.name}`, label: local.name }
  })

  const remoteOnlyChoices = remotes.flatMap((remote) =>
    usedRemotes.has(remote.name) ? [] : [{ id: `remote:${remote.name}`, label: remote.name }],
  )

  return [...pairedChoices, ...remoteOnlyChoices]
}
