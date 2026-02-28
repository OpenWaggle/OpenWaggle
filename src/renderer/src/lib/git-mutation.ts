/**
 * Utility for running branch mutations with standardised
 * feedback messages through the composer store.
 */

interface BranchMutationOptions {
  action: () => Promise<{ success: boolean; error?: string }>
  composerStore: { setBranchMessage: (msg: string | null) => void }
  onSuccess?: () => void
  successMessage?: string
}

export async function runBranchMutation(options: BranchMutationOptions): Promise<void> {
  const { action, composerStore, onSuccess, successMessage } = options
  composerStore.setBranchMessage(null)

  const result = await action()
  if (result.success) {
    composerStore.setBranchMessage(successMessage ?? null)
    onSuccess?.()
  } else {
    composerStore.setBranchMessage(result.error ?? 'Operation failed')
  }
}
