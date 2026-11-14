/** The shell an in-app terminal runs: PowerShell on Windows, a POSIX shell elsewhere. */
export function sessionTerminalShell(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
) {
  return /Windows|Win32|Win64/iu.test(userAgent) ? ('powershell' as const) : ('posix' as const)
}
