import type { RepositoryPath } from '@shared/types/brand'
import { useEffect, useState } from 'react'
import { type BaseRefChoice, buildBaseRefChoices } from '@/features/diff-panel/lib/base-ref-choices'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('diff-panel-base-ref-choices')
const EMPTY_CHOICES: readonly BaseRefChoice[] = []

export interface BaseRefChoices {
  readonly choices: readonly BaseRefChoice[]
  /**
   * Whether the branch list was actually read.
   *
   * Needed to tell "this ref no longer exists" apart from "the list has not loaded, or could not be
   * loaded". Collapsing both to an empty list made the control label a perfectly valid ref
   * "(unavailable)" - permanently, if listing the branches failed - which is a guess presented as
   * fact, in the one control whose whole job is saying which base a diff was taken against.
   */
  readonly loaded: boolean
}

/** Load the repository's branches and shape them into base-ref combobox choices (WS6b). */
export function useBaseRefChoices(repositoryPath: RepositoryPath | null): BaseRefChoices {
  const [state, setState] = useState<BaseRefChoices>({ choices: EMPTY_CHOICES, loaded: false })

  useEffect(() => {
    if (!repositoryPath) {
      setState({ choices: EMPTY_CHOICES, loaded: false })
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await api.listGitBranches(repositoryPath)
        if (!cancelled) setState({ choices: buildBaseRefChoices(result.branches), loaded: true })
      } catch (error) {
        logger.warn('Failed to load base-ref choices', { error: String(error) })
        if (!cancelled) setState({ choices: EMPTY_CHOICES, loaded: false })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repositoryPath])

  return state
}
