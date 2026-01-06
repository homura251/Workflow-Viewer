import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

type WorkflowPayload =
  | { ok: true; sourcePath: string; workflow: unknown }
  | { ok: false; sourcePath?: string; error: string }

function buildMenu(window: BrowserWindow) {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(window, {
              properties: ['openFile'],
              filters: [
                { name: 'ComfyUI Workflow', extensions: ['json', 'png'] },
                { name: 'All Files', extensions: ['*'] }
              ]
            })
            if (result.canceled || result.filePaths.length === 0) return
            window.webContents.send('workflow:open-path', result.filePaths[0]!)
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'ComfyUI',
          click: async () => {
            await shell.openExternal('https://github.com/comfyanonymous/ComfyUI')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function parsePngTextChunks(buffer: Buffer): Record<string, string> {
  const signature = buffer.subarray(0, 8)
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!signature.equals(pngSignature)) throw new Error('Not a PNG file')

  const text: Record<string, string> = {}
  let offset = 8

  const readUInt32BE = (at: number) => buffer.readUInt32BE(at)

  while (offset + 12 <= buffer.length) {
    const length = readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const next = dataEnd + 4
    if (next > buffer.length) break

    if (type === 'tEXt') {
      const data = buffer.subarray(dataStart, dataEnd)
      const nullIndex = data.indexOf(0)
      if (nullIndex > 0) {
        const key = data.subarray(0, nullIndex).toString('latin1')
        const value = data.subarray(nullIndex + 1).toString('latin1')
        text[key] = value
      }
    } else if (type === 'iTXt') {
      const data = buffer.subarray(dataStart, dataEnd)
      let i = 0
      const keyEnd = data.indexOf(0, i)
      if (keyEnd <= 0) {
        offset = next
        continue
      }
      const key = data.subarray(i, keyEnd).toString('latin1')
      i = keyEnd + 1
      const compressionFlag = data[i]
      i += 1
      i += 1 // compression method

      const languageTagEnd = data.indexOf(0, i)
      if (languageTagEnd < 0) {
        offset = next
        continue
      }
      i = languageTagEnd + 1

      const translatedKeywordEnd = data.indexOf(0, i)
      if (translatedKeywordEnd < 0) {
        offset = next
        continue
      }
      i = translatedKeywordEnd + 1

      let valueBytes = data.subarray(i)
      try {
        if (compressionFlag === 1) valueBytes = zlib.inflateSync(valueBytes)
        text[key] = valueBytes.toString('utf8')
      } catch {
        // ignore malformed iTXt payload
      }
    }

    offset = next
    if (type === 'IEND') break
  }

  return text
}

function parseWorkflowFromAny(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed)
  }
  return value
}

async function loadWorkflowFromFile(sourcePath: string): Promise<WorkflowPayload> {
  try {
    const extension = extname(sourcePath).toLowerCase()
    const buffer = await readFile(sourcePath)

    if (extension === '.json') {
      let json: unknown = JSON.parse(buffer.toString('utf8'))
      if (json && typeof json === 'object' && 'workflow' in json) {
        const embedded = (json as any).workflow
        if (embedded != null) json = parseWorkflowFromAny(embedded)
      }
      return { ok: true, sourcePath, workflow: json }
    }

    if (extension === '.png') {
      const text = parsePngTextChunks(buffer)
      const rawWorkflow = text['workflow'] ?? text['Workflow']
      if (!rawWorkflow) return { ok: false, sourcePath, error: 'PNG metadata missing workflow field' }
      let parsed: unknown = rawWorkflow
      try {
        parsed = JSON.parse(rawWorkflow)
      } catch {
        // rawWorkflow is not JSON, keep as string
      }
      parsed = parseWorkflowFromAny(parsed)
      return { ok: true, sourcePath, workflow: parsed }
    }

    return { ok: false, sourcePath, error: `Unsupported file type: ${extension || '(none)'}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, sourcePath, error: message }
  }
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.mjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  buildMenu(window)

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL)
    window.webContents.openDevTools({ mode: 'detach' })
  } else {
    await window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
  }

  return window
}

app.whenReady().then(async () => {
  const window = await createWindow()

  ipcMain.handle('workflow:open-dialog', async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [
        { name: 'ComfyUI Workflow', extensions: ['json', 'png'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]!
  })

  ipcMain.handle('workflow:read-file', async (_event, sourcePath: string) => {
    return loadWorkflowFromFile(sourcePath)
  })

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
