import type { McpConfigFileScope } from '@shared/types/mcp-configuration'
import type { McpRegistryInstallResultView } from '@shared/types/mcp-registry'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { tildifyPath } from '@/shared/lib/tildify-path'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { TextInput } from '@/shared/ui/TextInput'
import { useMcpRegistry } from '../../../hooks/useMcpRegistry'
import { McpInlineError } from './McpLabels'
import { McpRegistryResultRow } from './McpRegistryResultRow'

function InstalledNotice({ result }: { readonly result: McpRegistryInstallResultView }) {
  const existing = result.existingSecrets
  const stored = new Set(existing)
  const secrets = result.secrets.filter((secret) => !stored.has(secret))
  return (
    <div role="status" className="space-y-0.5 text-xs text-text-secondary">
      <p>
        Installed &quot;{result.name}&quot; in{' '}
        <span className="font-mono text-text-muted" title={result.filePath}>
          {tildifyPath(result.filePath)}
        </span>
        .
      </p>
      {secrets.length > 0 ? (
        <p className="text-warning">
          It reads the secret{secrets.length === 1 ? '' : 's'} {secrets.join(', ')}. Add{' '}
          {secrets.length === 1 ? 'it' : 'them'} under Secrets before using the server.
        </p>
      ) : null}
      {existing.length > 0 ? (
        <p>
          It uses the secret{existing.length === 1 ? '' : 's'} {existing.join(', ')}, which already{' '}
          {existing.length === 1 ? 'exists' : 'exist'} under Secrets; replace{' '}
          {existing.length === 1 ? 'it' : 'them'} there if{' '}
          {existing.length === 1 ? 'it holds' : 'they hold'} another value.
        </p>
      ) : null}
    </div>
  )
}

/** Search the MCP Registry and save a server to OpenWaggle's file as an ordinary entry. */
export function McpRegistryPanel({ projectPath }: { readonly projectPath: string | null }) {
  const registry = useMcpRegistry(projectPath)
  const [draft, setDraft] = useState('')
  const [scope, setScope] = useState<McpConfigFileScope>('global')
  const servers = registry.servers ?? []
  return (
    <section aria-labelledby="mcp-registry-heading" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 id="mcp-registry-heading" className="text-sm font-semibold text-text-primary">
            MCP Registry
          </h3>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Servers published to registry.modelcontextprotocol.io. Installing adds the server to
            OpenWaggle&apos;s file.
          </p>
        </div>
        <Select
          selectSize="xs"
          aria-label="Install Registry servers for"
          value={scope}
          onChange={(event) => setScope(event.target.value === 'project' ? 'project' : 'global')}
        >
          <option value="global">All projects</option>
          <option value="project" disabled={projectPath === null}>
            This project
          </option>
        </Select>
      </div>
      <form
        aria-label="Search the MCP Registry"
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          registry.search(draft)
        }}
      >
        <TextInput
          inputSize="sm"
          aria-label="Search the MCP Registry"
          placeholder="Search by name, for example github or postgres"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={draft.trim().length === 0}
          leftIcon={<Search className="size-3" />}
        >
          Search
        </Button>
      </form>
      {registry.isSearching ? <p className="text-xs text-text-tertiary">Searching…</p> : null}
      <McpInlineError message={registry.searchError} />
      {registry.servers && servers.length === 0 && !registry.isSearching ? (
        <p className="text-xs text-text-muted">
          No Registry servers match &quot;{registry.query}&quot;.
        </p>
      ) : null}
      {servers.length > 0 ? (
        <ul
          aria-label="Registry servers"
          className="overflow-hidden rounded-lg border border-border bg-bg"
        >
          {servers.map((server) => (
            <McpRegistryResultRow
              key={`${server.name}@${server.version}`}
              server={server}
              configured={registry.configuredNames.has(server.suggestedName)}
              installing={registry.installing === server.name}
              disabled={registry.installing !== null}
              onInstall={(method) =>
                registry.install({
                  registryName: server.name,
                  version: server.version,
                  method,
                  scope,
                })
              }
            />
          ))}
        </ul>
      ) : null}
      {registry.installed ? <InstalledNotice result={registry.installed} /> : null}
      <McpInlineError message={registry.error} />
    </section>
  )
}
