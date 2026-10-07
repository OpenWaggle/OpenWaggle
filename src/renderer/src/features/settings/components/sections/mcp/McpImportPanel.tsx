import type { McpConfigFileScope } from '@shared/types/mcp-configuration'
import type {
  McpImportCandidateView,
  McpImportNameConflictPolicy,
} from '@shared/types/mcp-configuration-operations'
import { useState } from 'react'
import { tildifyPath } from '@/shared/lib/tildify-path'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Select } from '@/shared/ui/Select'
import { useMcpImports } from '../../../hooks/useMcpImports'
import { MCP_IMPORT_SOURCE_LABELS, MCP_IMPORT_STATUS_LABELS } from '../../../lib/mcp-server-model'
import { McpInlineError } from './McpLabels'

function selectable(candidate: McpImportCandidateView) {
  return candidate.status !== 'imported'
}

function CandidateRow({
  candidate,
  checked,
  onToggle,
}: {
  readonly candidate: McpImportCandidateView
  readonly checked: boolean
  readonly onToggle: (fingerprint: string, checked: boolean) => void
}) {
  return (
    <li className="flex items-start gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
      <Checkbox
        aria-label={`Import ${candidate.name} from ${MCP_IMPORT_SOURCE_LABELS[candidate.source]}`}
        className="mt-0.5"
        checked={checked}
        disabled={!selectable(candidate)}
        onChange={(event) => onToggle(candidate.fingerprint, event.target.checked)}
      />
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs text-text-primary">
          <span className="font-medium">{candidate.targetName}</span>
          <span className="ml-1.5 text-text-tertiary">
            {MCP_IMPORT_SOURCE_LABELS[candidate.source]} ·{' '}
            {MCP_IMPORT_STATUS_LABELS[candidate.status]}
          </span>
        </p>
        <p className="truncate font-mono text-xs text-text-muted">{candidate.target}</p>
        <p className="truncate text-xs text-text-muted" title={candidate.sourcePath}>
          {tildifyPath(candidate.sourcePath)}
        </p>
        {candidate.warnings.map((warning) => (
          <p key={warning} className="text-xs text-warning">
            {warning}
          </p>
        ))}
      </div>
    </li>
  )
}

function ImportOptions({
  hasProject,
  target,
  conflictPolicy,
  onTarget,
  onConflictPolicy,
}: {
  readonly hasProject: boolean
  readonly target: McpConfigFileScope
  readonly conflictPolicy: McpImportNameConflictPolicy
  readonly onTarget: (target: McpConfigFileScope) => void
  readonly onConflictPolicy: (policy: McpImportNameConflictPolicy) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
      <span>Import into</span>
      <Select
        selectSize="xs"
        aria-label="Import into"
        value={target}
        onChange={(event) => onTarget(event.target.value === 'project' ? 'project' : 'global')}
      >
        <option value="global">All projects</option>
        <option value="project" disabled={!hasProject}>
          This project
        </option>
      </Select>
      <span>If the name is in use</span>
      <Select
        selectSize="xs"
        aria-label="If the name is in use"
        value={conflictPolicy}
        onChange={(event) =>
          onConflictPolicy(
            event.target.value === 'replace' || event.target.value === 'rename'
              ? event.target.value
              : 'skip',
          )
        }
      >
        <option value="skip">Skip it</option>
        <option value="replace">Replace it</option>
        <option value="rename">Keep both</option>
      </Select>
    </div>
  )
}

/** Servers from Codex, Claude, Cursor, VS Code, OpenCode, Zed, and Windsurf, copied into OpenWaggle. */
export function McpImportPanel({
  projectPath,
  onClose,
}: {
  readonly projectPath: string | null
  readonly onClose: () => void
}) {
  const imports = useMcpImports(projectPath, true)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [target, setTarget] = useState<McpConfigFileScope>('global')
  const [conflictPolicy, setConflictPolicy] = useState<McpImportNameConflictPolicy>('skip')
  const candidates = imports.preview?.candidates ?? []
  const toggle = (fingerprint: string, checked: boolean) => {
    const next = new Set(chosen)
    if (checked) next.add(fingerprint)
    else next.delete(fingerprint)
    setChosen(next)
  }
  return (
    <section
      aria-labelledby="mcp-import-heading"
      className="space-y-3 rounded-lg border border-border bg-bg px-4 py-4"
    >
      <div>
        <h3 id="mcp-import-heading" className="text-sm font-semibold text-text-primary">
          Import from other apps
        </h3>
        <p className="mt-0.5 text-xs text-text-tertiary">
          Copies servers into OpenWaggle&apos;s file. Files OpenWaggle already reads, such as
          .mcp.json, are not listed.
        </p>
      </div>
      {imports.isLoading ? (
        <p className="text-xs text-text-tertiary">Looking for servers…</p>
      ) : null}
      <McpInlineError message={imports.loadError} />
      {imports.preview && candidates.length === 0 ? (
        <p className="text-xs text-text-muted">No servers found in other apps.</p>
      ) : null}
      {candidates.length > 0 ? (
        <ul aria-label="Servers found" className="overflow-hidden rounded-lg border border-border">
          {candidates.map((candidate) => (
            <CandidateRow
              key={candidate.fingerprint}
              candidate={candidate}
              checked={chosen.has(candidate.fingerprint)}
              onToggle={toggle}
            />
          ))}
        </ul>
      ) : null}
      {imports.preview?.errors.map((error) => (
        <p key={`${error.source}:${error.path}`} className="text-xs text-error-text">
          {MCP_IMPORT_SOURCE_LABELS[error.source]}: {error.message}
        </p>
      ))}
      <ImportOptions
        hasProject={projectPath !== null}
        target={target}
        conflictPolicy={conflictPolicy}
        onTarget={setTarget}
        onConflictPolicy={setConflictPolicy}
      />
      {imports.result ? (
        <p role="status" className="text-xs text-text-secondary">
          Imported {String(imports.result.imported.length)}
          {imports.result.skipped.length > 0
            ? `, skipped ${String(imports.result.skipped.length)}: ${imports.result.skipped.map((item) => item.reason).join(' ')}`
            : '.'}
        </p>
      ) : null}
      <McpInlineError message={imports.error} />
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={chosen.size === 0 || imports.pending}
          onClick={() => {
            imports.apply({ fingerprints: [...chosen], target, conflictPolicy })
            setChosen(new Set())
          }}
        >
          Import {chosen.size > 0 ? String(chosen.size) : ''} selected
        </Button>
      </div>
    </section>
  )
}
