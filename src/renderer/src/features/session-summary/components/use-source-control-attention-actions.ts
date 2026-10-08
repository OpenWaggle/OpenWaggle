import {
  type SourceControlConfigureRequest,
  type SourceControlProviderId,
  sourceControlSignInCommand,
} from '@shared/types/git'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { runSessionTerminalCommand, watchSessionTerminalCommand } from '@/features/terminal'
import { configureSourceControl } from '@/queries/source-control'
import { createRendererLogger } from '@/shared/lib/logger'
import { sessionTerminalShell } from '@/shared/lib/terminal-shell'
import { openWorkspaceWebLink } from '@/shell/open-workspace-web-link'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('source-control')

/** The Session terminal a sign-in command runs in (ADR 0030). */
export interface SourceControlSessionTerminal {
  readonly ownerKey: string
  readonly cwd: string
}

interface PendingSignIn {
  readonly ownerKey: string
  readonly terminalId: string
}

interface SourceControlAttentionActionsInput {
  readonly terminal: SourceControlSessionTerminal | null
  /** Re-reads source-control state after a fix; the caller drops stale caches first. */
  readonly onRecheck: () => Promise<void> | void
}

/** Runs `recheck` whenever the window regains focus, while `enabled`. */
export function useRecheckOnWindowFocus(enabled: boolean, recheck: () => void) {
  const latest = useRef(recheck)
  useEffect(() => {
    latest.current = recheck
  })
  useEffect(() => {
    if (!enabled) return
    const onFocus = () => latest.current()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled])
}

/** Watches one sign-in terminal and reports once its command ends. */
function usePendingSignInWatch(pending: PendingSignIn | null, onFinished: () => void) {
  const latest = useRef(onFinished)
  useEffect(() => {
    latest.current = onFinished
  })
  useEffect(() => {
    if (pending === null) return
    return watchSessionTerminalCommand(pending.ownerKey, pending.terminalId, () => latest.current())
  }, [pending])
}

export function useSourceControlAttentionActions(input: SourceControlAttentionActionsInput) {
  const queryClient = useQueryClient()
  const showToast = useUIStore((state) => state.showToast)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [signIn, setSignIn] = useState<PendingSignIn | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recheck = async () => {
    setChecking(true)
    try {
      await input.onRecheck()
    } catch (cause) {
      logger.warn('Source-control re-check failed', { error: String(cause) })
      setError(cause instanceof Error ? cause.message : 'Could not check again.')
    } finally {
      setChecking(false)
    }
  }

  usePendingSignInWatch(signIn, () => {
    setSignIn(null)
    void recheck()
  })

  /** Resolves true when the change was saved. */
  const configure = async (request: SourceControlConfigureRequest) => {
    if (saving) return false
    setSaving(true)
    setError(null)
    try {
      const result = await configureSourceControl(queryClient, request)
      if (!result.ok) {
        setError(result.message)
        return false
      }
      void recheck()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this choice.')
      return false
    } finally {
      setSaving(false)
    }
  }

  const startSignIn = (provider: SourceControlProviderId, host: string) => {
    const terminal = input.terminal
    // One sign-in terminal at a time; the button stays inert until its command ends.
    if (terminal === null || signIn !== null) return
    const terminalId = runSessionTerminalCommand({
      ownerKey: terminal.ownerKey,
      cwd: terminal.cwd,
      // Clears GH_TOKEN and friends for this one command: the CLI refuses to sign in while set.
      command: sourceControlSignInCommand(provider, host, sessionTerminalShell()),
      title: `Sign in · ${host}`,
    })
    if (terminalId === null) {
      setError('Could not open a terminal for this Session.')
      return
    }
    setError(null)
    setSignIn({ ownerKey: terminal.ownerKey, terminalId })
  }

  const openWebsite = (url: string) => {
    void openWorkspaceWebLink(input.terminal?.ownerKey ?? '', url).catch((cause: unknown) => {
      showToast(cause instanceof Error ? cause.message : 'Could not open this link.', 'error')
    })
  }

  return {
    canSignIn: input.terminal !== null,
    checking,
    configure,
    error,
    openWebsite,
    recheck: () => void recheck(),
    saving,
    signingIn: signIn !== null,
    startSignIn,
  }
}

export type SourceControlAttentionActions = ReturnType<typeof useSourceControlAttentionActions>
