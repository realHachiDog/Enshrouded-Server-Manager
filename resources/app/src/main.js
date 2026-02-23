const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');

const ROOT_LOG_DIR = path.join(process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : '/var/local'), 'EDManager');
if (!fs.existsSync(ROOT_LOG_DIR)) fs.mkdirSync(ROOT_LOG_DIR, { recursive: true });
const LOG_FILE = path.join(ROOT_LOG_DIR, 'main_process.log');

const log = (msg) => {
    const line = `${new Date().toISOString()} - ${msg}\n`;
    console.log(msg);
    try { fs.appendFileSync(LOG_FILE, line); } catch (e) { }
};

process.on('uncaughtException', (err) => {
    log(`CRITICAL MAIN ERROR (Uncaught): ${err.stack || err}`);
});

log("--- Main Process Starting ---");

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

    mainWindow.loadURL('http://127.0.0.1:3001');

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
    log(`Starting server via fork: ${serverPath}`);

    try {
        // In some environments, fork needs the electron path to know how to run
        serverProcess = fork(serverPath, [], {
            execPath: process.execPath,
            env: {
                ...process.env,
                IS_ELECTRON: 'true',
                ELECTRON_RUN_AS_NODE: '1'
            },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        });

        serverProcess.stdout.on('data', (data) => log(`[Server STDOUT] ${data}`));
        serverProcess.stderr.on('data', (data) => {
            const msg = data.toString();
            log(`[Server STDERR] ${msg}`);
            // Also write to a dedicated error log
            const errorLogPath = path.join(app.getPath('userData'), 'server_error.log');
            fs.appendFileSync(errorLogPath, `${new Date().toISOString()} - ${msg}\n`);
        });

        serverProcess.on('error', (err) => log(`[Server Error] ${err.message}`));
        serverProcess.on('exit', (code) => {
            log(`[Server Exit] Code: ${code}`);
            // If it crashes immediately, we might want to tell the user
        });
    } catch (e) {
        log(`[Critical] Fork failed: ${e.message}`);
    }

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
