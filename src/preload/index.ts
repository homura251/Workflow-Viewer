import { contextBridge, ipcRenderer } from 'electron'

export type WorkflowPayload =
  | { ok: true; sourcePath: string; workflow: unknown }
  | { ok: false; sourcePath?: string; error: string }

export type WorkflowCommand =
  | 'zoom-in'
  | 'zoom-out'
  | 'reset-view'
  | 'fit'
  | 'toggle-sidebar'
  | 'close-tab'
  | 'next-tab'
  | 'prev-tab'

const api = {
  openDialog: () => ipcRenderer.invoke('workflow:open-dialog') as Promise<string | null>,
  readFile: (sourcePath: string) =>
    ipcRenderer.invoke('workflow:read-file', sourcePath) as Promise<WorkflowPayload>,
  writeClipboardText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text) as Promise<boolean>,
  onOpenPath: (handler: (path: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, path: string) => handler(path)
    ipcRenderer.on('workflow:open-path', listener)
    return () => ipcRenderer.off('workflow:open-path', listener)
  },
  onCommand: (handler: (command: WorkflowCommand) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: WorkflowCommand) => handler(command)
    ipcRenderer.on('workflow:command', listener)
    return () => ipcRenderer.off('workflow:command', listener)
  }
}

contextBridge.exposeInMainWorld('workflowViewer', api)

