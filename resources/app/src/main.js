const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow;
let tray;
let serverProcess;
let isQuitting = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 850,
        backgroundColor: '#0f172a',
        icon: path.join(__dirname, '..', 'public', 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadURL('http://localhost:3000');

    // Hide to tray on close
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });
}

function createTray() {
    tray = new Tray(path.join(__dirname, '..', 'public', 'icon.ico'));
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show App', click: () => mainWindow.show() },
        {
            label: 'Quit', click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.setToolTip('EDManager');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow.show());
}

app.whenReady().then(() => {
    // Start backend
    serverProcess = fork(path.join(__dirname, 'server.js'), [], {
        env: { ...process.env, IS_ELECTRON: 'true' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    serverProcess.stdout.on('data', (data) => console.log(`[Server] ${data}`));
    serverProcess.stderr.on('data', (data) => console.error(`[Server Error] ${data}`));

    createWindow();
    createTray();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('before-quit', () => isQuitting = true);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (serverProcess) serverProcess.kill();
        app.quit();
    }
});

// IPC: Folder selection dialog
ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    return canceled ? null : filePaths[0];
});

// IPC: Minimize to tray manually
ipcMain.on('app:minimizeToTray', () => {
    mainWindow.hide();
});
