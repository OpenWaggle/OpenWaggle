import { useEffect } from 'react'
import { syncActionOutputViewRuns } from '@/features/terminal'
import { useActionPreview } from '../hooks/useActionPreview'
import { useActionProjectPath } from '../hooks/useActionProjectPath'
import { useActionRuns, useActionScope } from '../hooks/useNativeActions'

/**
 * Always-mounted Project action side effects that do not depend on any surface being shown:
 * automatic previews of ready runs, and Action output terminal views following restarts.
 */
export function ProjectActionsBackgroundEffects() {
  const scope = useActionScope(useActionProjectPath())
  const runs = useActionRuns(scope)
  useActionPreview(scope, runs.data ?? [])
  const sessionId = scope?.sessionId
  const runList = runs.data
  useEffect(() => {
    if (sessionId && runList) syncActionOutputViewRuns(sessionId, runList)
  }, [sessionId, runList])
  return null
}
