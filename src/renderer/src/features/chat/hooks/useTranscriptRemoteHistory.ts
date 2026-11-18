import { useEffect, useRef } from 'react'
import { rowKeyNodeId, type TranscriptRemoteHistory } from '../lib/transcript-remote-history'

/**
 * Reads older history from the Host when a saved reading position names a row the loaded window
 * does not hold yet, so the restore can find it (once per anchor).
 */
function useRemoteAnchorLoad(
  anchorKey: string | null,
  keys: readonly string[],
  remoteHistory: TranscriptRemoteHistory | null | undefined,
) {
  const requested = useRef<string | null>(null)
  const missing =
    anchorKey !== null && remoteHistory?.hasEarlier === true && !keys.includes(anchorKey)
  const nodeId = missing ? rowKeyNodeId(anchorKey) : null
  const loadThrough = remoteHistory?.loadThrough
  useEffect(() => {
    if (!nodeId || !loadThrough || requested.current === nodeId) return
    requested.current = nodeId
    loadThrough(nodeId)
  }, [nodeId, loadThrough])
}

/**
 * The transcript's top edge over both windows (ADR 0036, B5): mounted rows load first, and once
 * the loaded part of the path is exhausted, the Host's next older page.
 */
export function useTranscriptRemoteHistory(
  anchorKey: string | null,
  keys: readonly string[],
  input: { readonly remoteHistory?: TranscriptRemoteHistory | null },
  transcriptWindow: { readonly hasEarlier: boolean; readonly loadEarlier: () => void },
) {
  const remoteHistory = input.remoteHistory ?? null
  useRemoteAnchorLoad(anchorKey, keys, remoteHistory)
  const hasEarlier = transcriptWindow.hasEarlier || remoteHistory?.hasEarlier === true
  const loadEarlier = () => {
    if (transcriptWindow.hasEarlier) transcriptWindow.loadEarlier()
    else remoteHistory?.loadEarlier()
  }
  return { hasEarlier, loadEarlier }
}
