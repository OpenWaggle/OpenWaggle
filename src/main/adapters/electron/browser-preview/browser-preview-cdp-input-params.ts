/**
 * The parameters of a Chrome DevTools Protocol command. Each command declares its own fields, so
 * the automation layer passes them through as an object and reads only the input fields below.
 */
export type CdpCommandParams = object

/** The `Input.dispatchKeyEvent` and `Input.dispatchMouseEvent` fields input arbitration reads. */
export interface CdpInputEventParams {
  readonly type: string
  readonly key: string
  readonly code: string
  readonly location: number
  readonly modifiers: number
  readonly x: number
  readonly y: number
  readonly button: string
  readonly deltaX: number
  readonly deltaY: number
}
