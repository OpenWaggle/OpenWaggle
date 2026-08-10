import { useEffect, useState } from 'react'
import { type BaseRefChoice, buildBaseRefChoices } from '@/features/diff-panel/lib/base-ref-choices'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('diff-panel-base-ref-choices')
const EMPTY_CHOICES: readonly BaseRefChoice[] = []

/** Load the repository's branches and shape them into base-ref combobox choices (WS6b). */
export function useBaseRefChoices(projectPath: string | null): readonly BaseRefChoice[] {
  const [choices, setChoices] = useState<readonly BaseRefChoice[]>(EMPTY_CHOICES)

  useEffect(() => {
    if (!projectPath) {
      setChoices(EMPTY_CHOICES)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await api.listGitBranches(projectPath)
        if (!cancelled) setChoices(buildBaseRefChoices(result.branches))
      } catch (error) {
        logger.warn('Failed to load base-ref choices', { error: String(error) })
        if (!cancelled) setChoices(EMPTY_CHOICES)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectPath])

  return choices
}
