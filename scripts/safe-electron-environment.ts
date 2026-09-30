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

export function buildSafeElectronEnvironment(
  overrides: Readonly<Record<string, string>>,
): Record<string, string> {
  const environment: Record<string, string> = { ...overrides }
  for (const key of SAFE_ELECTRON_ENVIRONMENT_KEYS) {
    const value = process.env[key]
    if (typeof value === 'string' && value.length > 0) environment[key] = value
  }
  return environment
}
