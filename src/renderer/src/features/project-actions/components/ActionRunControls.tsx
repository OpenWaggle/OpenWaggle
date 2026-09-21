import type { ActionManagementScope } from '@shared/types/action-management'
import { type ActionRun, isActiveActionRun } from '@shared/types/action-runs'
import { Copy, ExternalLink, RotateCw, Sparkles, Square } from 'lucide-react'
import { useState } from 'react'
import { setComposerTextValue } from '@/features/chat/lib'
import { useComposerStore } from '@/features/composer/state'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { openWorkspaceAction, openWorkspacePreview } from '@/shell/workspace-panel-actions'
import { resolvedActionCommand } from '../lib/native-action-display'

const REPAIR_OUTPUT_CHARACTERS = 12_000
export function ActionRunControls(props: {
  readonly scope: ActionManagementScope
  readonly run: ActionRun
  readonly output: string
}) {
  const { run, scope, output } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function perform(operation: () => unknown) {
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action control failed.')
    } finally {
      setBusy(false)
    }
  }
  async function operate(operation: 'stop' | 'restart') {
    const result = await api.manageProjectActions({
      scope,
      operation:
        operation === 'stop'
          ? { type: 'stop', runId: run.id }
          : {
              type: 'start',
              actionId: run.action.id,
              requestId: crypto.randomUUID(),
              restartRunId: run.id,
            },
    })
    if (result.type === 'run' && scope.sessionId)
      openWorkspaceAction(scope.sessionId, scope.projectPath, result.run.id)
  }
  function repairDraft() {
    const prompt = `Investigate the project action "${run.action.name}" in this workspace and on the current machine. Propose a compatible command for me to review and save. Do not replace the saved action or launch a replacement automatically.\n\nAction ID: ${run.action.id}\nCommand: ${resolvedActionCommand(run.invocation)}\nWorking directory: ${run.invocation.cwd}\nResult: ${run.status}, exit ${run.exitCode ?? 'unknown'}\n${run.error ?? ''}\n\nRetained output:\n${output.slice(-REPAIR_OUTPUT_CHARACTERS)}`
    const current = useComposerStore.getState().input
    setComposerTextValue(current.trim() ? `${current}\n\n${prompt}` : prompt)
    useUIStore
      .getState()
      .showToast('Repair request added to your draft. Review it before sending.', 'success')
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {isActiveActionRun(run) ? (
          <Button
            className="min-h-10"
            disabled={busy}
            onClick={() => void perform(() => operate('stop'))}
          >
            <Square className="size-3.5" />
            Stop
          </Button>
        ) : null}
        <Button
          className="min-h-10"
          disabled={busy || run.status === 'stopping'}
          onClick={() => void perform(() => operate('restart'))}
        >
          <RotateCw className="size-3.5" />
          Restart
        </Button>
        {run.previewUrl && scope.sessionId ? (
          <Button
            className="min-h-10"
            disabled={busy || !run.ready}
            onClick={() => {
              if (run.previewUrl && scope.sessionId)
                void perform(() =>
                  openWorkspacePreview(scope.sessionId ?? '', run.previewUrl ?? ''),
                )
            }}
          >
            <ExternalLink className="size-3.5" />
            Open preview
          </Button>
        ) : null}
        <Button
          variant="ghost"
          className="min-h-10"
          disabled={busy || !output}
          onClick={() => void perform(() => navigator.clipboard.writeText(output))}
        >
          <Copy className="size-3.5" />
          Copy output
        </Button>
        <Button
          variant="ghost"
          className="min-h-10"
          disabled={busy}
          onClick={() =>
            void perform(() => navigator.clipboard.writeText(resolvedActionCommand(run.invocation)))
          }
        >
          Copy command
        </Button>
        {run.status === 'failed' || run.status === 'interrupted' ? (
          <Button variant="ghost" className="min-h-10" onClick={repairDraft}>
            <Sparkles className="size-3.5" />
            Fix with agent
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-error-text">
          {error}
        </p>
      ) : null}
    </>
  )
}
