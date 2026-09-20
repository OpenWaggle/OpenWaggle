import { type RefObject, useEffect } from 'react'
import { useComposerActionStore } from '../state/composer-action-store'

export function useSessionScopedFilePicker(
  sessionId: string | null,
  fileInputRef: RefObject<HTMLInputElement | null>,
) {
  const request = useComposerActionStore((state) => state.filePickerRequest)
  const takeRequest = useComposerActionStore((state) => state.takeFilePickerRequest)

  useEffect(() => {
    if (!request) return
    if (takeRequest(request.id, sessionId)) fileInputRef.current?.click()
  }, [fileInputRef, request, sessionId, takeRequest])
}
