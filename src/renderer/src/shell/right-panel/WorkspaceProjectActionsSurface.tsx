import type { TerminalOwnerContext } from '@/features/terminal'

/** Hosts the Project Actions surface for the Session's workspace (ADR 0043). */
export function WorkspaceProjectActionsSurface(_props: { readonly owner: TerminalOwnerContext }) {
  return <div className="min-h-0 flex-1 bg-bg" />
}
