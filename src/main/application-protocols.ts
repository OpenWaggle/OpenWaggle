import { registerExtensionFrameProtocolOnce } from './extension-frame-protocol'
import { registerExtensionRuntimeProtocolOnce } from './extension-runtime-protocol'
import { registerInlineVisualizationProtocolOnce } from './inline-visualization-protocol'
import { registerMcpAppFrameProtocolOnce } from './mcp-app-frame-protocol'
import { registerRendererProtocolOnce } from './renderer-protocol'
import { registerSessionResourceProtocolOnce } from './session-resource-protocol'

type InlineVisualizationReader = NonNullable<
  Parameters<typeof registerInlineVisualizationProtocolOnce>[0]
>['readSource']

export function registerApplicationProtocols(input: {
  readonly readInlineVisualizationSource: InlineVisualizationReader
}) {
  registerRendererProtocolOnce()
  registerExtensionFrameProtocolOnce()
  registerExtensionRuntimeProtocolOnce()
  registerInlineVisualizationProtocolOnce({ readSource: input.readInlineVisualizationSource })
  registerMcpAppFrameProtocolOnce()
  // The default reader asks the attached Session Host first: the GUI database is client-isolated
  // and holds no Session resources, so a GUI-local read always returned 404 to the image viewer.
  registerSessionResourceProtocolOnce()
}
