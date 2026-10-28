import type { McpConfiguredServerView, McpServerToolView } from '@shared/types/mcp-configuration'
import type { McpRuntimeExposure } from '@shared/utils/mcp-exposure'
import { Check } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { useMcpConfigurationActions } from '../../../hooks/useMcpConfiguration'
import {
  MCP_EXPOSURE_COPY,
  mcpExposureChoices,
  mcpShownExposure,
} from '../../../lib/mcp-server-model'
import { McpInlineError } from './McpLabels'

const SAME_AS_SERVER = 'server'

function exposureValue(
  value: string,
  choices: readonly McpRuntimeExposure[],
): McpRuntimeExposure | null {
  return choices.find((exposure) => exposure === value) ?? null
}

function firstLine(text: string | undefined) {
  return text?.split('\n', 1)[0]?.trim() ?? ''
}

const PREVIOUS_KEYS = new Set(['ArrowUp', 'ArrowLeft'])
const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight'])

/** The choice a radio-group key moves to (WAI-ARIA radio group: arrows wrap, Home and End). */
function exposureForKey(
  key: string,
  current: McpRuntimeExposure,
  choices: readonly McpRuntimeExposure[],
) {
  const index = choices.indexOf(current)
  const last = choices.length - 1
  if (key === 'Home') return choices[0]
  if (key === 'End') return choices[last]
  if (PREVIOUS_KEYS.has(key)) return choices[index <= 0 ? last : index - 1]
  if (NEXT_KEYS.has(key)) return choices[index >= last ? 0 : index + 1]
  return undefined
}

function ServerExposureChoice({
  server,
  disabled,
  onChange,
}: {
  readonly server: McpConfiguredServerView
  readonly disabled: boolean
  readonly onChange: (exposure: McpRuntimeExposure) => void
}) {
  // A file's `direct` runs, and so shows, as codemode.
  const current = mcpShownExposure(server.exposure)
  const choices = mcpExposureChoices(current)
  return (
    <div
      role="radiogroup"
      aria-label="Server exposure"
      className="overflow-hidden rounded-lg border border-border bg-bg"
      onKeyDown={(event) => {
        const next = exposureForKey(event.key, current, choices)
        if (!next) return
        event.preventDefault()
        // While a choice saves, keys are ignored; the next one moves from the saved choice.
        if (disabled) return
        const radio = event.currentTarget.querySelector<HTMLElement>(
          `[role="radio"][data-exposure="${next}"]`,
        )
        radio?.focus()
        if (next !== current) onChange(next)
      }}
    >
      {choices.map((exposure) => {
        const selected = current === exposure
        return (
          <Button
            key={exposure}
            role="radio"
            aria-checked={selected}
            data-exposure={exposure}
            // One tab stop: the selected choice; arrow keys move between the others.
            tabIndex={selected ? 0 : -1}
            variant="row"
            align="start"
            // Not `disabled` while saving: a disabled radio drops keyboard focus to the page.
            aria-disabled={disabled}
            className={cn(
              'gap-3 border-b border-border px-4 py-2.5 last:border-b-0',
              selected && 'bg-bg-hover',
              disabled && 'cursor-progress',
            )}
            onClick={() => {
              if (!selected && !disabled) onChange(exposure)
            }}
          >
            <Check
              className={cn('mt-0.5 size-3.5 shrink-0 text-accent', !selected && 'invisible')}
            />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-text-primary">
                {MCP_EXPOSURE_COPY[exposure].label}
              </span>
              <span className="block text-xs text-text-tertiary">
                {MCP_EXPOSURE_COPY[exposure].description}
              </span>
            </span>
          </Button>
        )
      })}
    </div>
  )
}

