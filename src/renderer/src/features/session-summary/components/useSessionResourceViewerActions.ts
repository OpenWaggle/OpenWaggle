import { ATTACHMENT, BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useComposerStore } from '@/features/composer/state'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import {
  invalidateSessionResourceQueries,
  sessionResourceContentQueryOptions,
} from '../hooks/useSessionResources'

function useSessionResourceRetry(
  sessionId: string | null,
  resource: SessionResource | null,
  retryKey: string,
  refetch: () => Promise<unknown>,
) {
  const queryClient = useQueryClient()
  const retryingRef = useRef(false)
  const [retryState, setRetryState] = useState<{
    readonly key: string
    readonly retrying: boolean
    readonly error: string | null
  }>({ key: retryKey, retrying: false, error: null })
  const current =
    retryState.key === retryKey ? retryState : { key: retryKey, retrying: false, error: null }
  return {
    ...current,
    retry: async () => {
      if (!sessionId || !resource || retryingRef.current) return
      retryingRef.current = true
      setRetryState({ key: retryKey, retrying: true, error: null })
      try {
        await api.retrySessionResource(SessionId(sessionId), resource.id)
        await invalidateSessionResourceQueries(queryClient, sessionId)
        await refetch()
      } catch (cause) {
        setRetryState({
          key: retryKey,
          retrying: false,
          error: cause instanceof Error ? cause.message : 'Could not retry this image.',
        })
      } finally {
        retryingRef.current = false
        setRetryState((state) => (state.key === retryKey ? { ...state, retrying: false } : state))
      }
    },
  }
}

function viewerResourceFlags(resource: SessionResource | null, sessionIsActive: boolean) {
  const locator = resource?.locator ?? ''
  const remote = locator.startsWith('https://')
  return {
    enabled: sessionIsActive && resource?.kind === 'image' && (remote || resource.available),
    unavailable: !remote && resource?.available === false,
    remote,
    managed: resource?.managed === true || locator.startsWith('session-resource://'),
  }
}

function useRemoteResourceProjectionRefresh(
  sessionId: string | null,
  remote: boolean,
  hasContent: boolean,
) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!hasContent || !sessionId || !remote) return
    void invalidateSessionResourceQueries(queryClient, sessionId)
  }, [hasContent, queryClient, remote, sessionId])
}

function viewerSourceState(
  data: { readonly url: string; readonly downloadUrl: string } | null | undefined,
  state: { readonly pending: boolean; readonly error: boolean; readonly success: boolean },
  managed: boolean,
  unavailable: boolean,
) {
  return {
    source: data?.url ?? null,
    downloadUrl: data?.downloadUrl ?? null,
    loading: state.pending && !unavailable,
    failed: unavailable || state.error || (managed && state.success && data === null),
  }
}

export function useViewerSource(
  sessionId: string | null,
  resource: SessionResource | null,
  sessionIsActive: boolean,
) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const identity = {
    sessionId: sessionId ?? 'none',
    resourceId: resource?.id ?? 'none',
    updatedAt: resource?.updatedAt ?? 0,
  }
  const flags = viewerResourceFlags(resource, sessionIsActive)
  const retryKey = `${identity.sessionId}:${identity.resourceId}`
  const content = useQuery({
    ...sessionResourceContentQueryOptions(
      identity.sessionId,
      identity.resourceId,
      identity.updatedAt,
    ),
    enabled: flags.enabled,
  })
  useRemoteResourceProjectionRefresh(sessionId, flags.remote, Boolean(content.data))
  const retry = useSessionResourceRetry(sessionId, resource, retryKey, content.refetch)
  const source = viewerSourceState(
    content.data,
    { pending: content.isPending, error: content.isError, success: content.isSuccess },
    flags.managed,
    flags.unavailable,
  )
  return {
    ...source,
    failed: source.failed || (source.source !== null && failedSource === source.source),
    onImageError: () => setFailedSource(source.source),
    errorMessage:
      content.error?.message ??
      (failedSource === source.source && source.source
        ? 'The image could not be loaded. Retry to request a fresh copy.'
        : null),
    retrying: retry.retrying,
    retryError: retry.error,
    retry: retry.retry,
  }
}

export function useViewerResourceActions(
  sessionId: string | null,
  resource: SessionResource | null,
  activeSessionRef: { readonly current: string | null },
) {
  const showToast = useUIStore((state) => state.showToast)
  const [copying, setCopying] = useState(false)
  const [addingToChat, setAddingToChat] = useState(false)

  const copy = async () => {
    if (!sessionId || activeSessionRef.current !== sessionId || !resource || copying) return
    setCopying(true)
    try {
      await api.copySessionResourceImage(SessionId(sessionId), resource.id)
      if (activeSessionRef.current === sessionId) showToast('Image copied.', 'success')
    } catch (cause) {
      if (activeSessionRef.current === sessionId) {
        showToast(cause instanceof Error ? cause.message : 'Could not copy this image.', 'error')
      }
    } finally {
      setCopying(false)
    }
  }

  const addToChat = async () => {
    if (!sessionId || activeSessionRef.current !== sessionId || !resource || addingToChat) return
    if (useComposerStore.getState().attachments.length >= ATTACHMENT.MAX_COUNT) {
      showToast(`A message can include up to ${String(ATTACHMENT.MAX_COUNT)} attachments.`, 'error')
      return
    }
    setAddingToChat(true)
    try {
      const attachment = await api.prepareSessionResourceAttachment(
        SessionId(sessionId),
        resource.id,
      )
      let added = false
      try {
        const activeViewer = useUIStore.getState().resourceViewer
        if (
          activeSessionRef.current !== sessionId ||
          !activeViewer ||
          activeViewer.sessionId !== sessionId
        ) {
          return
        }
        const composer = useComposerStore.getState()
        if (composer.attachments.length >= ATTACHMENT.MAX_COUNT) {
          showToast(
            `A message can include up to ${String(ATTACHMENT.MAX_COUNT)} attachments.`,
            'error',
          )
          return
        }
        const totalSize = composer.attachments.reduce(
          (sum, candidate) => sum + candidate.sizeBytes,
          attachment.sizeBytes,
        )
        if (totalSize > ATTACHMENT.MAX_TOTAL_SIZE_BYTES) {
          const maxMegabytes =
            ATTACHMENT.MAX_TOTAL_SIZE_BYTES / (BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE)
          showToast(`Total attachment size exceeds ${String(maxMegabytes)} MB.`, 'error')
          return
        }
        composer.addAttachments([attachment])
        added = true
        showToast('Image added to chat.', 'success')
      } finally {
        if (!added) await api.discardPreparedAttachment(attachment)
      }
    } catch (cause) {
      if (activeSessionRef.current === sessionId) {
        showToast(cause instanceof Error ? cause.message : 'Could not add this image.', 'error')
      }
    } finally {
      setAddingToChat(false)
    }
  }

  return { copying, addingToChat, copy, addToChat }
}
