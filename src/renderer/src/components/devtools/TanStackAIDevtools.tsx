import type { DevtoolsEventBusConfig } from '@shared/types/devtools'
import type { OpenWaggleApi } from '@shared/types/ipc'
import { aiDevtoolsPlugin } from '@tanstack/react-ai-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { useEffect, useState } from 'react'
import { env } from '@/env'

const DEFAULT_EVENT_BUS_CONFIG: DevtoolsEventBusConfig = {
  enabled: false,
  host: 'localhost',
  port: 4206,
  protocol: 'http',
}
const DEVTOOLS_PLUGINS = [aiDevtoolsPlugin()]

function getRuntimeApi(): OpenWaggleApi | null {
  if (typeof window === 'undefined') return null
  return 'api' in window ? window.api : null
}

export function TanStackAIDevtools(): React.JSX.Element | null {
  const [eventBusConfig, setEventBusConfig] =
    useState<DevtoolsEventBusConfig>(DEFAULT_EVENT_BUS_CONFIG)

  useEffect(() => {
    if (!env.isDevelopment) return
    const runtimeApi = getRuntimeApi()
    if (typeof runtimeApi?.getDevtoolsEventBusConfig !== 'function') return

    let cancelled = false
    void runtimeApi
      .getDevtoolsEventBusConfig()
      .then((nextConfig) => {
        if (!cancelled) {
          setEventBusConfig(nextConfig)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEventBusConfig(DEFAULT_EVENT_BUS_CONFIG)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (!env.isDevelopment) return null

  return (
    <TanStackDevtools
      plugins={DEVTOOLS_PLUGINS}
      eventBusConfig={{
        connectToServerBus: eventBusConfig.enabled,
        host: eventBusConfig.host,
        port: eventBusConfig.port,
        protocol: eventBusConfig.protocol,
      }}
    />
  )
}
