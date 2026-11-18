import type { ReactNode } from 'react'

/** One labelled editor control with an optional hint underneath. */
export function EditorField({
  label,
  htmlFor,
  hint,
  children,
}: {
  readonly label: string
  readonly htmlFor?: string
  readonly hint?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div className="space-y-1">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="block text-xs font-medium text-text-secondary">
          {label}
        </label>
      ) : (
        <span className="block text-xs font-medium text-text-secondary">{label}</span>
      )}
      {children}
      {hint ? <p className="text-xs text-text-tertiary">{hint}</p> : null}
    </div>
  )
}
