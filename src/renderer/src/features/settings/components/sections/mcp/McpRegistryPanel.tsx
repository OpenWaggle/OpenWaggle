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
import { McpSecretLines } from './McpSecretLines'
import { mcpCountWords } from './mcp-count-words'

function OptionalSecretsLine({ result }: { readonly result: McpRegistryInstallResultView }) {
  const words = mcpCountWords(result.optionalSecrets.length)
  const ending = result.optionalSecretsNeedContainerEnv
    ? ', and add -e NAME to its args before the image so the container receives it.'
    : '.'
  return (
    <p>
      {`It can also use the optional secret${words.plural} ${result.optionalSecrets.join(', ')}, which ${words.was} left out so it starts without ${words.object}. To use one, add it to the entry with a secret${ending}`}
    </p>
  )
}

function OptionalArgumentsLine({ flags }: { readonly flags: readonly string[] }) {
  const words = mcpCountWords(flags.length)
  return (
    <p>
      {`It also takes the optional argument${words.plural} ${flags.join(', ')}, which ${words.was} left out: ${words.needs} a literal value in args, since a command line cannot read a secret.`}
    </p>
  )
}

function InstalledNotice({ result }: { readonly result: McpRegistryInstallResultView }) {
  const flags = result.optionalSecretArguments
  return (
    <div role="status" className="space-y-0.5 text-xs text-text-secondary">
      <p>
        Installed &quot;{result.name}&quot; in{' '}
        <span className="font-mono text-text-muted" title={result.filePath}>
          {tildifyPath(result.filePath)}
        </span>
        .
      </p>
      <McpSecretLines
        secrets={result.secrets}
        existingSecrets={result.existingSecrets}
        subject="one"
      />
      {result.optionalSecrets.length > 0 ? <OptionalSecretsLine result={result} /> : null}
      {flags.length > 0 ? <OptionalArgumentsLine flags={flags} /> : null}
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
