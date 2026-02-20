import type { GitBranchMutationResult } from '@shared/types/git'
import { GitBranch, Loader2, RefreshCw } from 'lucide-react'
import { useRef } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { useGit } from '@/hooks/useGit'
import { useProject } from '@/hooks/useProject'
import { cn } from '@/lib/cn'
import { useComposerStore } from '@/stores/composer-store'

interface BranchPickerProps {
  onToast?: (message: string) => void
}

export function BranchPicker({ onToast }: BranchPickerProps): React.JSX.Element | null {
  const { projectPath } = useProject()
  const {
    status: gitStatus,
    branches: gitBranches,
    isLoading: isRefreshingGit,
    isBranchActionRunning,
    refreshStatus: refreshGitStatus,
    refreshBranches: refreshGitBranches,
    checkoutBranch,
  } = useGit()

  const branchMenuOpen = useComposerStore((s) => s.branchMenuOpen)
  const branchQuery = useComposerStore((s) => s.branchQuery)
  const openMenu = useComposerStore((s) => s.openMenu)
  const setBranchQuery = useComposerStore((s) => s.setBranchQuery)
  const setBranchMessage = useComposerStore((s) => s.setBranchMessage)
  const openActionDialog = useComposerStore((s) => s.openActionDialog)

  const menuRef = useRef<HTMLDivElement>(null)
  useClickOutside(menuRef, () => openMenu(null), branchMenuOpen)

  if (!projectPath) return null

  const gitBranch = gitStatus?.branch ?? null
  const branchQueryNormalized = branchQuery.trim().toLowerCase()
  const allBranches = gitBranches?.branches ?? []
  const filteredBranches =
    branchQueryNormalized.length > 0
      ? allBranches.filter((b) => b.name.toLowerCase().includes(branchQueryNormalized))
      : allBranches
  const localBranches = filteredBranches.filter((b) => !b.isRemote)
  const remoteBranches = filteredBranches.filter((b) => b.isRemote)

  const noProjectResult: GitBranchMutationResult = {
    ok: false,
    code: 'unknown',
    message: 'No project selected.',
  }

  async function runBranchMutation(
    run: () => Promise<GitBranchMutationResult>,
  ): Promise<GitBranchMutationResult> {
    setBranchMessage(null)
    try {
      const result = await run()
      setBranchMessage(result.message)
      onToast?.(result.message)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Branch operation failed.'
      setBranchMessage(message)
      onToast?.(message)
      return { ok: false, code: 'unknown', message }
    }
  }

  async function handleCheckout(name: string): Promise<void> {
    const result = await runBranchMutation(() =>
      projectPath ? checkoutBranch(projectPath, { name }) : Promise.resolve(noProjectResult),
    )
    if (result.ok) openMenu(null)
  }

  function handleRefreshGit(): void {
    void refreshGitStatus(projectPath)
    void refreshGitBranches(projectPath)
  }

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => openMenu(branchMenuOpen ? null : 'branch')}
          className="flex items-center gap-1 h-6 px-2 rounded-[5px] border border-border text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
          title="Manage branches"
        >
          <GitBranch className="h-[13px] w-[13px] text-text-tertiary" />
          <span>{gitBranch ?? 'branch'}</span>
          <span className="text-[9px] text-text-tertiary">&#x2228;</span>
        </button>

        {branchMenuOpen && (
          <div className="absolute bottom-full right-0 z-30 mb-1 w-[320px] rounded-xl border border-border-light bg-bg-secondary p-2 shadow-xl">
            <div className="mb-2 flex items-center gap-1.5">
              <input
                value={branchQuery}
                onChange={(event) => setBranchQuery(event.target.value)}
                placeholder="Search branches"
                className="h-8 flex-1 rounded-md border border-border bg-bg px-2 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
              />
              {isBranchActionRunning && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
              )}
            </div>
            <div className="mb-2 flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => openActionDialog('create-branch')}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  if (gitBranch) openActionDialog('rename-branch', gitBranch)
                }}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  if (gitBranch) openActionDialog('delete-branch')
                }}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => {
                  if (gitBranch) openActionDialog('set-upstream', `origin/${gitBranch}`)
                }}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
              >
                Upstream
              </button>
            </div>
            <div className="max-h-[220px] overflow-y-auto rounded-md border border-border bg-bg">
              {filteredBranches.length === 0 ? (
                <div className="px-2.5 py-2 text-[12px] text-text-tertiary">No branches found.</div>
              ) : (
                <>
                  {localBranches.length > 0 && (
                    <div>
                      <div className="border-b border-border px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-muted">
                        Local
                      </div>
                      {localBranches.map((branch) => (
                        <button
                          key={branch.fullName}
                          type="button"
                          onClick={() => {
                            void handleCheckout(branch.name)
                          }}
                          className={cn(
                            'flex w-full items-center justify-between border-b border-border px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover last:border-b-0',
                            branch.isCurrent ? 'text-accent' : 'text-text-secondary',
                          )}
                        >
                          <span className="truncate">{branch.name}</span>
                          {branch.isCurrent && <span>●</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {remoteBranches.length > 0 && (
                    <div>
                      <div className="border-b border-border px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-muted">
                        Remote
                      </div>
                      {remoteBranches.map((branch) => (
                        <button
                          key={branch.fullName}
                          type="button"
                          onClick={() => {
                            void handleCheckout(branch.name)
                          }}
                          className={cn(
                            'flex w-full items-center justify-between border-b border-border px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover last:border-b-0',
                            branch.isCurrent ? 'text-accent' : 'text-text-secondary',
                          )}
                        >
                          <span className="truncate">{branch.name}</span>
                          {branch.isCurrent && <span>●</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={isRefreshingGit}
        onClick={handleRefreshGit}
        className={cn(
          'flex h-5 w-5 items-center justify-center transition-colors',
          isRefreshingGit ? 'cursor-not-allowed opacity-60' : 'hover:text-text-secondary',
        )}
        title="Refresh git status"
      >
        <RefreshCw
          className={cn('h-3.5 w-3.5 text-text-tertiary', isRefreshingGit && 'animate-spin')}
        />
      </button>
    </>
  )
}
