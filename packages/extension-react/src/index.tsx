import {
  OPENWAGGLE_EXTENSION_UI_ATTRIBUTES,
  OPENWAGGLE_EXTENSION_UI_CLASS_NAMES,
  type OpenWaggleExtensionUiButtonVariant,
  type OpenWaggleExtensionUiTone,
  openWaggleExtensionClassName,
} from '@openwaggle/extension-sdk'
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

export interface StackProps {
  readonly children?: ReactNode
  readonly className?: string
  readonly gap?: CSSProperties['gap']
  readonly ref?: Ref<HTMLDivElement>
  readonly style?: CSSProperties
}

export function Stack({ children, className, gap, ref, style }: StackProps) {
  return (
    <div
      ref={ref}
      className={openWaggleExtensionClassName(OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.stack, className)}
      style={{ ...style, ...(gap !== undefined ? { gap } : {}) }}
    >
      {children}
    </div>
  )
}

export interface PanelProps {
  readonly children?: ReactNode
  readonly className?: string
  readonly ref?: Ref<HTMLDivElement>
  readonly style?: CSSProperties
}

export function Panel({ children, className, ref, style }: PanelProps) {
  return (
    <section
      ref={ref}
      className={openWaggleExtensionClassName(OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.panel, className)}
      style={style}
    >
      {children}
    </section>
  )
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly ref?: Ref<HTMLButtonElement>
  readonly variant?: OpenWaggleExtensionUiButtonVariant
}

export function Button({ children, className, ref, variant = 'secondary', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      ref={ref}
      className={openWaggleExtensionClassName(
        OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.button,
        className,
      )}
      data-ow-variant={variant}
    >
      {children}
    </button>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly ref?: Ref<HTMLInputElement>
}

export function Input({ className, ref, ...props }: InputProps) {
  return (
    <input
      {...props}
      ref={ref}
      className={openWaggleExtensionClassName(OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.input, className)}
    />
  )
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly ref?: Ref<HTMLTextAreaElement>
}

export function Textarea({ className, ref, ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={openWaggleExtensionClassName(
        OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.textarea,
        className,
      )}
    />
  )
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly ref?: Ref<HTMLSelectElement>
}

export function Select({ children, className, ref, ...props }: SelectProps) {
  return (
    <select
      {...props}
      ref={ref}
      className={openWaggleExtensionClassName(
        OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.select,
        className,
      )}
    >
      {children}
    </select>
  )
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  readonly ref?: Ref<HTMLInputElement>
}

export function Checkbox({ className, ref, ...props }: CheckboxProps) {
  return (
    <input
      {...props}
      ref={ref}
      type="checkbox"
      className={openWaggleExtensionClassName(
        OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.checkbox,
        className,
      )}
    />
  )
}

export interface BadgeProps {
  readonly children?: ReactNode
  readonly className?: string
  readonly ref?: Ref<HTMLSpanElement>
  readonly tone?: OpenWaggleExtensionUiTone
}

export function Badge({ children, className, ref, tone = 'neutral' }: BadgeProps) {
  return (
    <span
      ref={ref}
      className={openWaggleExtensionClassName(OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.badge, className)}
      data-ow-tone={tone}
    >
      {children}
    </span>
  )
}

export interface AlertProps {
  readonly children?: ReactNode
  readonly className?: string
  readonly ref?: Ref<HTMLDivElement>
  readonly role?: 'alert' | 'status' | 'note'
  readonly tone?: OpenWaggleExtensionUiTone
}

export function Alert({ children, className, ref, role = 'status', tone = 'neutral' }: AlertProps) {
  return (
    <div
      ref={ref}
      role={role}
      className={openWaggleExtensionClassName(OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.alert, className)}
      data-ow-tone={tone}
    >
      {children}
    </div>
  )
}

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  readonly description?: ReactNode
  readonly error?: ReactNode
  readonly htmlFor?: string
  readonly label: ReactNode
  readonly ref?: Ref<HTMLDivElement>
}

export function Field({
  children,
  className,
  description,
  error,
  htmlFor,
  label,
  ref,
  ...props
}: FieldProps) {
  return (
    <div
      {...props}
      ref={ref}
      className={openWaggleExtensionClassName(OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.field, className)}
    >
      {htmlFor === undefined ? (
        <span className={OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.text}>{label}</span>
      ) : (
        <label className={OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.text} htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {description ? (
        <span className={OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.muted}>{description}</span>
      ) : null}
      {children}
      {error ? <span data-ow-tone="danger">{error}</span> : null}
    </div>
  )
}

export type { OpenWaggleExtensionUiButtonVariant, OpenWaggleExtensionUiTone }
export { OPENWAGGLE_EXTENSION_UI_ATTRIBUTES, OPENWAGGLE_EXTENSION_UI_CLASS_NAMES }
