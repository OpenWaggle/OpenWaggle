import { SessionId, type WorkingPath } from '@shared/types/brand'
import type {
  ChangeRequestMergeMethod,
  ChangeRequestPanelResult,
  MergeChangeRequestResult,
  VcsChangeRequest,
  VcsChangeRequestDetails,
} from '@shared/types/git'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { invalidateVcsStatus } from '@/features/git'
import { queryKeys } from '@/queries/query-keys'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('change-request-panel')

interface ChangeRequestPanelControllerInput {
  readonly sessionId: string | null
  readonly workingPath: WorkingPath | null
  readonly requestUrl: string | null
  readonly open: boolean
}

function panelQueryOptions(input: ChangeRequestPanelControllerInput, bound: boolean) {
  return queryOptions({
    queryKey: [
      ...queryKeys.changeRequestPanels,
      input.sessionId,
      input.workingPath,
      input.requestUrl,
    ] as const,
    enabled: bound,
    queryFn: () => {
      if (!input.sessionId || !input.workingPath || !input.requestUrl) {
        throw new Error('The request is not bound to an opened Session.')
      }
      return api.getChangeRequestPanel(
        SessionId(input.sessionId),
        input.workingPath,
        input.requestUrl,
      )
    },
  })
}

function uniqueRequests(
  selected: VcsChangeRequestDetails | null,
  requests: readonly VcsChangeRequest[],
) {
  if (!selected) return []
  return [...new Map([selected, ...requests].map((item) => [item.url, item])).values()]
}

function mergeOutcomeMessage(response: MergeChangeRequestResult) {
  if (!response.ok) return response.message
  return response.changeRequest.state === 'merged'
    ? 'Merge completed.'
    : 'Merge submitted. The request remains open while the provider processes it.'
}

function isPanelBound(input: ChangeRequestPanelControllerInput) {
  return Boolean(input.open && input.sessionId && input.workingPath && input.requestUrl)
}

function effectiveMergeMethod(
  selected: VcsChangeRequestDetails | null,
  method: ChangeRequestMergeMethod,
) {
  if (!selected) return 'merge'
  return selected.merge.methods.includes(method) ? method : (selected.merge.methods[0] ?? 'merge')
}

function mergeDisabledReason(selected: VcsChangeRequestDetails | null) {
  if (!selected) return null
  if (selected.merge.reason) return selected.merge.reason
  return selected.merge.methods.length === 0
    ? 'The provider did not report a supported merge method.'
    : null
}

function canMerge(selected: VcsChangeRequestDetails | null) {
  return selected ? selected.merge.allowed && selected.merge.methods.length > 0 : false
}

function derivePanelView(
  result: ChangeRequestPanelResult | undefined,
  method: ChangeRequestMergeMethod,
) {
  const snapshot = result?.ok ? result.snapshot : null
  const selected = snapshot?.selected ?? null
  return {
    effectiveMethod: effectiveMergeMethod(selected, method),
    mergeAllowed: canMerge(selected),
    mergeDisabledReason: mergeDisabledReason(selected),
    requests: uniqueRequests(selected, snapshot?.changeRequests ?? []),
    selected,
    snapshot,
  }
}

export function useChangeRequestPanelController(input: ChangeRequestPanelControllerInput) {
  const [method, setMethod] = useState<ChangeRequestMergeMethod>('merge')
  const [merging, setMerging] = useState(false)
  const [mergeMessage, setMergeMessage] = useState<string | null>(null)
  const mergingRef = useRef(false)
  const bound = isPanelBound(input)
  const query = useQuery(panelQueryOptions(input, bound))
  const result = query.data
  const view = derivePanelView(result, method)

  async function merge() {
    if (
      !input.sessionId ||
      !input.workingPath ||
      !view.selected?.headCommit ||
      mergingRef.current
    ) {
      return
    }
    mergingRef.current = true
    setMerging(true)
    setMergeMessage(null)
    try {
      const response = await api.mergeChangeRequest(SessionId(input.sessionId), input.workingPath, {
        url: view.selected.url,
        expectedHeadCommit: view.selected.headCommit,
        method: view.effectiveMethod,
      })
      setMergeMessage(mergeOutcomeMessage(response))
      if (response.ok) await query.refetch()
    } catch (cause) {
      setMergeMessage(cause instanceof Error ? cause.message : 'Merge failed unexpectedly.')
    } finally {
      mergingRef.current = false
      setMerging(false)
    }
  }

  /** Drops the Host's cached source-control answers, then reloads the inspector. */
  async function recheckSourceControl() {
    const workingPath = input.workingPath
    if (!workingPath) {
      await query.refetch()
      return
    }
    await api.refreshSourceControlStatus(workingPath).catch((error: unknown) => {
      logger.warn('Could not drop the source-control status cache', { error: String(error) })
    })
    // A fix made here also reaches the Session Summary and Diff panel showing this tree.
    await Promise.all([query.refetch(), invalidateVcsStatus(workingPath)])
  }

  return {
    bound,
    ...view,
    recheckSourceControl,
    /** Session web-link owner, so the provider page opens wherever the user's links open. */
    ownerKey: input.sessionId ?? '',
    requestUrl: input.requestUrl,
    terminal:
      input.sessionId && input.workingPath
        ? { ownerKey: input.sessionId, cwd: String(input.workingPath) }
        : null,
    merge: () => void merge(),
    mergeMessage,
    merging,
    query,
    result,
    setMethod,
  }
}

export type ChangeRequestPanelController = ReturnType<typeof useChangeRequestPanelController>
