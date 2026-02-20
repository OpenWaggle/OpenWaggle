import { is } from '@electron-toolkit/utils'
import type { DevtoolsEventBusConfig } from '@shared/types/devtools'
import { createLogger } from '../logger'

const logger = createLogger('devtools')

const DEVTOOLS_HOST = 'localhost'
const DEVTOOLS_PORT = 4206
const DEVTOOLS_PROTOCOL: DevtoolsEventBusConfig['protocol'] = 'http'

const DISABLED_CONFIG: DevtoolsEventBusConfig = {
  enabled: false,
  host: DEVTOOLS_HOST,
  port: DEVTOOLS_PORT,
  protocol: DEVTOOLS_PROTOCOL,
}

let devtoolsEventBusConfig: DevtoolsEventBusConfig = DISABLED_CONFIG
let stopEventBus: (() => void) | null = null

export function getDevtoolsEventBusConfig(): DevtoolsEventBusConfig {
  return { ...devtoolsEventBusConfig }
}

export async function startDevtoolsEventBus(): Promise<void> {
  if (!is.dev || stopEventBus) return

  try {
    const { ServerEventBus } = await import('@tanstack/devtools-event-bus/server')
    const server = new ServerEventBus({
      host: DEVTOOLS_HOST,
      port: DEVTOOLS_PORT,
    })
    const resolvedPort = await server.start()

    devtoolsEventBusConfig = {
      enabled: true,
      host: DEVTOOLS_HOST,
      port: resolvedPort,
      protocol: DEVTOOLS_PROTOCOL,
    }

    stopEventBus = () => {
      server.stop()
      stopEventBus = null
      devtoolsEventBusConfig = DISABLED_CONFIG
    }
  } catch (error) {
    stopEventBus = null
    devtoolsEventBusConfig = DISABLED_CONFIG
    logger.warn('Failed to start TanStack event bus', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function stopDevtoolsEventBus(): void {
  if (!stopEventBus) return
  stopEventBus()
}
