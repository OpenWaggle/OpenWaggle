import type { McpAppDescriptor } from '@shared/types/mcp'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { type ParsedMcpAppResource, parseMcpAppResource } from './mcp-app-resource'

export function useMcpAppResource(
  descriptor: McpAppDescriptor,
  projectPath: string | null,
  sessionId: string | null,
) {
  const [resource, setResource] = useState<ParsedMcpAppResource | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void api
      .readMcpResource({
        projectPath,
        sessionId,
        serverInstanceId: descriptor.serverInstanceId,
        uri: descriptor.resourceUri,
      })
      .then((result) => {
        if (active) setResource(parseMcpAppResource(result, descriptor.allowedNetworkDomains))
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
    return () => {
      active = false
    }
  }, [projectPath, sessionId, descriptor])
  return { resource, error }
}
