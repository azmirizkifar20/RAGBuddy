/** Bridge to `electron/preload.js` — only present when this page is loaded inside the
 *  Electron shell's `BrowserWindow`, `undefined` in a normal browser tab. */
export interface ElectronAPI {
  isElectron: true
  platform: string
  minimizeWindow: () => void
  toggleMaximizeWindow: () => void
  closeWindow: () => void
  /** Returns an unsubscribe function, mirroring a React effect cleanup. */
  onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export function getElectronAPI(): ElectronAPI | undefined {
  return typeof window === 'undefined' ? undefined : window.electronAPI
}
