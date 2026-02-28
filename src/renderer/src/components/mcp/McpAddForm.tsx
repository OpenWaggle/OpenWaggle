import { MCP_TRANSPORTS, type McpServerConfig, type McpTransport } from '@shared/types/mcp'
import { ArrowLeft, ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { cn } from '@/lib/cn'

function isMcpTransport(value: string): value is McpTransport {
  return MCP_TRANSPORTS.some((t) => t === value)
}

interface McpAddFormProps {
  readonly onBack: () => void
  readonly onSubmit: (
    config: Omit<McpServerConfig, 'id'>,
  ) => Promise<{ ok: boolean; error?: string }>
}

interface EnvVar {
  readonly id: number
  readonly key: string
  readonly value: string
}

export function McpAddForm({ onBack, onSubmit }: McpAddFormProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<McpTransport>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [envVars, setEnvVars] = useState<EnvVar[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextEnvVarId = useRef(0)

  function addEnvVar(): void {
    const id = nextEnvVarId.current++
    setEnvVars((prev) => [...prev, { id, key: '', value: '' }])
  }

  function removeEnvVar(id: number): void {
    setEnvVars((prev) => prev.filter((v) => v.id !== id))
  }

  function updateEnvVar(id: number, field: 'key' | 'value', newValue: string): void {
    setEnvVars((prev) => prev.map((v) => (v.id === id ? { ...v, [field]: newValue } : v)))
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const env: Record<string, string> = {}
    for (const v of envVars) {
      if (v.key.trim()) {
        env[v.key.trim()] = v.value
      }
    }

    const config: Omit<McpServerConfig, 'id'> = {
      name: name.trim(),
      transport,
      enabled: true,
      ...(transport === 'stdio' && {
        command: command.trim(),
        args: args.trim() ? args.trim().split(/\s+/) : undefined,
      }),
      ...(transport === 'http' && {
        url: url.trim(),
      }),
      ...(Object.keys(env).length > 0 && { env }),
    }

    const result = await onSubmit(config)
    setIsSubmitting(false)
    if (!result.ok) {
      setError(result.error ?? 'Failed to add server')
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center border-b border-border px-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded p-1 text-text-tertiary transition-colors hover:text-text-secondary"
            aria-label="Back to MCP list"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-lg font-semibold text-text-primary">Add MCP Server</h1>
        </div>
      </div>

      {/* Form body */}
      <div className="flex-1 overflow-y-auto">
        <form onSubmit={(e) => void handleSubmit(e)} className="mx-auto max-w-[560px] py-8">
          <p className="mb-6 text-[13px] leading-relaxed text-text-tertiary">
            Connect an MCP server to extend your agent with custom tools, data sources, and
            integrations.
          </p>

          <div className="flex flex-col gap-6">
            {/* Server name */}
            <div className="flex flex-col gap-2">
              <label htmlFor="mcp-server-name" className="text-xs font-medium text-text-secondary">
                Server name
              </label>
              <input
                id="mcp-server-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. my-filesystem-server"
                className="h-10 rounded-md border border-border bg-bg-secondary px-3 text-[13px] text-text-primary placeholder:text-[#555b67] focus:border-accent focus:outline-none"
                required
              />
            </div>

            {/* Transport type */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="mcp-transport-type"
                className="text-xs font-medium text-text-secondary"
              >
                Transport type
              </label>
              <div className="relative">
                <select
                  id="mcp-transport-type"
                  value={transport}
                  onChange={(e) => {
                    const value = e.target.value
                    if (isMcpTransport(value)) {
                      setTransport(value)
                    }
                  }}
                  className="h-10 w-full appearance-none rounded-md border border-border bg-bg-secondary px-3 pr-8 text-[13px] text-text-primary focus:border-accent focus:outline-none"
                >
                  <option value="stdio">stdio</option>
                  <option value="http">http</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
              </div>
            </div>

            {/* Command (stdio only) */}
            {transport === 'stdio' && (
              <>
                <div className="flex flex-col gap-2">
                  <label htmlFor="mcp-command" className="text-xs font-medium text-text-secondary">
                    Command
                  </label>
                  <input
                    id="mcp-command"
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="e.g. npx, uvx, docker"
                    className="h-10 rounded-md border border-border bg-bg-secondary px-3 text-[13px] text-text-primary placeholder:text-[#555b67] focus:border-accent focus:outline-none"
                    required
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="mcp-arguments"
                    className="text-xs font-medium text-text-secondary"
                  >
                    Arguments
                  </label>
                  <input
                    id="mcp-arguments"
                    type="text"
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    placeholder="e.g. -y @modelcontextprotocol/server-filesystem /Users/home"
                    className="h-10 rounded-md border border-border bg-bg-secondary px-3 text-[13px] text-text-primary placeholder:text-[#555b67] focus:border-accent focus:outline-none"
                  />
                </div>
              </>
            )}

            {/* URL (http only) */}
            {transport === 'http' && (
              <div className="flex flex-col gap-2">
                <label htmlFor="mcp-server-url" className="text-xs font-medium text-text-secondary">
                  Server URL
                </label>
                <input
                  id="mcp-server-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="e.g. http://localhost:3000/mcp"
                  className="h-10 rounded-md border border-border bg-bg-secondary px-3 text-[13px] text-text-primary placeholder:text-[#555b67] focus:border-accent focus:outline-none"
                  required
                />
              </div>
            )}

            {/* Environment variables */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-secondary">
                  Environment variables
                </span>
                <button
                  type="button"
                  onClick={addEnvVar}
                  className="flex items-center gap-1 text-[11px] font-medium text-accent transition-colors hover:text-accent/80"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              </div>
              {envVars.map((v) => (
                <div key={v.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={v.key}
                    onChange={(e) => updateEnvVar(v.id, 'key', e.target.value)}
                    placeholder="KEY"
                    className="h-9 w-[180px] rounded-md border border-border bg-bg-secondary px-2.5 text-[12px] text-text-primary placeholder:text-[#555b67] focus:border-accent focus:outline-none"
                  />
                  <input
                    type="text"
                    value={v.value}
                    onChange={(e) => updateEnvVar(v.id, 'value', e.target.value)}
                    placeholder="value"
                    className="h-9 flex-1 rounded-md border border-border bg-bg-secondary px-2.5 text-[12px] text-text-tertiary placeholder:text-[#555b67] focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeEnvVar(v.id)}
                    className="rounded p-1 text-[#555b67] transition-colors hover:text-red-400"
                    aria-label="Remove environment variable"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="h-px w-full bg-border" />

            {/* Error */}
            {error && <p className="text-[13px] text-red-400">{error}</p>}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onBack}
                className={cn(
                  'h-9 rounded-md border border-border bg-bg-secondary px-5 text-[13px] font-medium text-text-secondary',
                  'transition-colors hover:bg-bg-hover',
                )}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !name.trim()}
                className={cn(
                  'h-9 rounded-md bg-accent px-5 text-[13px] font-semibold text-bg',
                  'transition-colors hover:bg-accent/90',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {isSubmitting ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
