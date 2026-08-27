const SAFE_ELECTRON_ENVIRONMENT_KEYS = [
  'CI',
  'COLORTERM',
  'DISPLAY',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
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
