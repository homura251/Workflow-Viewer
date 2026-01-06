import { contextBridge, ipcRenderer } from 'electron'

export type WorkflowPayload =
  | { ok: true; sourcePath: string; workflow: unknown }
  | { ok: false; sourcePath?: string; error: string }

const api = {
  openDialog: () => ipcRenderer.invoke('workflow:open-dialog') as Promise<string | null>,
  readFile: (sourcePath: string) =>
    ipcRenderer.invoke('workflow:read-file', sourcePath) as Promise<WorkflowPayload>,
  onOpenPath: (handler: (path: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, path: string) => handler(path)
    ipcRenderer.on('workflow:open-path', listener)
    return () => ipcRenderer.off('workflow:open-path', listener)
  }
}

contextBridge.exposeInMainWorld('workflowViewer', api)

