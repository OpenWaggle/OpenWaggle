import type { SessionId } from './brand'
import type {
  RecordSessionChangeRequestInput,
  SessionResource,
  SessionResourceContent,
} from './session-resource'

export interface SessionResourceIpcInvokeChannels {
  'sessions:resources:list': {
    args: [sessionId: SessionId]
    return: SessionResource[]
  }
  'sessions:resources:read': {
    args: [sessionId: SessionId, resourceId: string]
    return: SessionResourceContent | null
  }
  'sessions:resources:record-change-request': {
    args: [sessionId: SessionId, input: RecordSessionChangeRequestInput]
    return: SessionResource
  }
}
