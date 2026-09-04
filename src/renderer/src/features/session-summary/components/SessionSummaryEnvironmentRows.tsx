import type { GitBranchInfo, SessionEnvironmentMode } from '@shared/types/git'
import {
  Check,
  ChevronDown,
  Copy,
  FolderOpen,
  GitBranch,
  GitFork,
  Laptop,
  Loader2,
  Plus,
  Search,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { DENSE_MENU_ITEM_CLASS, MENU_SECTION_LABEL_CLASS } from '@/shared/ui/menu-styles'
import { Popover } from '@/shared/ui/Popover'
import { SessionSummaryBranchOption } from './SessionSummaryBranchOption'

const SUMMARY_POPOVER_CLASS = 'w-72 overflow-hidden p-1.5'
const SUMMARY_TRIGGER_CLASS =
  'flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-text-secondary transition-colors hover:bg-bg-hover'

const ENVIRONMENT_LABEL: Record<SessionEnvironmentMode, string> = {
  local: 'Local',
  worktree: 'Worktree',
}

export function SessionEnvironmentRow({
  environmentMode,
  workingPath,
}: {
  readonly environmentMode: SessionEnvironmentMode
  readonly workingPath: string | null
}) {
  const [open, setOpen] = useState(false)
  const Icon = environmentMode === 'worktree' ? GitFork : Laptop
  const label = ENVIRONMENT_LABEL[environmentMode]

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      role="dialog"
      ariaLabel="Session environment details"
      className={SUMMARY_POPOVER_CLASS}
      trigger={({ isOpen, toggle }) => (
        <Button
          variant="unstyled"
          type="button"
          className={SUMMARY_TRIGGER_CLASS}
          aria-label={`Environment: ${label}`}
          aria-expanded={isOpen}
          onClick={toggle}
        >
          <Icon aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-text-muted" />
        </Button>
      )}
    >
      <div className={MENU_SECTION_LABEL_CLASS}>Session environment</div>
      <div className="rounded-md bg-bg-tertiary/60 px-2.5 py-2">
        <div className="flex items-center gap-2 text-sm text-text-primary">
          <Icon aria-hidden="true" className="size-4 shrink-0" />
          <span>{label}</span>
          <Check aria-hidden="true" className="ml-auto size-3.5 text-accent" />
        </div>
        <p className="mt-1 text-xs text-text-tertiary">
          The environment is fixed after the first message. Choose another mode when starting a new
          session.
        </p>
      </div>
      {workingPath ? (
        <p
          className="truncate px-2.5 py-2 font-mono text-xs text-text-tertiary"
          title={workingPath}
        >
          {workingPath}
        </p>
      ) : null}
    </Popover>
  )
}

export function SessionEnvironmentActions({
  workingPath,
  onToggleTerminal,
}: {
  readonly workingPath: string | null
  readonly onToggleTerminal: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      role="menu"
      className={SUMMARY_POPOVER_CLASS}
      trigger={({ isOpen, toggle }) => (
        <Button
          variant="unstyled"
          type="button"
          className="grid size-7 place-items-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
          aria-label="Environment actions"
          aria-expanded={isOpen}
          onClick={toggle}
        >
          <Plus aria-hidden="true" className="size-4" />
        </Button>
      )}
    >
      <div className={MENU_SECTION_LABEL_CLASS}>Environment actions</div>
      <Button
        variant="unstyled"
        role="menuitem"
        className={DENSE_MENU_ITEM_CLASS}
        onClick={() => {
          setOpen(false)
          onToggleTerminal()
        }}
      >
        <span className="size-4 shrink-0 font-mono text-xs" aria-hidden="true">
          &gt;_
        </span>
        Toggle terminal
      </Button>
      {workingPath ? (
        <>
          <Button
            variant="unstyled"
            role="menuitem"
            className={DENSE_MENU_ITEM_CLASS}
            onClick={() => {
              setOpen(false)
              void api.openPath(workingPath)
            }}
          >
            <FolderOpen aria-hidden="true" className="size-4 shrink-0" />
            Open working folder
          </Button>
          <Button
            variant="unstyled"
            role="menuitem"
            className={DENSE_MENU_ITEM_CLASS}
            onClick={() => {
              setOpen(false)
              void navigator.clipboard.writeText(workingPath)
            }}
          >
            <Copy aria-hidden="true" className="size-4 shrink-0" />
            Copy working path
          </Button>
        </>
      ) : null}
    </Popover>
  )
}

