// Narciso stores nothing. All data lives in memory and dies with the process.
// This is intentional: no logs, no chat history, no peer IDs, no session data persists.

const { app, BrowserWindow, session, screen, ipcMain, dialog } = require('electron')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

// Settings file — the ONE thing persisted to disk: interface preference only.
// Registered before app.whenReady so handlers are ready when the renderer loads.
ipcMain.handle('pv:get-network-interfaces', () => os.networkInterfaces())
ipcMain.on('pv:quit', () => app.quit())

ipcMain.handle('pv:read-settings', () => {
  try {
    const p = path.join(app.getPath('userData'), 'settings.json')
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch { return {} }
})

ipcMain.handle('pv:write-settings', (_, data) => {
  const p = path.join(app.getPath('userData'), 'settings.json')
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
})

// Received files live in memory only — this is the one explicit path to
// disk, triggered solely by the user clicking "Save" on a file message.
ipcMain.handle('pv:save-file', async (event, buffer, suggestedName) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: suggestedName })
  if (canceled || !filePath) return { saved: false }
  fs.writeFileSync(filePath, Buffer.from(buffer))
  return { saved: true, filePath }
})

const PARTITION = 'nopersist:narciso'

function createWindow() {
  // Non-persistent, cache-disabled session — nothing written to disk
  const ses = session.fromPartition(PARTITION, { cache: false })

  // Prevent WebRTC from advertising local/LAN IP addresses to peers
  ses.webRTCIPHandlingPolicy = 'default_public_interface_only'

  const { x: cx, y: cy } = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint({ x: cx, y: cy })
  const { x, y, width, height } = display.workArea
  const winW = 900, winH = 680
  const winX = Math.round(x + (width  - winW) / 2)
  const winY = Math.round(y + (height - winH) / 2)

  const win = new BrowserWindow({
    width: winW,
    height: winH,
    x: winX,
    y: winY,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#0a0a0f',
    title: 'Narciso',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // Block navigation away from the local file (no external URL loading)
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault()
  })

  // Block any popup or new-window requests
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return
    const devtoolsShortcut =
      input.key === 'F12' ||
      (input.control && input.shift && input.key.toLowerCase() === 'i')
    if (devtoolsShortcut) win.webContents.toggleDevTools()
  })

  win.loadFile(path.join(__dirname, 'index.html'))
  win.setMenuBarVisibility(false)
}

// Suppress verbose Chromium/WebRTC terminal output.
// Note: SCTP/DataChannel teardown errors from usrsctplib go directly to stderr
// and cannot be silenced via this switch — they are harmless (see README).
app.commandLine.appendSwitch('log-level', '3')

// Chromium tries Vulkan for GPU acceleration and on many Linux setups fails
// with "vkCreateInstance failed with VK_ERROR_INCOMPATIBLE_DRIVER", spamming
// the terminal. Display-only — falls back to GL/software rendering, no effect
// on WebRTC or app functionality.
app.commandLine.appendSwitch('disable-vulkan')
app.commandLine.appendSwitch('disable-gpu-sandbox')

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
