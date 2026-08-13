import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from '@/shared/lib/cn';
const RANGE_INPUT_CLASS = 'accent-accent';
export function RangeInput({ ref, className, ...props }) {
    return _jsx("input", { ref: ref, type: "range", className: cn(RANGE_INPUT_CLASS, className), ...props });
}
