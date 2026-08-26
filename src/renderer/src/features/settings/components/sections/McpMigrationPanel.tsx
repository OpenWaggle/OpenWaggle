import type { McpImportCandidate, McpImportPreview } from '@shared/types/mcp'
import { Download, Search } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { tildifyPath } from '@/shared/lib/tildify-path'
import { Button } from '@/shared/ui/Button'

interface McpMigrationPanelProps {
  readonly projectPath: string | null
  readonly settingsBusy: boolean
  readonly onImported: () => Promise<void>
}

function candidatesForTarget(
  preview: McpImportPreview,
  target: McpImportCandidate['suggestedTarget'],
) {
  return preview.candidates.filter((candidate) => candidate.suggestedTarget === target)
}

function McpMigrationReview({
  preview,
  disabled,
  onImport,
}: {
  readonly preview: McpImportPreview
  readonly disabled: boolean
  readonly onImport: () => void
}) {
  if (preview.candidates.length === 0) return null
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <ul className="max-h-48 space-y-2 overflow-y-auto">
        {preview.candidates.map((candidate) => (
          <li key={candidate.fingerprint} className="text-xs leading-4">
            <p className="font-medium text-text-primary">
              {candidate.name} · {candidate.suggestedTarget}
            </p>
            <p className="truncate text-text-muted" title={tildifyPath(candidate.sourcePath)}>
              {tildifyPath(candidate.sourcePath)}
            </p>
            {candidate.warnings.map((warning) => (
              <p key={warning} className="text-warning">
                {warning}
              </p>
            ))}
          </li>
        ))}
      </ul>
      <Button
        variant="accent"
        size="xs"
        disabled={disabled}
        onClick={onImport}
        leftIcon={<Download className="size-3" />}
      >
        Import {preview.candidates.length} legacy{' '}
        {preview.candidates.length === 1 ? 'server' : 'servers'}
      </Button>
    </div>
  )
}

export function McpMigrationPanel({
  projectPath,
  settingsBusy,
  onImported,
}: McpMigrationPanelProps) {
  const [preview, setPreview] = useState<McpImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function scan() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const nextPreview = await api.previewMcpImports({ projectPath, sources: ['pi'] })
      setPreview(nextPreview)
      setMessage(
        nextPreview.candidates.length === 0
          ? 'No legacy MCP server definitions were found.'
          : `Found ${String(nextPreview.candidates.length)} legacy MCP server ${nextPreview.candidates.length === 1 ? 'definition' : 'definitions'} for review.`,
      )
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError))
    } finally {
      setBusy(false)
    }
  }

  async function importCandidates() {
    if (!preview || preview.candidates.length === 0) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const requests = (['global', 'project'] as const).flatMap((target) => {
        const candidates = candidatesForTarget(preview, target)
        return candidates.length === 0
          ? []
          : [
              api.applyMcpImports({
                projectPath,
                sources: ['pi'],
                fingerprints: candidates.map((candidate) => candidate.fingerprint),
                target,
                conflictPolicy: 'skip',
              }),
            ]
      })
      const results = await Promise.all(requests)
      const imported = results.reduce((total, result) => total + result.imported.length, 0)
      const skipped = results.reduce((total, result) => total + result.skipped.length, 0)
      setPreview(null)
      setMessage(
        `Imported ${String(imported)} legacy MCP server ${imported === 1 ? 'definition' : 'definitions'} as disabled and untrusted.${skipped > 0 ? ` Skipped ${String(skipped)} because an existing definition was kept or the source changed.` : ''}`,
      )
      await onImported()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError))
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || settingsBusy
  return (
    <section aria-labelledby="mcp-migration-heading" className="space-y-3">
      <div>
        <h3 id="mcp-migration-heading" className="text-base font-semibold text-text-primary">
          Migrate existing MCP configuration
        </h3>
        <p className="mt-1 max-w-190 text-xs leading-5 text-text-tertiary">
          The old MCP adapter is no longer loaded. Scan its global and project configuration,
          including disabled servers, before removing old files. Imports are previewed and remain
          disabled and untrusted until you explicitly enable and trust them.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-bg p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs leading-4 text-text-tertiary">
            Scanning is read-only. Existing target definitions win on conflicts, and source paths
            remain recorded as provenance.
          </p>
          <Button
            variant="secondary"
            size="xs"
            disabled={disabled}
            onClick={() => void scan()}
            leftIcon={<Search className="size-3" />}
          >
            Scan legacy MCP configs
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-xs text-error-text">
            Legacy MCP scan or import failed: {error}
          </p>
        )}
        {message && (
          <p role="status" className="mt-3 text-xs text-text-secondary">
            {message}
          </p>
        )}
        {preview && (
          <McpMigrationReview
            preview={preview}
            disabled={disabled}
            onImport={() => void importCandidates()}
          />
        )}
      </div>
    </section>
  )
}
