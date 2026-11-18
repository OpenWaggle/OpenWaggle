import type { RepositoryPath } from '@shared/types/brand'
import { useEffect, useState } from 'react'
import { type BaseRefChoice, buildBaseRefChoices } from '@/features/diff-panel/lib/base-ref-choices'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('diff-panel-base-ref-choices')
const EMPTY_CHOICES: readonly BaseRefChoice[] = []
const NOT_LOADED: BaseRefChoices = { choices: EMPTY_CHOICES, loaded: false }

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

interface LoadedBaseRefChoices {
  readonly repositoryPath: RepositoryPath
  readonly choices: BaseRefChoices
}

/** Load the repository's branches and shape them into base-ref combobox choices (WS6b). */
export function useBaseRefChoices(repositoryPath: RepositoryPath | null) {
  const [state, setState] = useState<LoadedBaseRefChoices | null>(null)

  useEffect(() => {
    if (!repositoryPath) return

    let cancelled = false
    void (async () => {
      try {
        const result = await api.listGitBranches(repositoryPath)
        if (!cancelled) {
          setState({
            repositoryPath,
            choices: { choices: buildBaseRefChoices(result.branches), loaded: true },
          })
        }
      } catch (error) {
        logger.warn('Failed to load base-ref choices', { error: String(error) })
        if (!cancelled) setState({ repositoryPath, choices: NOT_LOADED })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repositoryPath])

  /*
   * Another repository's list is never shown, so `loaded` never describes a different repository's
   * branches. Keeping the previous value across the switch would have marked the *new*
   * repository's refs "(unavailable)" - a guess presented as fact, which is the regression this
   * flag exists to stop.
   */
  return state !== null && state.repositoryPath === repositoryPath ? state.choices : NOT_LOADED
}
