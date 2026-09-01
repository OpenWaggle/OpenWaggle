import type {
  InlineVisualizationDownloadInput,
  InlineVisualizationFrameRegisterInput,
  InlineVisualizationFrameRegisterResult,
  InlineVisualizationFrameTerminateInput,
  InlineVisualizationFrameUnregisterInput,
} from './inline-visualization'

export interface IpcInlineVisualizationInvokeChannelMap {
  'visualizations:register-frame': {
    args: [input: InlineVisualizationFrameRegisterInput]
    return: InlineVisualizationFrameRegisterResult
  }
  'visualizations:unregister-frame': {
    args: [input: InlineVisualizationFrameUnregisterInput]
    return: undefined
  }
  'visualizations:terminate-frame': {
    args: [input: InlineVisualizationFrameTerminateInput]
    return: boolean
  }
  'visualizations:save-download': {
    args: [input: InlineVisualizationDownloadInput]
    return: boolean
  }
}
