/**
 * A command one of a Session's Pi extensions registers (`pi.registerCommand`). Typed as `/name`
 * at the start of a message, Pi runs it instead of sending the message to the model.
 */
export interface AgentExtensionCommand {
  readonly name: string
  readonly description?: string
}
