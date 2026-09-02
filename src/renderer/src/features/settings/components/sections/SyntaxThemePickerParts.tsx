import type {
  SyntaxAppearanceResource,
  SyntaxThemeImportPreview,
} from '@shared/types/syntax-resources'
import { Trash2 } from 'lucide-react'
import type { SyntaxLanguageResourceActivation } from '@/shared/lib/syntax/language-registry'
import { Button } from '@/shared/ui/Button'

export function SyntaxImportStatus({
  error,
  preview,
  onCancel,
  onApply,
}: {
  readonly error: string | null
  readonly preview: SyntaxThemeImportPreview | null
  readonly onCancel: () => void
  readonly onApply: () => void
}) {
  if (error) {
    return (
      <p className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
        {error}
      </p>
    )
  }
  if (!preview) return null
  return (
    <div className="rounded-lg border border-accent/35 bg-accent/5 p-3">
      <p className="text-xs font-medium text-text-primary">
        Import{' '}
        {[
          ...preview.themes.map((theme) => theme.label),
          ...preview.languages.map((language) => language.label),
          ...preview.appearances.map((appearance) => appearance.label),
        ].join(', ')}
      </p>
      <p className="mt-1 truncate font-mono text-xs text-text-muted">{preview.sourcePath}</p>
      {preview.replacements.length > 0 ? (
        <p className="mt-2 text-xs text-warning">
          Replaces {preview.replacements.length.toLocaleString()} existing theme{' '}
          {preview.replacements.length === 1 ? 'identity' : 'identities'}.
        </p>
      ) : null}
      {preview.warnings.map((warning) => (
        <p key={warning} className="mt-1 text-xs text-warning">
          {warning}
        </p>
      ))}
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="xs" variant="accent" onClick={onApply}>
          {preview.replacements.length > 0 ? 'Replace' : 'Install'}
        </Button>
      </div>
    </div>
  )
}

export function InstalledSyntaxResources({
  languages,
  appearances,
  onRemove,
}: {
  readonly languages: readonly SyntaxLanguageResourceActivation[]
  readonly appearances: readonly SyntaxAppearanceResource[]
  readonly onRemove: (
    resource: SyntaxLanguageResourceActivation['resource'] | SyntaxAppearanceResource,
  ) => void
}) {
  if (languages.length === 0 && appearances.length === 0) return null
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg">
      <p className="border-b border-border px-4 py-2 text-xs font-medium text-text-secondary">
        Installed package resources
      </p>
      {[
        ...languages.map(({ resource, disabledReason }) => ({
          resource,
          disabledReason,
          kind: 'Language grammar',
        })),
        ...appearances.map((resource) => ({
          resource,
          disabledReason: null,
          kind: 'Future app appearance',
        })),
      ].map(({ resource, disabledReason, kind }) => (
        <div
          key={resource.id}
          aria-disabled={disabledReason ? true : undefined}
          className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-b-0"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-text-primary">{resource.label}</span>
            <span className="block text-xs text-text-muted">
              {kind} · {resource.scope}
            </span>
            {disabledReason ? (
              <span className="block text-xs text-warning">{disabledReason}</span>
            ) : null}
          </span>
          {resource.scope === 'user' ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${resource.label}`}
              title={`Remove ${resource.label}`}
              onClick={() => onRemove(resource)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
