import { jsx as _jsx } from "react/jsx-runtime";
import { TextInput } from '@/shared/ui/TextInput';
export function ActionDialogInput({ inputRef, value, placeholder, onValueChange, onConfirm, }) {
    if (!placeholder)
        return null;
    function handleKeyDown(event) {
        if (event.key !== 'Enter')
            return;
        event.preventDefault();
        void onConfirm();
    }
    return (_jsx(TextInput, { ref: inputRef, value: value, onChange: (event) => onValueChange(event.target.value), onKeyDown: handleKeyDown, placeholder: placeholder, inputSize: "sm", className: "mt-3 h-9 border-border" }));
}
