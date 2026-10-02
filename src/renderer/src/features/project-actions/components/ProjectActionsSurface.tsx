import type { ActionDefinition } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { type ActionRun, isActiveActionRun } from '@shared/types/action-runs'
import { actionNameKey } from '@shared/utils/action-name'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { PencilLine, Plus, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Spinner } from '@/shared/ui/Spinner'
import { useUIStore } from '@/shell/ui-store'
import { useActionAvailability } from '../hooks/useActionAvailability'
import {
  actionQueryKey,
  useActionRuns,
  useActionScope,
  useNativeActions,
} from '../hooks/useNativeActions'
import { useRunProjectAction } from '../hooks/useRunProjectAction'
import { duplicateActionNames, duplicateNameHint } from '../lib/action-names'
import { continueDraftLabel, isDraftDirty } from '../lib/action-panel-drafts'
import { restartActionRun, stopActionRun } from '../lib/action-run-operations'
import { openActionRunInTerminal } from '../lib/open-action-run-in-terminal'
import { useActionPanelStore } from '../state/action-panel-store'
import { requestForDraft } from './action-panel/panel-requests'
import { ProjectActionRow } from './ProjectActionRow'

const PROJECT_QUERY_PREFIX_LENGTH = 2

export interface ProjectActionsSurfaceProps {
  readonly projectPath: string | null
  readonly sessionId: string | null
  readonly onShowRunOutput: (input: { projectPath: string; runId: string }) => void
}

/** Newest first, so the first match is the run a row shows and operates on. */
function runsByAction(runs: readonly ActionRun[]) {
  const byAction = new Map<string, ActionRun[]>()
  for (const run of [...runs].sort((left, right) => right.startedAt - left.startedAt)) {
    const list = byAction.get(run.action.id) ?? []
    list.push(run)
    byAction.set(run.action.id, list)
  }
  return byAction
}

function useSurfaceOperations(scope: ActionManagementScope | null) {
  const client = useQueryClient()
  const showToast = useUIStore((state) => state.showToast)
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const perform = async (actionId: string, operation: () => Promise<unknown>) => {
    setPending((current) => new Set(current).add(actionId))
    try {
      await operation()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Action control failed.', 'error')
    } finally {
      setPending((current) => {
        const next = new Set(current)
        next.delete(actionId)
        return next
      })
      await client.invalidateQueries({
        queryKey: actionQueryKey(scope).slice(0, PROJECT_QUERY_PREFIX_LENGTH),
      })
    }
  }
  return { pending, perform }
}

function SurfaceMessage({
  children,
  alert,
}: {
  readonly children: string
  readonly alert?: boolean
}) {
  return (
    <p
      role={alert ? 'alert' : undefined}
      className={
        alert ? 'px-3 py-3 text-xs text-error-text' : 'px-3 py-3 text-xs text-text-tertiary'
      }
    >
      {children}
    </p>
  )
}

/**
 * The Project Actions Right panel surface (ADR 0043): every saved action with Run and Stop,
 * its run's output and Add action. It replaces the header's former "+ Action" menu.
 */
export function ProjectActionsSurface(props: ProjectActionsSurfaceProps) {
  const { projectPath, sessionId, onShowRunOutput } = props
  // The same scope the run hooks use, so a row never offers a run they would refuse.
  const scope = useActionScope(projectPath)
  const catalog = useNativeActions(scope)
  const runsQuery = useActionRuns(scope)
  const runProjectAction = useRunProjectAction(projectPath)
  const actions = catalog.data?.actions ?? []
  const runs = runsQuery.data ?? []
  const availability = useActionAvailability(scope, actions, runs)
  const draft = useActionPanelStore((state) =>
    projectPath ? state.drafts[projectPath] : undefined,
  )
  const navigate = useNavigate()
  const operations = useSurfaceOperations(scope)
  if (!scope) {
    return (
      <section aria-label="Project actions" className="flex flex-col">
        <SurfaceMessage>Open a project first to run its actions.</SurfaceMessage>
      </section>
    )
  }
  const canAdd = Boolean(catalog.data)
  const unfinished = draft && isDraftDirty(draft) ? draft : null
  const duplicates = duplicateActionNames(actions)
  const byAction = runsByAction(runs)
  const openPanel = useActionPanelStore.getState().openPanel
  const run = (definition: ActionDefinition) =>
    void operations.perform(definition.id, () => runProjectAction(definition))
  return (
    <section aria-label="Project actions" className="flex min-h-0 flex-col">
      <p className="px-3 pt-3 pb-1.5 text-xs font-normal text-text-tertiary">
        Run in this session’s workspace
      </p>
      {!sessionId ? (
        <SurfaceMessage>Select a session in this project to run actions.</SurfaceMessage>
      ) : null}
      {catalog.error ? <SurfaceMessage alert>{catalog.error.message}</SurfaceMessage> : null}
      {!catalog.error && !catalog.data ? (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-text-tertiary">
          <Spinner size="sm" />
          Loading actions…
        </div>
      ) : null}
      {catalog.data && actions.length === 0 ? (
        <SurfaceMessage>No saved actions yet. Add one to run it here.</SurfaceMessage>
      ) : null}
      {actions.length > 0 ? (
        <ul aria-label="Saved actions" className="flex flex-col">
          {actions.map((entry) => {
            const { definition } = entry
            const actionRuns = byAction.get(definition.id) ?? []
            return (
              <ProjectActionRow
                key={definition.id}
                model={{
                  entry,
                  hint: duplicates.has(actionNameKey(definition.name))
                    ? duplicateNameHint(entry)
                    : null,
                  unavailable: availability(definition),
                  latestRun: actionRuns[0] ?? null,
                  activeRun: actionRuns.find(isActiveActionRun) ?? null,
                  busy: operations.pending.has(definition.id),
                  canRun: Boolean(scope?.sessionId),
                  canOpenTerminal: Boolean(scope?.sessionId),
                }}
                actions={{
                  onRun: () => run(definition),
                  onStop: (target) =>
                    void operations.perform(definition.id, () => stopActionRun(scope, target)),
                  onRestart: (target) =>
                    void operations.perform(definition.id, () => restartActionRun(scope, target)),
                  onShowOutput: (target) =>
                    onShowRunOutput({ projectPath: scope.projectPath, runId: target.id }),
                  onOpenInTerminal: (target) => openActionRunInTerminal(scope, target),
                }}
              />
            )
          })}
        </ul>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-1 border-t border-border px-2 py-2">
        {unfinished ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={!canAdd}
            onClick={() => openPanel(requestForDraft(unfinished, scope, 'session'))}
          >
            <PencilLine className="size-3.5" />
            {continueDraftLabel(unfinished)}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="xs"
          disabled={!canAdd}
          onClick={() => openPanel({ kind: 'action', scope, actionId: null, origin: 'session' })}
        >
          <Plus className="size-3.5" />
          Add action
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void navigate({ to: '/settings/$tab', params: { tab: 'actions' } })}
        >
          <Settings2 className="size-3.5" />
          Manage actions
        </Button>
      </div>
    </section>
  )
}
