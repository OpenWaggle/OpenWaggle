export { CommandPalette } from './CommandPalette'
// The global palette is loaded lazily by the shell (`RightPanelCommandPalette`) from its own
// module. Re-exporting it here put it, and every command source it gathers, into the chat
// surface through the composer's skill palette (renderer-load B8).
