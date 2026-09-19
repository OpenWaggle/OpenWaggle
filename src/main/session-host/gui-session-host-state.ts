let attachedToRemoteSessionHost = false

export function setGuiAttachedToRemoteSessionHost(attached: boolean) {
  attachedToRemoteSessionHost = attached
}

export function isGuiAttachedToRemoteSessionHost() {
  return attachedToRemoteSessionHost
}
