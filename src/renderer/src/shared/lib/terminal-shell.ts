import type { SourceControlCommandShell } from '@shared/types/source-control'

/** The shell an in-app terminal runs: PowerShell on Windows, a POSIX shell elsewhere. */
export function sessionTerminalShell(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): SourceControlCommandShell {
  return /Windows|Win32|Win64/iu.test(userAgent) ? 'powershell' : 'posix'
}
