import type { SchemaType } from '@shared/schema'
import type { localSessionClientFrameSchema } from '@shared/schemas/local-session-protocol'

export type LocalSessionClientFrame = SchemaType<typeof localSessionClientFrameSchema>
