const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');

const LOG_FILE = path.join(app.getPath('userData'), 'main_process.log');
const log = (msg) => {
    console.log(msg);
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} - ${msg}\n`);
};

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
    log("--- Application Ready ---");
    const serverPath = path.join(__dirname, 'server.js');
    log(`Starting server at: ${serverPath}`);

    // For packaged app, help fork find the right context
    serverProcess = fork(serverPath, [], {
        env: { ...process.env, IS_ELECTRON: 'true' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    serverProcess.stdout.on('data', (data) => log(`[Server STDOUT] ${data}`));
    serverProcess.stderr.on('data', (data) => log(`[Server STDERR] ${data}`));

    serverProcess.on('error', (err) => log(`[Server Error] ${err.message}`));
    serverProcess.on('exit', (code) => log(`[Server Exit] Code: ${code}`));

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
