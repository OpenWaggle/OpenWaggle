import type { PreparedAttachment } from './agent'
import type { SessionId } from './brand'
import type {
  RecordSessionChangeRequestInput,
  SessionResource,
  SessionResourceBackfillStatus,
  SessionResourceCatalogPage,
  SessionResourceCatalogPageRequest,
  SessionResourceCatalogView,
  SessionResourceContent,
  SessionResourceImageLocation,
  SessionResourceKind,
  SessionResourceList,
  SessionResourceNodePageRequest,
  SessionResourceRouteSelection,
  SessionResourceThumbnailPreview,
} from './session-resource'

export interface SessionResourceIpcInvokeChannels {
  'sessions:resources:list': {
    args: [sessionId: SessionId]
    return: SessionResourceList
  }
  'sessions:resources:page': {
    args: [sessionId: SessionId, input: SessionResourceCatalogPageRequest]
    return: SessionResourceCatalogPage
  }
  'sessions:resources:get': {
    args: [
      sessionId: SessionId,
      resourceId: string,
      view: SessionResourceCatalogView,
      selection?: SessionResourceRouteSelection | null,
    ]
    return: SessionResource | null
  }
  'sessions:resources:locate-image': {
    args: [
      sessionId: SessionId,
      resourceId: string,
      selection?: SessionResourceRouteSelection | null,
    ]
    return: SessionResourceImageLocation | null
  }
  'sessions:resources:node-page': {
    args: [sessionId: SessionId, input: SessionResourceNodePageRequest]
    return: SessionResourceCatalogPage
  }
  'sessions:resources:list-by-node-ids': {
    args: [
      sessionId: SessionId,
      nodeIds: readonly string[],
      kind: SessionResourceKind | null,
      limit: number,
    ]
    return: readonly SessionResource[]
  }
  'sessions:resources:backfill': {
    args: [sessionId: SessionId]
    return: SessionResourceBackfillStatus
  }
  'sessions:resources:read': {
    args: [sessionId: SessionId, resourceId: string]
    return: SessionResourceContent | null
  }
  'sessions:resources:thumbnail': {
    args: [sessionId: SessionId, resourceId: string]
    return: SessionResourceThumbnailPreview | null
  }
  'sessions:resources:copy-image': {
    args: [sessionId: SessionId, resourceId: string]
    return: undefined
  }
  'sessions:resources:prepare-attachment': {
    args: [sessionId: SessionId, resourceId: string]
    return: PreparedAttachment
  }
  'sessions:resources:retry': {
    args: [sessionId: SessionId, resourceId: string]
    return: undefined
  }
  'sessions:resources:record-change-request': {
    args: [sessionId: SessionId, input: RecordSessionChangeRequestInput]
    return: SessionResource
  }
}
