const SAFE_ELECTRON_ENVIRONMENT_KEYS = [
  'CI',
  'COLORTERM',
  'DISPLAY',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  // Lets a QA app started from an agent shell move its TMPDIR back off the Session scratch
  // directory at startup, as every OpenWaggle process does.
  'OPENWAGGLE_HOST_TMPDIR',
  'PATH',
  // A scratch Pi agent directory the caller chose; without it Pi falls back to HOME/.pi/agent.
  'PI_CODING_AGENT_DIR',
  'SHELL',
  'SYSTEMROOT',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'XDG_RUNTIME_DIR',
] as const

/**
 * The inherited allow-listed variables, then the launcher's overrides. An override wins: a
 * launcher that isolates HOME or the Pi agent directory must not get the caller's real one back.
 */
export function buildSafeElectronEnvironment(
  overrides: Readonly<Record<string, string>>,
): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const key of SAFE_ELECTRON_ENVIRONMENT_KEYS) {
    const value = process.env[key]
    if (typeof value === 'string' && value.length > 0) environment[key] = value
  }
  return { ...environment, ...overrides }
}
