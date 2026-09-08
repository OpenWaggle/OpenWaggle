import type { PreparedAttachment } from './agent'
import type { SessionId } from './brand'
import type { IpcEventPayload } from './ipc'
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

type SessionResourceContentReader = (
  ...args: [SessionId, string]
) => Promise<SessionResourceContent | null>

type SessionResourceThumbnailReader = (
  ...args: [SessionId, string]
) => Promise<SessionResourceThumbnailPreview | null>

export interface OpenWaggleSessionResourceApi {
  activateSessionResourceOwner(sessionId: SessionId | null): void
  onSessionResourcesInvalidated(
    callback: (payload: IpcEventPayload<'sessions:resources-invalidated'>) => void,
  ): () => void
  listSessionResources(sessionId: SessionId): Promise<SessionResourceList>
  listSessionResourcePage(
    sessionId: SessionId,
    input: SessionResourceCatalogPageRequest,
  ): Promise<SessionResourceCatalogPage>
  getSessionResource(
    sessionId: SessionId,
    resourceId: string,
    view: SessionResourceCatalogView,
    selection?: SessionResourceRouteSelection | null,
  ): Promise<SessionResource | null>
  locateSessionResourceImage(
    sessionId: SessionId,
    resourceId: string,
    selection?: SessionResourceRouteSelection | null,
  ): Promise<SessionResourceImageLocation | null>
  listSessionResourceNodePage(
    sessionId: SessionId,
    input: SessionResourceNodePageRequest,
  ): Promise<SessionResourceCatalogPage>
  listSessionResourcesByNodeIds(
    sessionId: SessionId,
    nodeIds: readonly string[],
    kind: SessionResourceKind | null,
    limit: number,
  ): Promise<readonly SessionResource[]>
  advanceSessionResourceBackfill(sessionId: SessionId): Promise<SessionResourceBackfillStatus>
  readSessionResource: SessionResourceContentReader
  readSessionResourceThumbnail: SessionResourceThumbnailReader
  copySessionResourceImage(sessionId: SessionId, resourceId: string): Promise<void>
  prepareSessionResourceAttachment(
    sessionId: SessionId,
    resourceId: string,
  ): Promise<PreparedAttachment>
  retrySessionResource(sessionId: SessionId, resourceId: string): Promise<void>
  recordSessionChangeRequest(
    sessionId: SessionId,
    input: RecordSessionChangeRequestInput,
  ): Promise<SessionResource>
}
