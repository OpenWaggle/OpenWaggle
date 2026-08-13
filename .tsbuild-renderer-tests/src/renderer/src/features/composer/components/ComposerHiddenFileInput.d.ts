import type { RefObject } from 'react';
import type { UseFileAttachmentResult } from '../hooks/useFileAttachment';
interface ComposerHiddenFileInputProps {
    readonly fileInputRef: RefObject<HTMLInputElement | null>;
    readonly handleAttachFiles: UseFileAttachmentResult['handleAttachFiles'];
}
export declare function ComposerHiddenFileInput({ fileInputRef, handleAttachFiles, }: ComposerHiddenFileInputProps): import("node_modules/@types/react").JSX.Element;
export {};
