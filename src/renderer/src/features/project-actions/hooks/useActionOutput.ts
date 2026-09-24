import type { ActionManagementScope } from '@shared/types/action-management'
import { type ActionRun, isActiveActionRun } from '@shared/types/action-runs'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'

const OUTPUT_REFRESH_MS = 750
const RETAINED_OUTPUT_CHARACTERS = 128 * 1_024

export function useActionOutput(scope: ActionManagementScope, runId: string) {
  const [state, setState] = useState<{
    readonly run: ActionRun | null
    readonly output: string
    readonly truncated: boolean
    readonly error: string | null
  }>({ run: null, output: '', truncated: false, error: null })
  const { projectPath, sessionId } = scope
  useEffect(() => {
    let disposed = false
    let offset = 0
    let output = ''
    let truncated = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      let hasMore = false
      let shouldPoll = true
      try {
        const result = await api.manageProjectActions({
          scope: { projectPath, ...(sessionId ? { sessionId } : {}) },
          operation: { type: 'output', runId, afterOffset: offset },
        })
        if (disposed) return
        if (result.type !== 'output') throw new Error('Unexpected action output response.')
        const page = result.output
        if (page.startOffset > offset && output)
          output += '\n[Output gap: older retained output was trimmed.]\n'
        if (page.endOffset < offset) output = ''
        output = (output + page.output).slice(-RETAINED_OUTPUT_CHARACTERS)
        truncated ||= page.truncated || output.length === RETAINED_OUTPUT_CHARACTERS
        offset = page.endOffset
        hasMore = page.hasMore
        shouldPoll = hasMore || isActiveActionRun(page.run)
        setState({ run: page.run, output, truncated, error: null })
      } catch (error) {
        if (disposed) return
        setState((previous) => ({
          ...previous,
          error: error instanceof Error ? error.message : 'Connection interrupted.',
        }))
      }
      if (!disposed && shouldPoll)
        timer = setTimeout(
          () => {
            void poll()
          },
          hasMore ? 0 : OUTPUT_REFRESH_MS,
        )
    }
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [projectPath, sessionId, runId])
  return state
}
