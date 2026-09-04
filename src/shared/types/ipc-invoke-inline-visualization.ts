import type {
  InlineVisualizationDownloadInput,
  InlineVisualizationFrameRegisterInput,
  InlineVisualizationFrameRegisterResult,
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
  'visualizations:save-download': {
    args: [input: InlineVisualizationDownloadInput]
    return: boolean
  }
}
