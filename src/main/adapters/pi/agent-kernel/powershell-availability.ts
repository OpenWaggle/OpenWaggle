/**
 * Whether a Run offers Pi's `powershell` tool: only on Windows. Pi resolves PowerShell only there
 * (`getPowerShellConfig` throws "The powershell tool is only available on Windows." on any other
 * platform, whether or not `pwsh` is installed), so a macOS or Linux model is never handed a tool,
 * and a "bash or PowerShell" rule, that fails on every call.
 */
export function offersPowerShellTool(platform: NodeJS.Platform): boolean {
  return platform === 'win32'
}
