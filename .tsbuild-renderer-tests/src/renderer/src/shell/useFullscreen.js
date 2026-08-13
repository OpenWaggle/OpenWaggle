import { useEffect, useState } from 'react';
import { api } from '@/shared/lib/ipc';
export function useFullscreen() {
    const [isFullscreen, setIsFullscreen] = useState(false);
    useEffect(() => {
        return api.onFullscreenChanged(setIsFullscreen);
    }, []);
    return isFullscreen;
}
