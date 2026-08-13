import { useRef, useState } from 'react';
import { useClickOutside } from '@/shared/hooks/useClickOutside';
export function usePopover(options = {}) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);
    function open() {
        setIsOpen(true);
    }
    function close() {
        setIsOpen(false);
        options.onClose?.();
    }
    function toggle() {
        if (isOpen) {
            close();
        }
        else {
            open();
        }
    }
    useClickOutside(containerRef, close, options.isActive ?? isOpen);
    return { isOpen, open, close, toggle, containerRef };
}
