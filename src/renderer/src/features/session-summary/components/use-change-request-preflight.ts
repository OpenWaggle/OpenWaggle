import type { WorkingPath } from '@shared/types/brand'
import type {
  ChangeRequestPreflightResult,
  OpenChangeRequestPayload,
  SourceControlProviderId,
} from '@shared/types/git'
import { getChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'

const PREFLIGHT_PAYLOAD_DEBOUNCE_MS = 250
const PREFLIGHT_STALE_TIME_MS = 10_000

interface SettledPreflightInput {
  readonly sessionId: string
  readonly workingPath: WorkingPath
  readonly payload: OpenChangeRequestPayload
}

export interface ChangeRequestPreflightView {
  readonly status: 'checking' | 'ready' | 'blocked'
  readonly message: string
  readonly nativeCreationBlocked: boolean
  readonly browserUrl: string | null
}

function samePayload(left: OpenChangeRequestPayload, right: OpenChangeRequestPayload) {
  return (
    left.headRef === right.headRef &&
    left.baseRef === right.baseRef &&
    left.title === right.title &&
    left.body === right.body &&
    left.draft === right.draft
  )
}

function useSettledPreflightInput(
  sessionId: string,
  workingPath: WorkingPath,
  payload: OpenChangeRequestPayload,
) {
  const path = String(workingPath)
  const [settled, setSettled] = useState<SettledPreflightInput>(() => ({
    sessionId,
    workingPath,
    payload,
  }))
  const scopeIsSettled = settled.sessionId === sessionId && String(settled.workingPath) === path
  const payloadIsSettled = samePayload(settled.payload, payload)
  const headRef = payload.headRef
  const baseRef = payload.baseRef
  const title = payload.title
  const body = payload.body
  const draft = payload.draft

  useEffect(() => {
    const next = {
      sessionId,
      workingPath,
      payload: {
        headRef,
        baseRef,
        title,
        body,
        draft,
      },
    } satisfies SettledPreflightInput
    if (!scopeIsSettled) {
      setSettled(next)
      return
    }
    if (payloadIsSettled) return
    const timer = window.setTimeout(() => setSettled(next), PREFLIGHT_PAYLOAD_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [
    sessionId,
    workingPath,
    headRef,
    baseRef,
    title,
    body,
    draft,
    scopeIsSettled,
    payloadIsSettled,
  ])

  return settled
}

function changeRequestPreflightQueryOptions(input: SettledPreflightInput, enabled: boolean) {
  return queryOptions({
    queryKey: ['change-request-preflight', input] as const,
    queryFn: () => api.preflightChangeRequest(input.workingPath, input.payload),
    enabled,
    retry: false,
    staleTime: PREFLIGHT_STALE_TIME_MS,
  })
}

function blockedMessage(result: ChangeRequestPreflightResult) {
  if (!result.readiness.ok) return result.readiness.message
  const terminology = getChangeRequestTerminology(result.provider?.id)
  const host = result.provider?.host
  return `${terminology.providerName} CLI is not authenticated${host ? ` for ${host}` : ''}.`
}

function readyMessage(result: ChangeRequestPreflightResult) {
  if (!result.readiness.ok) return ''
  const terminology = getChangeRequestTerminology(result.provider?.id)
  const account = result.readiness.status.account
  const host = result.provider?.host
  if (account) return `${terminology.providerName} CLI ready as ${account}.`
  return `${terminology.providerName} CLI ready${host ? ` for ${host}` : ''}.`
}

export function useChangeRequestPreflight(
  sessionId: string,
  workingPath: WorkingPath,
  expectedProvider: SourceControlProviderId | null | undefined,
  payload: OpenChangeRequestPayload,
): ChangeRequestPreflightView {
  const settled = useSettledPreflightInput(sessionId, workingPath, payload)
  const currentPath = String(workingPath)
  const currentInputIsSettled =
    settled.sessionId === sessionId &&
    String(settled.workingPath) === currentPath &&
    samePayload(settled.payload, payload)
  const preflight = useQuery(changeRequestPreflightQueryOptions(settled, currentInputIsSettled))
  const expected = getChangeRequestTerminology(expectedProvider)

  if (!currentInputIsSettled || preflight.isPending) {
    return {
      status: 'checking',
      message: `Checking ${expected.providerName} CLI…`,
      nativeCreationBlocked: true,
      browserUrl: null,
    }
  }
  if (preflight.isError || !preflight.data) {
    return {
      status: 'blocked',
      message: `Could not check ${expected.providerName} CLI readiness.`,
      nativeCreationBlocked: true,
      browserUrl: null,
    }
  }
  if (!preflight.data.readiness.ok || !preflight.data.readiness.status.authenticated) {
    return {
      status: 'blocked',
      message: blockedMessage(preflight.data),
      nativeCreationBlocked: true,
      browserUrl: preflight.data.browserUrl,
    }
  }
  return {
    status: 'ready',
    message: readyMessage(preflight.data),
    nativeCreationBlocked: false,
    browserUrl: preflight.data.browserUrl,
  }
}