function ToolExposureRow({
  tool,
  server,
  disabled,
  onChange,
}: {
  readonly tool: McpServerToolView
  readonly server: McpConfiguredServerView
  readonly disabled: boolean
  readonly onChange: (tool: string, exposure: McpRuntimeExposure | null) => void
}) {
  const configured = server.toolExposure[tool.name]
  const own = configured === undefined ? undefined : mcpShownExposure(configured)
  const serverExposure = mcpShownExposure(server.exposure)
  const choices = mcpExposureChoices(own ?? 'codemode')
  const description = firstLine(tool.description)
  return (
    <li className="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate font-mono text-xs text-text-primary">{tool.name}</p>
        {description ? <p className="truncate text-xs text-text-tertiary">{description}</p> : null}
      </div>
      <Select
        aria-label={`Exposure of ${tool.name}`}
        value={own ?? SAME_AS_SERVER}
        disabled={disabled}
        onChange={(event) => onChange(tool.name, exposureValue(event.target.value, choices))}
      >
        <option value={SAME_AS_SERVER}>
          {own === undefined && mcpShownExposure(tool.exposure) !== serverExposure
            ? `${MCP_EXPOSURE_COPY[mcpShownExposure(tool.exposure)].label} (by a rule)`
            : `Same as server (${MCP_EXPOSURE_COPY[serverExposure].label})`}
        </option>
        {choices.map((exposure) => (
          <option key={exposure} value={exposure}>
            {MCP_EXPOSURE_COPY[exposure].label}
          </option>
        ))}
      </Select>
    </li>
  )
}

function ExposureRules({
  rules,
  disabled,
  onRemove,
}: {
  readonly rules: readonly (readonly [string, McpRuntimeExposure])[]
  readonly disabled: boolean
  readonly onRemove: (rule: string) => void
}) {
  if (rules.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-text-tertiary">
        Rules from the file. <span className="font-mono">*</span> matches any characters; a
        tool&apos;s own setting wins over a rule.
      </p>
      <ul className="overflow-hidden rounded-lg border border-border bg-bg">
        {rules.map(([rule, exposure]) => (
          <li
            key={rule}
            className="flex items-center justify-between gap-4 border-b border-border px-4 py-2 last:border-b-0"
          >
            <span className="font-mono text-xs text-text-primary">
              {rule}{' '}
              <span className="text-text-tertiary">→ {MCP_EXPOSURE_COPY[exposure].label}</span>
            </span>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Remove rule ${rule}`}
              disabled={disabled}
              onClick={() => onRemove(rule)}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function McpExposureEditor({
  projectPath,
  server,
  tools,
}: {
  readonly projectPath: string | null
  readonly server: McpConfiguredServerView
  readonly tools: readonly McpServerToolView[]
}) {
  const actions = useMcpConfigurationActions(projectPath)
  const toolNames = new Set(tools.map((tool) => tool.name))
  const rules = Object.entries(server.toolExposure)
    .filter(([rule]) => !toolNames.has(rule))
    .map(([rule, exposure]) => [rule, mcpShownExposure(exposure)] as const)
  const setTool = (tool: string, exposure: McpRuntimeExposure | null) =>
    void actions.setExposure(server.name, { toolExposure: { [tool]: exposure } })
  return (
    <section aria-labelledby="mcp-exposure-heading" className="space-y-3">
      <div>
        <h4 id="mcp-exposure-heading" className="text-sm font-semibold text-text-primary">
          Exposure
        </h4>
        <p className="mt-0.5 text-xs text-text-tertiary">
          How the model reaches this server&apos;s tools. Saved to{' '}
          {server.override ? 'the override file' : 'the file that defines the server'}.
        </p>
      </div>
      <ServerExposureChoice
        server={server}
        disabled={actions.pending}
        onChange={(exposure) => void actions.setExposure(server.name, { exposure })}
      />
      <McpInlineError message={actions.error} />
      <ExposureRules
        rules={rules}
        disabled={actions.pending}
        onRemove={(rule) => setTool(rule, null)}
      />
      <div className="space-y-1.5">
        <h5 className="text-xs font-medium text-text-secondary">Tools</h5>
        {tools.length > 0 ? (
          <ul aria-label="Tools" className="overflow-hidden rounded-lg border border-border bg-bg">
            {tools.map((tool) => (
              <ToolExposureRow
                key={tool.name}
                tool={tool}
                server={server}
                disabled={actions.pending}
                onChange={setTool}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-text-muted">Tools appear here once the server connects.</p>
        )}
      </div>
    </section>
  )
}
