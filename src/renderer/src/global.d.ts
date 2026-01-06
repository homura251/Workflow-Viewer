export {}

declare global {
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
    }
  }
}

