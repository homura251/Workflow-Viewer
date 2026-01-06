export {}

declare global {
  type WorkflowCommand =
    | 'zoom-in'
    | 'zoom-out'
    | 'reset-view'
    | 'fit'
    | 'toggle-sidebar'
    | 'close-tab'
    | 'next-tab'
    | 'prev-tab'

  interface Window {
    workflowViewer: {
      openDialog: () => Promise<string | null>
      readFile: (
        sourcePath: string
      ) => Promise<
        | { ok: true; sourcePath: string; workflow: unknown }
        | { ok: false; sourcePath?: string; error: string }
      >
      onOpenPath: (handler: (path: string) => void) => () => void
      onCommand: (handler: (command: WorkflowCommand) => void) => () => void
    }
  }
}

