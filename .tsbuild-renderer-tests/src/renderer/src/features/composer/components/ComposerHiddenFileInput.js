import { jsx as _jsx } from "react/jsx-runtime";
export function ComposerHiddenFileInput({ fileInputRef, handleAttachFiles, }) {
    function attachSelectedFiles(event) {
        void handleAttachFiles(event);
    }
    return (_jsx("input", { ref: fileInputRef, type: "file", multiple: true, "aria-label": "Attach files", className: "hidden", onChange: attachSelectedFiles }));
}
