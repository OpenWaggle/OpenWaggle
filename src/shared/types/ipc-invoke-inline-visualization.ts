import type { SessionId } from './brand'
import type {
  InlineVisualizationDownloadInput,
  InlineVisualizationFrameRegisterInput,
  InlineVisualizationFrameRegisterResult,
  InlineVisualizationFrameUnregisterInput,
  InlineVisualizationSourceOwner,
} from './inline-visualization'

export interface IpcInlineVisualizationInvokeChannelMap {
  'inline-visualization:prepare-source': {
    args: [sessionId: SessionId]
    return: InlineVisualizationSourceOwner | null
  }
  'visualizations:register-frame': {
    args: [input: InlineVisualizationFrameRegisterInput]
    return: InlineVisualizationFrameRegisterResult
  }
  'visualizations:unregister-frame': {
    args: [input: InlineVisualizationFrameUnregisterInput]
    return: undefined
  }
  'visualizations:save-download': {
    args: [input: InlineVisualizationDownloadInput]
    return: boolean
  }
}
