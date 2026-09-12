import type { WorkingPath } from '@shared/types/brand'
import type {
  ChangeRequestPreflightPayload,
  ChangeRequestPreflightResult,
  SourceControlProviderId,
} from '@shared/types/git'
import {
  buildHostedChangeRequestUrl,
  repositoryUrlFromChangeRequestUrl,
} from '@shared/utils/change-request-browser-url'
import { getChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'

const PREFLIGHT_PAYLOAD_DEBOUNCE_MS = 250
const PREFLIGHT_STALE_TIME_MS = 10_000

interface SettledPreflightInput {
  readonly sessionId: string
  readonly workingPath: WorkingPath
  readonly provider: SourceControlProviderId | null
  readonly headRef: string
  readonly baseRef: string | undefined
  readonly createFeatureBranch: boolean | undefined
}

export interface ChangeRequestPreflightView {
  readonly status: 'checking' | 'ready' | 'blocked'
  readonly message: string
  readonly nativeCreationBlocked: boolean
  readonly browserUrl: string | null
  readonly plannedHeadRef: string | null
}

function sameCapabilityInput(
  left: SettledPreflightInput,
  sessionId: string,
  workingPath: WorkingPath,
  provider: SourceControlProviderId | null,
  payload: ChangeRequestPreflightPayload,
) {
  return (
    left.sessionId === sessionId &&
    String(left.workingPath) === String(workingPath) &&
    left.provider === provider &&
    left.headRef === payload.headRef &&
    left.baseRef === payload.baseRef &&
    left.createFeatureBranch === payload.createFeatureBranch
  )
}

function useSettledPreflightInput(
  sessionId: string,
  workingPath: WorkingPath,
  provider: SourceControlProviderId | null,
  payload: ChangeRequestPreflightPayload,
) {
  const path = String(workingPath)
  const [settled, setSettled] = useState<SettledPreflightInput>(() => ({
    sessionId,
    workingPath,
    provider,
    headRef: payload.headRef,
    baseRef: payload.baseRef,
    createFeatureBranch: payload.createFeatureBranch,
  }))
  const scopeIsSettled = settled.sessionId === sessionId && String(settled.workingPath) === path
  const capabilityIsSettled = sameCapabilityInput(
    settled,
    sessionId,
    workingPath,
    provider,
    payload,
  )
  const headRef = payload.headRef
  const baseRef = payload.baseRef
  const createFeatureBranch = payload.createFeatureBranch

  useEffect(() => {
    const next = {
      sessionId,
      workingPath,
      provider,
      headRef,
      baseRef,
      createFeatureBranch,
    } satisfies SettledPreflightInput
    if (!scopeIsSettled) {
      setSettled(next)
      return
    }
    if (capabilityIsSettled) return
    const timer = window.setTimeout(() => setSettled(next), PREFLIGHT_PAYLOAD_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [
    sessionId,
    workingPath,
    provider,
    headRef,
    baseRef,
    createFeatureBranch,
    scopeIsSettled,
    capabilityIsSettled,
  ])

  return settled
}

function changeRequestPreflightQueryOptions(input: SettledPreflightInput, enabled: boolean) {
  return queryOptions({
    queryKey: ['change-request-preflight', input] as const,
    queryFn: () =>
      api.preflightChangeRequest(input.workingPath, {
        headRef: input.headRef,
        baseRef: input.baseRef,
        createFeatureBranch: input.createFeatureBranch,
        title: '',
        body: '',
        draft: false,
      }),
    enabled,
    retry: false,
    staleTime: PREFLIGHT_STALE_TIME_MS,
  })
}

function browserUrlForCurrentPayload(
  result: ChangeRequestPreflightResult,
  payload: ChangeRequestPreflightPayload,
) {
  if (!result.provider || !result.browserUrl) return result.browserUrl
  const repositoryUrl = repositoryUrlFromChangeRequestUrl(result.provider.id, result.browserUrl)
  if (!repositoryUrl) return result.browserUrl
  return buildHostedChangeRequestUrl(
    result.provider.id,
    repositoryUrl,
    { ...payload, headRef: result.plannedHeadRef },
    false,
  )
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
  payload: ChangeRequestPreflightPayload,
  blockedReason: string | null = null,
): ChangeRequestPreflightView {
  const provider = expectedProvider ?? null
  const settled = useSettledPreflightInput(sessionId, workingPath, provider, payload)
  const currentPath = String(workingPath)
  const currentInputIsSettled =
    settled.sessionId === sessionId &&
    String(settled.workingPath) === currentPath &&
    sameCapabilityInput(settled, sessionId, workingPath, provider, payload)
  const preflight = useQuery(
    changeRequestPreflightQueryOptions(settled, currentInputIsSettled && blockedReason === null),
  )
  const expected = getChangeRequestTerminology(expectedProvider)

  if (blockedReason) {
    return {
      status: 'blocked',
      message: blockedReason,
      nativeCreationBlocked: true,
      browserUrl: null,
      plannedHeadRef: null,
    }
  }

  if (!currentInputIsSettled || preflight.isPending) {
    return {
      status: 'checking',
      message: `Checking ${expected.providerName} CLI…`,
      nativeCreationBlocked: true,
      browserUrl: null,
      plannedHeadRef: null,
    }
  }
  if (preflight.isError || !preflight.data) {
    return {
      status: 'blocked',
      message: `Could not check ${expected.providerName} CLI readiness.`,
      nativeCreationBlocked: true,
      browserUrl: null,
      plannedHeadRef: null,
    }
  }
  if (!preflight.data.readiness.ok || !preflight.data.readiness.status.authenticated) {
    return {
      status: 'blocked',
      message: blockedMessage(preflight.data),
      nativeCreationBlocked: true,
      browserUrl: browserUrlForCurrentPayload(preflight.data, payload),
      plannedHeadRef: preflight.data.plannedHeadRef,
    }
  }
  return {
    status: 'ready',
    message: readyMessage(preflight.data),
    nativeCreationBlocked: false,
    browserUrl: browserUrlForCurrentPayload(preflight.data, payload),
    plannedHeadRef: preflight.data.plannedHeadRef,
  }
}
