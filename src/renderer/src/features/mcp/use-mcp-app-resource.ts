import type { McpAppDescriptor } from '@shared/types/mcp'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { type ParsedMcpAppResource, parseMcpAppResource } from './mcp-app-resource'

interface ResourceState {
  readonly requestKey: string
  readonly resource: ParsedMcpAppResource | null
  readonly error: string | null
}

const RESOURCE_REQUEST_FIELD_COUNT = 6

interface ResourceRequest {
  readonly projectPath: string | null
  readonly sessionId: string | null
  readonly serverInstanceId: string
  readonly serverConfigHash: string
  readonly resourceUri: string
  readonly allowedNetworkDomains: readonly string[]
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

function isStringArray(value: unknown): value is readonly string[] {
  return isUnknownArray(value) && value.every((entry) => typeof entry === 'string')
}

function decodeResourceRequest(requestKey: string): ResourceRequest {
  const value: unknown = JSON.parse(requestKey)
  if (!isUnknownArray(value) || value.length !== RESOURCE_REQUEST_FIELD_COUNT) {
    throw new Error('Invalid MCP App resource request identity.')
  }
  const [projectPath, sessionId, serverInstanceId, serverConfigHash, resourceUri, domains] = value
  if (
    (projectPath !== null && typeof projectPath !== 'string') ||
    (sessionId !== null && typeof sessionId !== 'string') ||
    typeof serverInstanceId !== 'string' ||
    typeof serverConfigHash !== 'string' ||
    typeof resourceUri !== 'string' ||
    !isStringArray(domains)
  ) {
    throw new Error('Invalid MCP App resource request identity.')
  }
  return {
    projectPath,
    sessionId,
    serverInstanceId,
    serverConfigHash,
    resourceUri,
    allowedNetworkDomains: domains,
  }
}

export function useMcpAppResource(
  descriptor: McpAppDescriptor,
  projectPath: string | null,
  sessionId: string | null,
) {
  const requestKey = JSON.stringify([
    projectPath,
    sessionId,
    descriptor.serverInstanceId,
    descriptor.serverConfigHash,
    descriptor.resourceUri,
    descriptor.allowedNetworkDomains,
  ])
  const [state, setState] = useState<ResourceState>({
    requestKey,
    resource: null,
    error: null,
  })
  useEffect(() => {
    let active = true
    const request = decodeResourceRequest(requestKey)
    void api
      .readMcpResource({
        projectPath: request.projectPath,
        sessionId: request.sessionId,
        serverInstanceId: request.serverInstanceId,
        serverConfigHash: request.serverConfigHash,
        uri: request.resourceUri,
      })
      .then((result) => {
        if (active) {
          setState({
            requestKey,
            resource: parseMcpAppResource(result, request.allowedNetworkDomains),
            error: null,
          })
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setState({
            requestKey,
            resource: null,
            error: loadError instanceof Error ? loadError.message : String(loadError),
          })
        }
      })
    return () => {
      active = false
    }
  }, [requestKey])
  return state.requestKey === requestKey
    ? { resource: state.resource, error: state.error }
    : { resource: null, error: null }
}
