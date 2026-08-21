/** MOCKUP — bits shared by the mockup files. Deleted with the rest of the mockup. */

export const EYEBROW = 'text-[10px] font-semibold tracking-[0.14em] uppercase'

export function SourceBadge({ children }: { readonly children: string }) {
  return (
    <span className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary">
      {children}
    </span>
  )
}
