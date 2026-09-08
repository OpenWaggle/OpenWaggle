import type { TerminalLinkActivationTarget } from './terminal-link-types'

export interface TerminalLinkRoutes {
  readonly openUrl: (url: string) => Promise<void>
  readonly openExternalFile: (
    path: string,
    line: number | null,
    column: number | null,
  ) => Promise<void>
  readonly openWorkspaceFile: (relativePath: string, line?: number | null) => void
}

/** Routes only already-validated terminal targets; parsing and policy live before this boundary. */
export function activateTerminalLinkTarget(
  target: TerminalLinkActivationTarget,
  routes: TerminalLinkRoutes,
): Promise<void> | void {
  if (target.kind === 'url') return routes.openUrl(target.url)
  if (target.route === 'workspace-preview' && target.projectRelativePath !== null) {
    routes.openWorkspaceFile(target.projectRelativePath, target.line)
    return
  }
  return routes.openExternalFile(target.resolvedPath, target.line, target.column)
}
