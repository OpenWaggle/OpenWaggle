/**
 * A live region that is always in the accessibility tree, so its content is announced when it
 * changes.
 *
 * `aria-live` on a conditionally mounted element does not work: a polite region has to exist before
 * its content changes, and a region inserted in the same commit as its text is not announced by
 * VoiceOver and is inconsistent on NVDA. Both the request ribbon and the notification stack are
 * mounted only when they have something to show, so the attribute on those elements announced
 * nothing at the two moments that matter most — a run stopping to ask, and an error arriving.
 *
 * Keep the visual surfaces free of `aria-live` so the content is announced once, here, rather than
 * twice.
 */
export function PoliteAnnouncer({ message }: { readonly message: string | null }) {
  return (
    <p aria-live="polite" className="sr-only" role="status">
      {message ?? ''}
    </p>
  )
}
