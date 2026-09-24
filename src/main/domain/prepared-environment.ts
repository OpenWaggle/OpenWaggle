/** Null persists an explicit removal without storing the inherited Host environment. */
export type PreparedEnvironment = Readonly<Record<string, string | null>>

const TRANSIENT_NAMES = new Set(['_', 'PWD', 'OLDPWD', 'SHLVL', 'ELECTRON_RUN_AS_NODE'])
const WORKSPACE_CONTEXT_NAMES = new Set([
  'OPENWAGGLE_PROJECT_ROOT',
  'OPENWAGGLE_WORKTREE_PATH',
  'OPENWAGGLE_AGENT_RUN',
])
const isWorkspaceContextName = (name: string) => WORKSPACE_CONTEXT_NAMES.has(name.toUpperCase())

export function withoutWorkspaceContext<T extends string | null | undefined>(
  environment: Readonly<Record<string, T>>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !isWorkspaceContextName(name)),
  )
}

export function applyPreparedEnvironment<T extends string | undefined>(
  inherited: Readonly<Record<string, T>>,
  prepared: PreparedEnvironment,
  caseInsensitive = false,
): Record<string, T | string> {
  const environment = new Map<string, T | string>(Object.entries(inherited))
  for (const [name, value] of Object.entries(prepared)) {
    if (caseInsensitive) {
      for (const key of environment.keys())
        if (key.toUpperCase() === name.toUpperCase()) environment.delete(key)
    }
    if (value === null) environment.delete(name)
    else environment.set(name, value)
  }
  return Object.fromEntries(environment)
}

export function capturePreparedEnvironment(
  baseline: Readonly<Record<string, string>>,
  previous: PreparedEnvironment,
  exported: Readonly<Record<string, string>>,
  caseInsensitive = false,
): PreparedEnvironment {
  const normalize = (name: string) => (caseInsensitive ? name.toUpperCase() : name)
  const inherited = new Map(
    Object.entries(baseline).map(([name, value]) => [normalize(name), value]),
  )
  const captured = new Map(Object.keys(exported).map((name) => [normalize(name), name]))
  const changes = new Map<string, string | null>()
  for (const [name, value] of Object.entries(exported)) {
    if (
      !TRANSIENT_NAMES.has(normalize(name)) &&
      !isWorkspaceContextName(name) &&
      value !== inherited.get(normalize(name))
    )
      changes.set(name, value)
  }
  // Keep prior removals even if that variable is absent from the Host on this attempt.
  for (const name of new Set([...Object.keys(baseline), ...Object.keys(previous)])) {
    if (
      !TRANSIENT_NAMES.has(normalize(name)) &&
      !isWorkspaceContextName(name) &&
      !captured.has(normalize(name))
    )
      changes.set(name, null)
  }
  return Object.fromEntries(changes)
}
