import { registerExtensionFrameProtocolOnce } from './extension-frame-protocol'
import { registerExtensionRuntimeProtocolOnce } from './extension-runtime-protocol'
import { registerInlineVisualizationProtocolOnce } from './inline-visualization-protocol'
import { registerRendererProtocolOnce } from './renderer-protocol'
import { registerSessionResourceProtocolOnce } from './session-resource-protocol'

type InlineVisualizationReader = NonNullable<
  Parameters<typeof registerInlineVisualizationProtocolOnce>[0]
>['readSource']
type SessionResourceReader = NonNullable<
  Parameters<typeof registerSessionResourceProtocolOnce>[0]
>['readContent']

export function registerApplicationProtocols(input: {
  readonly readInlineVisualizationSource: InlineVisualizationReader
  readonly readSessionResourceContent: SessionResourceReader
}) {
  registerRendererProtocolOnce()
  registerExtensionFrameProtocolOnce()
  registerExtensionRuntimeProtocolOnce()
  registerInlineVisualizationProtocolOnce({ readSource: input.readInlineVisualizationSource })
  registerSessionResourceProtocolOnce({ readContent: input.readSessionResourceContent })
}