interface SessionBranchRowProps {
  readonly branch: string | null
  readonly branches: readonly GitBranchInfo[]
  readonly busy: boolean
  readonly error: string | null
  readonly onRefresh: () => void
  readonly onSelect: (branch: string) => Promise<boolean>
  readonly onCreate: (branch: string) => Promise<boolean>
}

export function SessionBranchRow({
  branch,
  branches,
  busy,
  error,
  onRefresh,
  onSelect,
  onCreate,
}: SessionBranchRowProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filteredBranches = useMemo(
    () =>
      normalizedQuery.length === 0
        ? branches
        : branches.filter((candidate) => candidate.name.toLowerCase().includes(normalizedQuery)),
    [branches, normalizedQuery],
  )
  const exactMatch = branches.some((candidate) => candidate.name.toLowerCase() === normalizedQuery)

  function changeOpen(next: boolean) {
    setOpen(next)
    if (next) onRefresh()
    else setQuery('')
  }

  async function finish(action: Promise<boolean>) {
    if (await action) changeOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={changeOpen}
      placement="bottom-end"
      role="dialog"
      ariaLabel="Choose a session branch"
      className={SUMMARY_POPOVER_CLASS}
      trigger={({ isOpen, toggle }) => (
        <Button
          variant="unstyled"
          type="button"
          className={SUMMARY_TRIGGER_CLASS}
          aria-label={`Branch: ${branch ?? 'Detached HEAD'}`}
          aria-expanded={isOpen}
          onClick={toggle}
        >
          <GitBranch aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
          <span className="min-w-0 flex-1 truncate">{branch ?? 'Detached HEAD'}</span>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-text-muted" />
          )}
        </Button>
      )}
    >
      <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-bg px-2.5">
        <Search aria-hidden="true" className="size-3.5 shrink-0 text-text-muted" />
        <span className="sr-only">Search branches</span>
        <input
          aria-label="Search branches"
          className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none"
          value={query}
          disabled={busy}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {error ? <p className="px-2.5 py-2 text-xs text-error-text">{error}</p> : null}
      <div className="mt-1 max-h-56 overflow-y-auto overscroll-contain">
        {filteredBranches.map((candidate) => (
          <SessionSummaryBranchOption
            key={`${candidate.isRemote ? 'remote' : 'local'}:${candidate.name}`}
            input={{
              candidate,
              currentBranch: branch,
              busy,
              onSelect,
              onFinish: (action) => void finish(action),
            }}
          />
        ))}
        {normalizedQuery && !exactMatch ? (
          <Button
            variant="unstyled"
            type="button"
            disabled={busy}
            className={DENSE_MENU_ITEM_CLASS}
            onClick={() => void finish(onCreate(query.trim()))}
          >
            <Plus aria-hidden="true" className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Create {query.trim()}</span>
          </Button>
        ) : null}
        {filteredBranches.length === 0 && !normalizedQuery ? (
          <p className="px-2.5 py-3 text-xs text-text-tertiary">No branches found.</p>
        ) : null}
      </div>
      {branch ? (
        <Button
          variant="unstyled"
          type="button"
          className={DENSE_MENU_ITEM_CLASS}
          onClick={() => {
            changeOpen(false)
            void navigator.clipboard.writeText(branch)
          }}
        >
          <Copy aria-hidden="true" className="size-4 shrink-0" />
          Copy branch name
        </Button>
      ) : null}
    </Popover>
  )
}
