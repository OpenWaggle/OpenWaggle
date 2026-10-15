import type { McpAppDescriptor, McpAppToolCallResult, McpJsonValue } from '@shared/types/mcp'
import { ShieldAlert, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { setComposerTextValue } from '@/features/chat/lib'
import { Button } from '@/shared/ui/Button'
import { StructuredPayload } from '@/shared/ui/StructuredPayload'
import { useMcpAppBridge } from './mcp-app-bridge'
import { mcpAppDraftJson } from './mcp-app-draft-text'
import { useMcpAppFrameLayout } from './use-mcp-app-frame-layout'
import { useMcpAppFrameRegistration } from './use-mcp-app-frame-registration'
import { MAX_FRAME_HEIGHT, useMcpAppFrameSize } from './use-mcp-app-frame-size'
import { useMcpAppResource } from './use-mcp-app-resource'

interface FrameLoad {
  readonly url: string
  readonly count: number
}

const EMPTY_ARGUMENTS: Readonly<Record<string, McpJsonValue>> = {}

export function McpAppHost({
  descriptor,
  projectPath,
  sessionId,
  initialArguments = EMPTY_ARGUMENTS,
  initialResult,
  onClose,
}: {
  readonly descriptor: McpAppDescriptor
  readonly projectPath: string | null
  readonly sessionId: string | null
  readonly initialArguments?: Readonly<Record<string, McpJsonValue>>
  readonly initialResult?: McpAppToolCallResult
  readonly onClose?: () => void
}) {
  const { resource, error: resourceError } = useMcpAppResource(descriptor, projectPath, sessionId)
  const { frameUrl, error: frameError } = useMcpAppFrameRegistration(resource)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // State, not a ref: the container mounts once the document is registered; observe it then.
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const layout = useMcpAppFrameLayout(container)
  // Each load of the frame's document: a new URL waits for its own, a reload gets a new bridge.
  const [frameLoad, setFrameLoad] = useState<FrameLoad | null>(null)
  const frame = useMcpAppFrameSize(frameUrl !== null)
  const { onHeightChange, onInitialized } = frame
  const stalled = frame.state === 'stalled'
  const [stagedContext, setStagedContext] = useState<unknown>(null)
  const [closed, setClosed] = useState(false)
  const bridgeInput = useMemo(() => {
    const contentWindow = iframeRef.current?.contentWindow
    // A stalled App's frame is removed, so its bridge goes with it.
    const ready = frameUrl !== null && frameLoad?.url === frameUrl && !stalled
    if (!resource || !ready || !contentWindow) return null
    return {
      contentWindow,
      descriptor,
      projectPath,
      sessionId,
      initialArguments,
      ...(initialResult ? { initialResult } : {}),
      resource,
      maxHeight: MAX_FRAME_HEIGHT,
      onHeightChange,
      onInitialized,
      onStagedContext: setStagedContext,
      onClose: () => setClosed(true),
    }
  }, [
    descriptor,
    frameLoad,
    frameUrl,
    initialArguments,
    initialResult,
    onHeightChange,
    onInitialized,
    projectPath,
    resource,
    sessionId,
    stalled,
  ])
  useMcpAppBridge(bridgeInput, layout)

  const error = resourceError ?? frameError
  if (closed) return null
  if (error) {
    return (
      <p
        role="alert"
        className="rounded-md border border-error/25 bg-error/6 p-3 text-xs text-error"
      >
        MCP App could not load: {error}
      </p>
    )
  }
  if (!resource || !frameUrl) {
    return (
      <p className="rounded-md border border-border bg-bg-secondary p-3 text-xs text-text-muted">
        Loading sandboxed MCP App…
      </p>
    )
  }

  return (
    <div
      ref={setContainer}
      className="overflow-hidden rounded-lg border border-border bg-bg-secondary"
    >
      <McpAppHeader
        descriptor={descriptor}
        requestedPermissions={resource.requestedPermissions}
        {...(onClose ? { onClose } : {})}
      />
      {frame.state === 'starting' && (
        <p className="px-3 py-2 text-xs text-text-muted" aria-live="polite">
          Starting MCP App…
        </p>
      )}
      {frame.state === 'stalled' && (
        <p role="status" className="px-3 py-2 text-xs text-text-muted">
          This MCP App did not start. The tool call above has its result as text.
        </p>
      )}
      {frame.state !== 'stalled' && (
        <iframe
          ref={iframeRef}
          title={`${descriptor.toolTitle} MCP App`}
          // Same-origin with its own `frame-<id>` origin only, never with OpenWaggle: Apps read
          // cookies and IndexedDB, which an opaque origin refuses (ADR 0053).
          sandbox="allow-scripts allow-same-origin"
          allow=""
          src={frameUrl}
          className="block w-full border-0 bg-bg"
          style={{ height: frame.frameHeight }}
          onLoad={() => setFrameLoad((load) => ({ url: frameUrl, count: (load?.count ?? 0) + 1 }))}
        />
      )}
      {stagedContext !== null && (
        <McpAppStagedContext serverLabel={descriptor.serverLabel} value={stagedContext} />
      )}
    </div>
  )
}

function McpAppHeader({
  descriptor,
  requestedPermissions,
  onClose,
}: {
  readonly descriptor: McpAppDescriptor
  readonly requestedPermissions: readonly string[]
  readonly onClose?: () => void
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <p className="text-xs font-medium text-text-primary">{descriptor.toolTitle}</p>
          <p className="text-xs text-text-muted">{descriptor.serverLabel} · isolated MCP App</p>
        </div>
        {onClose && (
          <Button variant="unstyled" aria-label="Close MCP App" onClick={onClose}>
            <X className="size-4" />
          </Button>
        )}
      </div>
      {requestedPermissions.length > 0 && (
        <div className="flex items-center gap-2 border-b border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">
          <ShieldAlert className="size-3" />
          Blocked device permissions: {requestedPermissions.join(', ')}
        </div>
      )}
    </>
  )
}

function McpAppStagedContext({
  serverLabel,
  value,
}: {
  readonly serverLabel: string
  readonly value: unknown
}) {
  return (
    <div className="space-y-2 border-t border-border px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-text-muted">
          This App staged attributed context; it is not in the model context.
        </p>
        <Button
          onClick={() =>
            setComposerTextValue(`MCP App context from ${serverLabel}\n\n${mcpAppDraftJson(value)}`)
          }
        >
          Add to editable draft
        </Button>
      </div>
      <StructuredPayload
        value={value}
        ariaLabel={`Staged context from ${serverLabel}`}
        className="max-h-48"
      />
    </div>
  )
}
