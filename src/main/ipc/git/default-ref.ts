import { runGit } from './shared'

/**
 * The repository's default branch, without a remote prefix.
 *
 * Prefers what the remote advertises, because that is the only authoritative statement of a
 * repository's default branch:
 * 1. `refs/remotes/origin/HEAD`, which a clone sets up and which costs nothing to read,
 * 2. `git ls-remote --symref origin HEAD`, for a repository whose local copy of that symref was
 *    never created - verified to report `refs/heads/develop` for a repository whose default is
 *    `develop` even when the local symref is missing.
 *
 * Returns null when the remote says nothing, which is normal for a repository with no remote.
 *
 * `init.defaultBranch` is deliberately not consulted. `git config --get` reads global and system
 * config, and that setting describes how *new* repositories are initialised - not what this
 * repository's default branch is. Verified: a repository created with `git init -b develop`
 * reports `main` from a developer's global config, so Automatic would have diffed against the
 * wrong branch and said nothing about it.
 *
 * This is the branch *name* only. VCS status uses it directly (ahead/behind against the default
 * branch); the diff panel's Automatic base ref goes through
 * {@link resolveDefaultBranchRevision}, which additionally verifies that a revision exists and may
 * therefore answer differently in form (`origin/main` rather than `main`) or answer at all where
 * this returns null (a local-only repository with a conventional default). Both derive the name
 * here, so they cannot disagree about *which branch* is default - only about which revision of it
 * is resolvable, which is the question each is actually asking.
 */
export async function resolveDefaultRef(projectPath: string): Promise<string | null> {
  const localSymref = await runGit(projectPath, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD',
  ])
  if (localSymref.code === 0 && localSymref.stdout.trim()) {
    return localSymref.stdout.trim().replace(/^origin\//, '')
  }
  return await resolveAdvertisedDefaultRef(projectPath)
}

/**
 * Ask the remote directly which branch its HEAD points at.
 *
 * Only reached when the local symref is missing, and skipped entirely when no remote is
 * configured, so the common cases (a clone, or a purely local repository) stay offline. A
 * failure here - no network, no permission - is reported as "unknown" so resolution can fall
 * back rather than surfacing a network error in a diff.
 */
async function resolveAdvertisedDefaultRef(projectPath: string): Promise<string | null> {
  const remotes = await runGit(projectPath, ['remote'])
  if (remotes.code !== 0 || !remotes.stdout.split('\n').some((line) => line.trim() === 'origin')) {
    return null
  }

  /*
   * Hard-bounded, and never allowed to prompt.
   *
   * This runs on interactive paths - an Automatic-scope diff load, the short-TTL local status, the
   * gate a Commit & push waits for - so an unreachable or credential-protected remote must not stall
   * them. Verified that without a bound the diff load and the "network-free" cached status both
   * blocked indefinitely against an unreachable origin. Giving up simply falls through to the
   * conventional local default.
   */
  const advertised = await runGit(projectPath, ['ls-remote', '--symref', 'origin', 'HEAD'], {
    timeoutMs: ADVERTISED_DEFAULT_REF_TIMEOUT_MS,
    env: { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' },
  })
  if (advertised.code !== 0) return null

  for (const line of advertised.stdout.split('\n')) {
    // `ref: refs/heads/<name>\tHEAD`
    const match = /^ref:\s+refs\/heads\/(?<name>\S+)\s+HEAD$/.exec(line.trim())
    const name = match?.groups?.name
    if (name) return name
  }
  return null
}

/**
 * Branch names conventionally used for a default branch, tried in order when nothing is
 * advertised. A local-only repository created with `git init -b main` advertises nothing, so
 * without this an obvious default would go unresolved and the Automatic base ref would silently
 * degrade to the working-tree diff.
 */
const CONVENTIONAL_DEFAULT_BRANCHES = ['main', 'master'] as const

/** Long enough for a healthy remote to answer, short enough not to stall the UI. */
const ADVERTISED_DEFAULT_REF_TIMEOUT_MS = 2_000

/**
 * A revision for the default branch that actually exists in this repository.
 *
 * Resolution order, each verified to exist before it is used:
 * 1. the remote-tracking copy of what the remote advertises (`origin/<ref>`), because that is
 *    what "how does my work differ from the default branch" means to a reviewer,
 * 2. the local branch of that same ref, for a repository with no remote copy yet,
 * 3. a conventional default (`main`, then `master`) for a local-only repository,
 * 4. null - no default branch is present at all, so callers must decide what to do.
 *
 * A conventional name is only tried after the remote has been consulted, so a repository whose
 * default is `develop` is not diffed against a `main` that merely happens to exist.
 */
export async function resolveDefaultBranchRevision(projectPath: string): Promise<string | null> {
  const defaultRef = await resolveDefaultRef(projectPath)
  const candidates = [
    ...(defaultRef === null ? [] : [`origin/${defaultRef}`, defaultRef]),
    ...CONVENTIONAL_DEFAULT_BRANCHES,
  ]

  for (const candidate of candidates) {
    const verify = await runGit(projectPath, ['rev-parse', '--verify', `${candidate}^{commit}`])
    if (verify.code === 0) return candidate
  }
  return null
}
