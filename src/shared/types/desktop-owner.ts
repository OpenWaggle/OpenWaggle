/** Clean closure is an explicit native-resource cleanup receipt, never a lease timeout. */
export interface DesktopOwnerRecord {
  readonly guiInstanceId: string
  readonly hostInstanceId: string
  readonly state: 'active' | 'closed'
}
