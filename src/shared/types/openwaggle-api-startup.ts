import type { GuiStartupStatus } from './gui-startup'

/** The GUI's startup state, and what main passes the preload when it creates the window. */
export interface OpenWaggleStartupApi {
  /** The user's home directory, for display paths only (`~`); null when main passed none. */
  getHomeDirectory(): string | null
  getStartupStatus(): Promise<GuiStartupStatus>
  retryStartup(): Promise<void>
  onStartupStatusChanged(callback: (status: GuiStartupStatus) => void): () => void
}
