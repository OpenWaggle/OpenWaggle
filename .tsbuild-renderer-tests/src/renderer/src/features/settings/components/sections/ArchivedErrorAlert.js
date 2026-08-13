import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from '@/shared/lib/cn';
export function ArchivedErrorAlert({ message, subtle = false }) {
    return (_jsx("p", { role: "alert", className: cn('rounded-md px-3 py-2 text-[13px] text-error', subtle ? 'border border-error/20 bg-error/5' : 'border border-error/30 bg-error/10'), children: message }));
}
