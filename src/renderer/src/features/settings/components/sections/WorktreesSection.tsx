import { SESSION_ENVIRONMENT_MODES, type SessionEnvironmentMode } from '@shared/types/git'
import type {
  WorktreeInventoryEntry,
  WorktreeInventoryGroup,
  WorktreeInventoryProject,
} from '@shared/types/worktree-inventory'
import { useId, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state/preferences-store'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { AutomaticRemovalCard } from './worktrees/AutomaticRemovalCard'
import { BulkWorktreeRemovalDialog } from './worktrees/BulkWorktreeRemovalDialog'
import { useWorktreeInventory, useWorktreeSpace } from './worktrees/use-worktree-inventory'
import { useWorktreeRemoval, type WorktreeRemovalRequest } from './worktrees/use-worktree-removal'
import { ALL_PROJECTS, WorktreeFilters } from './worktrees/WorktreeFilters'
import { WorktreeGroup, type WorktreeRowContext } from './worktrees/WorktreeGroup'
import { WorktreeRemovalDialog } from './worktrees/WorktreeRemovalDialog'
import { storageTotals, WorktreeStorageCard } from './worktrees/WorktreeStorageCard'
import { worktreeEntryMatchesSearch } from './worktrees/worktree-inventory-format'

const GROUPS: readonly WorktreeInventoryGroup[] = ['safe', 'decide', 'in-use']

const MODE_LABELS: Record<SessionEnvironmentMode, string> = {
  local: 'Current checkout',
  worktree: 'A new worktree',
}

function isSessionEnvironmentMode(value: string): value is SessionEnvironmentMode {
  return SESSION_ENVIRONMENT_MODES.some((mode) => mode === value)
}

/** The opened project first, then by name; inside a project, the longest archived first. */
function orderEntries(
  entries: readonly WorktreeInventoryEntry[],
  projects: readonly WorktreeInventoryProject[],
) {
  const rank = new Map(projects.map((project, index) => [project.projectPath, index]))
  return [...entries].sort(
    (left, right) =>
      (rank.get(left.projectPath) ?? projects.length) -
        (rank.get(right.projectPath) ?? projects.length) ||
      (left.archivedAt ?? Number.POSITIVE_INFINITY) -
        (right.archivedAt ?? Number.POSITIVE_INFINITY) ||
      left.path.localeCompare(right.path),
  )
}

function NewSessionsRunIn() {
  const id = useId()
  const mode = usePreferencesStore((state) => state.settings.defaultSessionEnvironmentMode)
  const setMode = usePreferencesStore((state) => state.setDefaultSessionEnvironmentMode)
  return (
    <div className="flex items-center gap-2 text-xs text-text-secondary">
      <label htmlFor={id}>New Sessions run in</label>
      <Select
        id={id}
        selectSize="xs"
        value={mode}
        onChange={(event) => {
          if (isSessionEnvironmentMode(event.target.value)) void setMode(event.target.value)
        }}
      >
        {SESSION_ENVIRONMENT_MODES.map((option) => (
          <option key={option} value={option}>
            {MODE_LABELS[option]}
          </option>
        ))}
      </Select>
    </div>
  )
}

function WorktreesHeader(props: { readonly refreshing: boolean; readonly onRefresh: () => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-text-primary">Worktrees</h3>
        <p className="max-w-prose text-xs leading-5 text-text-tertiary">
          Session worktrees in every project. Removing one deletes its folder and keeps its branch.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <NewSessionsRunIn />
        <Button variant="secondary" size="xs" disabled={props.refreshing} onClick={props.onRefresh}>
          {props.refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
    </div>
  )
}

function InventoryProblems(props: {
  readonly error: unknown
  readonly problems: readonly string[]
}) {
  return (
    <>
      {props.error ? (
        <p role="alert" className="text-xs text-error-text">
          Could not list worktrees: {ipcErrorMessage(props.error)}
        </p>
      ) : null}
      {props.problems.length > 0 ? (
        // A status, not an alert: every refetch renders the same problems again.
        <p role="status" aria-label="Inventory problems" className="text-xs text-warning">
          {props.problems.join(' ')}
        </p>
      ) : null}
    </>
  )
}

function removalRequest(entry: WorktreeInventoryEntry): WorktreeRemovalRequest {
  return { path: entry.path, projectPath: entry.projectPath, skipCleanup: false, force: false }
}

/** The filters and the three groups of worktrees. */
function WorktreeList(props: {
  readonly projects: readonly WorktreeInventoryProject[]
  readonly project: string
  readonly onProjectChange: (project: string) => void
  readonly entries: readonly WorktreeInventoryEntry[]
  readonly context: WorktreeRowContext
}) {
  const [search, setSearch] = useState('')
  const visible = props.entries.filter((entry) => worktreeEntryMatchesSearch(entry, search))
  return (
    <>
      <WorktreeFilters
        projects={props.projects}
        project={props.project}
        onProjectChange={props.onProjectChange}
        search={search}
        onSearchChange={setSearch}
        shown={visible.length}
        total={props.entries.length}
      />
      {visible.length === 0 ? (
        <p className="text-xs text-text-tertiary">No worktrees match.</p>
      ) : (
        GROUPS.map((group) => (
          <WorktreeGroup
            key={group}
            group={group}
            entries={visible.filter((entry) => entry.group === group)}
            context={props.context}
          />
        ))
      )}
    </>
  )
}

/** Settings > Worktrees (ADR 0060): what worktrees cost, and removing the ones nothing needs. */
export function WorktreesSection() {
  const inventory = useWorktreeInventory()
  const rule = usePreferencesStore((state) => state.settings.automaticWorktreeRemoval)
  const setRule = usePreferencesStore((state) => state.setAutomaticWorktreeRemoval)
  const [chosenProject, setProject] = useState(ALL_PROJECTS)
  const [pending, setPending] = useState<WorktreeRemovalRequest | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const removal = useWorktreeRemoval()
  const projects = inventory.data?.projects ?? []
  // A project whose last worktree was removed leaves the list; so does the filter on it.
  const project = projects.some((entry) => entry.projectPath === chosenProject)
    ? chosenProject
    : ALL_PROJECTS
  const all = orderEntries(inventory.data?.entries ?? [], projects)
  const byGroup = GROUPS.flatMap((group) => all.filter((entry) => entry.group === group))
  const space = useWorktreeSpace(byGroup)
  const inProject = byGroup.filter(
    (entry) => project === ALL_PROJECTS || entry.projectPath === project,
  )
  const safe = inProject.filter((entry) => entry.group === 'safe')
  const now = inventory.dataUpdatedAt
  const context: WorktreeRowContext = {
    space,
    busyPaths: removal.busyPaths,
    projectNames: new Map(projects.map((entry) => [entry.projectPath, entry.name])),
    now,
    onRemove: (request) => void removal.remove(request),
    onConfirm: setPending,
  }

  return (
    <div className="space-y-5">
      <WorktreesHeader
        refreshing={inventory.isFetching}
        onRefresh={() => void inventory.refetch()}
      />
      <InventoryProblems
        error={inventory.isError ? inventory.error : null}
        problems={inventory.data?.problems ?? []}
      />
      {inventory.isPending ? (
        <p className="text-xs text-text-tertiary">Loading worktrees…</p>
      ) : (
        <>
          <WorktreeStorageCard
            totals={storageTotals(inProject, space)}
            safeCount={safe.length}
            worktreeCount={inProject.length}
            busy={removal.busyPaths.size > 0}
            onFreeSafe={() => setBulkOpen(true)}
          />
          <AutomaticRemovalCard
            rule={rule}
            onChange={(next) => void setRule(next)}
            entries={all}
            space={space}
            now={now}
          />
          {all.length === 0 ? (
            <p className="text-xs text-text-tertiary">No Session worktrees yet.</p>
          ) : (
            <WorktreeList
              projects={projects}
              project={project}
              onProjectChange={setProject}
              entries={inProject}
              context={context}
            />
          )}
        </>
      )}
      {pending ? (
        <WorktreeRemovalDialog
          request={pending}
          onConfirm={(request) => {
            setPending(null)
            void removal.remove(request)
          }}
          onClose={() => setPending(null)}
        />
      ) : null}
      {bulkOpen ? (
        <BulkWorktreeRemovalDialog
          entries={safe}
          space={space}
          onConfirm={() => {
            setBulkOpen(false)
            void removal.removeMany(safe.map(removalRequest), space)
          }}
          onClose={() => setBulkOpen(false)}
        />
      ) : null}
    </div>
  )
}
