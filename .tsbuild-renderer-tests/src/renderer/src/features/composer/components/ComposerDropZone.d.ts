import type { ReactNode } from 'react';
import type { UseFileAttachmentResult } from '../hooks/useFileAttachment';
interface ComposerDropZoneProps {
    readonly fileAttachment: UseFileAttachmentResult;
    readonly children: ReactNode;
}
export declare function ComposerDropZone({ fileAttachment, children }: ComposerDropZoneProps): import("node_modules/@types/react").JSX.Element;
export {};
