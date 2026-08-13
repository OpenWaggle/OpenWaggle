import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from '@/shared/lib/cn';
const TEXT_INPUT_BASE_CLASS = 'w-full border text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent/50';
const TEXT_INPUT_VARIANT_CLASS = {
    default: 'rounded-md border-border bg-bg',
    transparent: 'border-transparent bg-transparent focus:border-transparent',
};
const TEXT_INPUT_SIZE_CLASS = {
    sm: 'h-8 px-2.5 text-[13px]',
    md: 'px-3 py-2 text-sm',
};
/**
 * Shared text-like input primitive for visible user-editable fields.
 * Hidden/file inputs remain feature-specific because they are behavioral
 * capabilities, not styled UI controls.
 */
export function TextInput({ ref, variant = 'default', inputSize = 'md', monospace = false, className, ...props }) {
    return (_jsx("input", { ref: ref, className: cn(TEXT_INPUT_BASE_CLASS, TEXT_INPUT_VARIANT_CLASS[variant], TEXT_INPUT_SIZE_CLASS[inputSize], monospace && 'font-mono placeholder:font-sans', className), ...props }));
}
