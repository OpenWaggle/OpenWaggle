import path from 'node:path'

/** The locations a test could write the user's MCP, Pi, or OpenWaggle files to. */
export interface TestUserLocations {
  readonly home: string
  readonly piAgentDir: string
  readonly userDataDir: string | undefined
  /** `PI_CODING_AGENT_SESSION_DIR`, which Pi writes every session file to when it is set. */
  readonly piSessionDir: string | undefined
}

function inside(child: string, parent: string) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Locations that are the real user's home, contain it, or lie inside it (outside the temporary
 * directory). A test must never read or write those: a test run once migrated a maintainer's real
 * `~/.openwaggle/mcp.json`.
 */
export function realHomeLocations(
  locations: TestUserLocations,
  realHome: string,
  temporaryRoot: string,
): string[] {
  const home = path.resolve(realHome)
  const temporary = path.resolve(temporaryRoot)
  const candidates = [
    locations.home,
    locations.piAgentDir,
    locations.userDataDir,
    locations.piSessionDir,
  ]
  return candidates.filter((location): location is string => {
    if (location === undefined) return false
    const resolved = path.resolve(location)
    if (inside(home, resolved)) return true
    return inside(resolved, home) && !inside(resolved, temporary)
  })
}

export function assertTestUserLocationsIsolated(
  locations: TestUserLocations,
  realHome: string,
  temporaryRoot: string,
) {
  const real = realHomeLocations(locations, realHome, temporaryRoot)
  if (real.length === 0) return
  throw new Error(
    `Tests must not use the real user's files, but these resolve inside ${realHome}: ${real.join(', ')}. ` +
      'Use a temporary HOME, PI_CODING_AGENT_DIR, PI_CODING_AGENT_SESSION_DIR, and OPENWAGGLE_USER_DATA_DIR.',
  )
}
