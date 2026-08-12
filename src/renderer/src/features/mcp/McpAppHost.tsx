import type { McpAppDescriptor, McpAppToolCallResult, McpJsonValue } from '@shared/types/mcp'
import { ShieldAlert, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { setComposerTextValue } from '@/features/chat/lib'
import { Button } from '@/shared/ui/Button'
import { useMcpAppBridge } from './mcp-app-bridge'
import { useMcpAppResource } from './use-mcp-app-resource'

const MIN_FRAME_HEIGHT = 160
const MAX_FRAME_HEIGHT = 800
const INITIAL_FRAME_HEIGHT = 320
const JSON_INDENT_SPACES = 2
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
  const { resource, error } = useMcpAppResource(descriptor, projectPath, sessionId)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [frameReady, setFrameReady] = useState(false)
  const [frameHeight, setFrameHeight] = useState(INITIAL_FRAME_HEIGHT)
  const [stagedContext, setStagedContext] = useState<unknown>(null)
  const [closed, setClosed] = useState(false)
  const bridgeInput = useMemo(() => {
    const contentWindow = iframeRef.current?.contentWindow
    if (!resource || !frameReady || !contentWindow) return null
    return {
      contentWindow,
      descriptor,
      projectPath,
      sessionId,
      initialArguments,
      ...(initialResult ? { initialResult } : {}),
      resource,
      onHeightChange: (height: number) =>
        setFrameHeight(Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, height))),
      onStagedContext: setStagedContext,
      onClose: () => setClosed(true),
    }
  }, [descriptor, frameReady, initialArguments, initialResult, projectPath, resource, sessionId])
  useMcpAppBridge(bridgeInput)

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
  if (!resource) {
    return (
      <p className="rounded-md border border-border bg-bg-secondary p-3 text-xs text-text-muted">
        Loading sandboxed MCP App…
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-secondary">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <p className="text-xs font-medium text-text-primary">{descriptor.toolTitle}</p>
          <p className="text-[10px] text-text-muted">{descriptor.serverLabel} · isolated MCP App</p>
        </div>
        {onClose && (
          <Button variant="unstyled" aria-label="Close MCP App" onClick={onClose}>
            <X className="size-4" />
          </Button>
        )}
      </div>
      {resource.requestedPermissions.length > 0 && (
        <div className="flex items-center gap-2 border-b border-warning/20 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          <ShieldAlert className="size-3" />
          Blocked device permissions: {resource.requestedPermissions.join(', ')}
        </div>
      )}
      <iframe
        ref={iframeRef}
        title={`${descriptor.toolTitle} MCP App`}
        sandbox="allow-scripts"
        allow=""
        srcDoc={resource.html}
        className="w-full border-0 bg-white"
        style={{ height: frameHeight }}
        onLoad={() => setFrameReady(true)}
      />
      {stagedContext !== null && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
          <p className="text-[11px] text-text-muted">
            This App staged attributed context; it is not in the model context.
          </p>
          <Button
            onClick={() =>
              setComposerTextValue(
                `MCP App context from ${descriptor.serverLabel}\n\n${JSON.stringify(stagedContext, null, JSON_INDENT_SPACES)}`,
              )
            }
          >
            Add to editable draft
          </Button>
        </div>
      )}
    </div>
  )
}
