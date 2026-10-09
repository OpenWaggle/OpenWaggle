import type { McpConfigFileView, McpConfiguredServerView } from '@shared/types/mcp-configuration'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import { useMcpConfigurationActions, useMcpSignIn } from '../../../hooks/useMcpConfiguration'
import {
  canSwitchForProject,
  hasProjectOverride,
  type McpServerStatus,
} from '../../../lib/mcp-server-model'
import { McpFileName, McpInlineError } from './McpLabels'

interface ServerActionProps {
  readonly projectPath: string | null
  readonly server: McpConfiguredServerView
}

/** On or off where the server is defined, and for the selected project alone. */
export function McpServerSwitches({
  projectPath,
  server,
  files,
}: ServerActionProps & { readonly files: readonly McpConfigFileView[] }) {
  const actions = useMcpConfigurationActions(projectPath)
  const savedIn = server.override ?? server.source
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-text-primary">{server.enabled ? 'On' : 'Off'}</p>
          <p className="text-xs text-text-tertiary">
            {hasProjectOverride(server) ? 'Applies to this project. ' : null}
            Saved to <McpFileName fileId={savedIn.fileId} />.
          </p>
        </div>
        <ToggleSwitch
          checked={server.enabled}
          disabled={actions.pending}
          label={`${server.enabled ? 'Turn off' : 'Turn on'} ${server.name}`}
          onCheckedChange={(enabled) => void actions.setEnabled(server.name, enabled)}
        />
      </div>
      {canSwitchForProject(server, projectPath, files) ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-text-tertiary">
            {server.enabled
              ? 'Keep it for other projects, but not this one.'
              : 'Use it in this project only.'}
          </p>
          <Button
            variant="secondary"
            size="xs"
            disabled={actions.pending}
            onClick={() => void actions.setEnabled(server.name, !server.enabled, 'project')}
          >
            {server.enabled ? 'Turn off in this project' : 'Turn on in this project'}
          </Button>
        </div>
      ) : null}
      <McpInlineError message={actions.error} />
    </div>
  )
}

function showsSignIn(status: McpServerStatus, signedIn: boolean | undefined) {
  return status === 'needs-sign-in' || (status !== 'connected' && signedIn !== true)
}

/** OAuth servers sign in through the Session Host, the same way `openwaggle mcp login` does. */
export function McpServerSignIn({
  projectPath,
  server,
  status,
  signedIn,
}: ServerActionProps & {
  readonly status: McpServerStatus
  readonly signedIn: boolean | undefined
}) {
  const auth = useMcpSignIn(projectPath, server.name)
  if (!server.usesOAuth || !server.enabled) return null
  const canSignOut = signedIn === true || status === 'connected'
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-text-tertiary">
          {canSignOut
            ? 'Signed in with OAuth.'
            : 'This server signs in with OAuth in your browser.'}
        </p>
        <div className="flex gap-1.5">
          {showsSignIn(status, signedIn) ? (
            <Button variant="accent" size="xs" disabled={auth.pending} onClick={auth.signIn}>
              Sign in
            </Button>
          ) : null}
          {canSignOut ? (
            <Button variant="ghost" size="xs" disabled={auth.pending} onClick={auth.signOut}>
              Sign out
            </Button>
          ) : null}
        </div>
      </div>
      {auth.result?.authorizationUrl ? (
        <p className="break-all text-xs text-text-secondary">
          Open this page to finish signing in:{' '}
          <span className="font-mono">{auth.result.authorizationUrl}</span>
        </p>
      ) : null}
      {auth.result && !auth.result.signedIn && !auth.result.authorizationUrl ? (
        <p className="text-xs text-text-tertiary">Sign-in was cancelled.</p>
      ) : null}
      <McpInlineError message={auth.error} />
    </div>
  )
}

export function McpRemoveServer({
  projectPath,
  server,
  onRemoved,
}: ServerActionProps & { readonly onRemoved: () => void }) {
  const actions = useMcpConfigurationActions(projectPath)
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="xs"
        leftIcon={<Trash2 className="size-3" />}
        onClick={() => setConfirming(true)}
      >
        Remove
      </Button>
    )
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-error-text">
          Remove {server.name} from <McpFileName fileId={server.source.fileId} />?
        </span>
        <Button
          variant="danger"
          size="xs"
          disabled={actions.pending}
          onClick={async () => {
            if (await actions.removeServer(server.name)) onRemoved()
          }}
        >
          Remove server
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
      <McpInlineError message={actions.error} />
    </div>
  )
}
