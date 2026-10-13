import { extractInnerErrorMessage } from '@shared/domain/error-message-extraction'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'

/**
 * The error a failed Waggle turn ended with, in place of an empty turn. A provider that answers
 * with JSON (`401: {"message": …}`) is shown by its message; the raw error stays under details.
 */
export function FailedTurnNotice({ error }: { readonly error: string }) {
  const message = extractInnerErrorMessage(error)?.message ?? error
  return (
    <div
      role="alert"
      className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error"
    >
      <p>This turn failed: {message}</p>
      {message === error ? null : (
        <details className="mt-1 text-xs text-text-secondary">
          <summary className="cursor-pointer select-none">Details</summary>
          <PlainTextBlock reason="error" className="mt-1 whitespace-pre-wrap break-all">
            {error}
          </PlainTextBlock>
        </details>
      )}
    </div>
  )
}
