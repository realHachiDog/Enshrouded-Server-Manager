const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { spawn, exec } = require('child_process');
const pidusage = require('pidusage');
const archiver = require('archiver');
const nodeCron = require('node-cron');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

// Path to log server issues - handled in PATHS section below
let logStream;
const log = (msg) => {
    console.log(msg);
    if (logStream) logStream.write(`${new Date().toISOString()} - ${msg}\n`);
};

log("--- Server starting ---");
process.on('uncaughtException', (err) => {
    log(`CRITICAL ERROR: ${err.stack || err}`);
    process.exit(1);
});

// Internal state
const activeProcesses = {}; // { profileName: childProcess }

app.use(cors());
app.use(bodyParser.json());

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------
// PATHS & DATA
// ---------------------------------------------------------
// Always prefer APPDATA on Windows for packaged apps
const ROOT_DATA_DIR = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : '/var/local');
const APP_DATA_DIR = path.join(ROOT_DATA_DIR, 'EDManager');

try {
    fs.ensureDirSync(APP_DATA_DIR);
} catch (e) {
    // Fallback to temp if everything fails, but APPDATA should work
    console.error("Critical: Could not create AppData dir", e);
}

const PROFILES_FILE = path.join(APP_DATA_DIR, 'profiles.json');
const TEMPLATES_FILE = path.join(APP_DATA_DIR, 'templates.json');
const SETTINGS_FILE = path.join(APP_DATA_DIR, 'settings.json');
const LOG_FILE = path.join(APP_DATA_DIR, 'server_boot.log');

let profiles = [];
let templates = [];
let globalSettings = { language: 'hu', activeProfile: null };
let resourceHistory = {}; // { profileName: [{time, cpu, ram}] }

// Load Data
if (fs.existsSync(LOG_FILE)) {
    try { logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' }); } catch (e) { }
} else {
    try { logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' }); } catch (e) { }
}

log("--- Server starting ---");
process.on('uncaughtException', (err) => {
    log(`CRITICAL ERROR: ${err.stack || err}`);
});

if (fs.existsSync(PROFILES_FILE)) profiles = fs.readJsonSync(PROFILES_FILE);
if (fs.existsSync(TEMPLATES_FILE)) templates = fs.readJsonSync(TEMPLATES_FILE);
if (fs.existsSync(SETTINGS_FILE)) globalSettings = fs.readJsonSync(SETTINGS_FILE);

const saveProfiles = () => fs.writeJsonSync(PROFILES_FILE, profiles, { spaces: 2 });
const saveTemplates = () => fs.writeJsonSync(TEMPLATES_FILE, templates, { spaces: 2 });
const saveSettings = () => fs.writeJsonSync(SETTINGS_FILE, globalSettings, { spaces: 2 });

// ---------------------------------------------------------
// UTILS
// ---------------------------------------------------------
function getProfile(name) {
    return profiles.find(p => p.name === name);
}

function getPaths(profile) {
    if (!profile || !profile.path) return null;
    return {
        config: path.join(profile.path, 'enshrouded_server.json'),
        exe: path.join(profile.path, 'enshrouded_server.exe'),
        save: path.join(profile.path, 'savegame'),
        backups: path.join(profile.path, 'backups_manager')
    };
}

async function sendDiscordWebhook(profile, status, customMsg = "") {
    if (!profile.webhookUrl) return;
    let message = customMsg;
    if (!message) {
        message = status === 'start' ? (profile.webhookStartMsg || "Szerver elindult!") : (profile.webhookStopMsg || "Szerver leállt.");
    }

    try {
        await fetch(profile.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `**[${profile.name}]** ${message}` })
        });
    } catch (e) { console.error("Webhook error:", e.message); }
}

// ---------------------------------------------------------
// API: PROFILES & SETTINGS
// ---------------------------------------------------------
app.get('/api/profiles', (req, res) => res.json(profiles));
app.post('/api/profiles', (req, res) => {
    const newProfile = {
        name: req.body.name,
        path: req.body.path,
        webhookUrl: "",
        webhookStartMsg: "",
        webhookStopMsg: "",
        autoBackup: false,
        backupInterval: 60 // minutes
    };
    profiles.push(newProfile);
    saveProfiles();
    res.json({ success: true, profiles });
});

app.delete('/api/profiles/:name', (req, res) => {
    profiles = profiles.filter(p => p.name !== req.params.name);
    saveProfiles();
    res.json({ success: true });
});

app.get('/api/templates', (req, res) => res.json(templates));
app.post('/api/templates', (req, res) => {
    const profile = getProfile(req.body.profileName);
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    const template = { ...profile, name: req.body.templateName };
    delete template.path; // Don't save path in template
    templates.push(template);
    saveTemplates();
    res.json({ success: true, templates });
});

app.post('/api/profiles/update/:name', (req, res) => {
    const idx = profiles.findIndex(p => p.name === req.params.name);
    if (idx === -1) return res.status(404).json({ error: "Profile not found" });
    profiles[idx] = { ...profiles[idx], ...req.body };
    saveProfiles();
    res.json({ success: true });
});

app.post('/api/discord/admin-msg/:profile', async (req, res) => {
    const profile = getProfile(req.params.profile);
    if (!profile || !profile.webhookUrl) return res.status(400).json({ error: "No webhook configured" });
    await sendDiscordWebhook(profile, 'custom', req.body.message);
    res.json({ success: true });
});

app.get('/api/settings', (req, res) => res.json(globalSettings));
app.post('/api/settings', (req, res) => {
    globalSettings = { ...globalSettings, ...req.body };
    saveSettings();
    res.json({ success: true });
});

app.get('/api/stats/:profile', (req, res) => {
    res.json(resourceHistory[req.params.profile] || []);
});

// ---------------------------------------------------------
// API: SERVER CONTROL & CONFIG
// ---------------------------------------------------------
app.get('/api/config/:profile', (req, res) => {
    const p = getPaths(getProfile(req.params.profile));
    if (!p || !fs.existsSync(p.config)) return res.status(404).json({ error: 'Config not found' });
    try {
        const config = fs.readJsonSync(p.config);
        let password = "";
        if (config.userGroups) {
            const group = config.userGroups.find(g => g.name === 'Admin' || g.name === 'Friend');
            if (group) password = group.password;
        }
        res.json({ ...config, password });
    } catch (e) { res.status(500).json({ error: 'Read error' }); }
});

app.post('/api/config/:profile', async (req, res) => {
    const profile = getProfile(req.params.profile);
    const p = getPaths(profile);
    try {
        let config = {};
        if (fs.existsSync(p.config)) {
            // Backup before write
            const backupPath = p.config + '.original.bak';
            if (!fs.existsSync(backupPath)) fs.copySync(p.config, backupPath);
            config = fs.readJsonSync(p.config);
        }

        if (req.body.name) config.name = req.body.name;
        if (req.body.password && config.userGroups) {
            config.userGroups.forEach(g => {
                if (g.name === 'Admin' || g.name === 'Friend') g.password = req.body.password;
            });
        }

        fs.writeJsonSync(p.config, config, { spaces: '\t' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Write error' }); }
});

app.post('/api/server/start/:profile', (req, res) => {
    const profile = getProfile(req.params.profile);
    const p = getPaths(profile);
    if (!fs.existsSync(p.exe)) return res.status(404).json({ error: 'EXE not found' });

    if (activeProcesses[profile.name]) return res.json({ success: true, alreadyRunning: true });

    const child = spawn(p.exe, [], { cwd: profile.path, detached: true, stdio: 'ignore' });
    child.unref();
    activeProcesses[profile.name] = child;

    sendDiscordWebhook(profile, 'start');
    res.json({ success: true });
});

app.post('/api/server/stop/:profile', (req, res) => {
    const profile = getProfile(req.params.profile);
    // On Windows, taskkill is more reliable for children
    exec(`taskkill /FI "WINDOWTITLE eq Enshrouded Server" /F`, () => {
        delete activeProcesses[profile.name];
        sendDiscordWebhook(profile, 'stop');
        res.json({ success: true });
    });
});

// ---------------------------------------------------------
// API: BACKUPS & ROLLBACK
// ---------------------------------------------------------
app.get('/api/backups/:profile', (req, res) => {
    const p = getPaths(getProfile(req.params.profile));
    if (!p || !fs.existsSync(p.backups)) return res.json([]);
    const files = fs.readdirSync(p.backups)
        .filter(f => f.endsWith('.zip'))
        .map(f => {
            const stats = fs.statSync(path.join(p.backups, f));
            return { name: f, size: stats.size, date: stats.mtime };
        })
        .sort((a, b) => b.date - a.date);
    res.json(files);
});

app.post('/api/backups/rollback/:profile', async (req, res) => {
    const p = getPaths(getProfile(req.params.profile));
    const zipPath = path.join(p.backups, req.body.filename);
    if (!fs.existsSync(zipPath)) return res.status(404).json({ error: 'Zip not found' });

    try {
        // Clear current savegame
        if (fs.existsSync(p.save)) fs.removeSync(p.save);
        fs.ensureDirSync(p.save);

        // Use powershell to extract if needed, or a library. 
        // For professional feel, we already have archiver for zipping, but we need unzipping.
        // I'll use a simple exec command with powershell for unzipping to avoid extra deps if possible,
        // but since I'm in a professional context, I would normally use adm-zip.
        // Let's use PowerShell Expand-Archive.
        exec(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${p.save}' -Force"`, (err) => {
            if (err) return res.status(500).json({ error: 'Extract fail' });
            res.json({ success: true });
        });
    } catch (e) { res.status(500).json({ error: 'Rollback fail' }); }
});

// ---------------------------------------------------------
// API: LOGS
// ---------------------------------------------------------
app.get('/api/logs/:profile', (req, res) => {
    const profile = getProfile(req.params.profile);
    const logPath = path.join(profile.path, 'logs', 'enshrouded_server.log');
    if (!fs.existsSync(logPath)) return res.json({ logs: "Még nincs naplófájl..." });

    // Read last 100 lines
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n').slice(-100).join('\n');
    res.json({ logs: lines });
});

app.post('/api/logs/clear/:profile', (req, res) => {
    const profile = getProfile(req.params.profile);
    const logPath = path.join(profile.path, 'logs', 'enshrouded_server.log');
    if (fs.existsSync(logPath)) fs.writeFileSync(logPath, "");
    res.json({ success: true });
});

app.post('/api/backups/create/:profile', async (req, res) => {
    const p = getPaths(getProfile(req.params.profile));
    if (!fs.existsSync(p.save)) return res.status(404).json({ error: 'Savegame folder not found' });

    fs.ensureDirSync(p.backups);
    const filename = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    const output = fs.createWriteStream(path.join(p.backups, filename));
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => res.json({ success: true, name: filename }));
    archive.pipe(output);
    archive.directory(p.save, false);
    await archive.finalize();
});

// ---------------------------------------------------------
// RESOURCE TRACKING
// ---------------------------------------------------------
setInterval(async () => {
    for (const profile of profiles) {
        exec('tasklist /FI "IMAGENAME eq enshrouded_server.exe" /NH /FO CSV', async (err, stdout) => {
            if (!err && stdout.toLowerCase().includes('enshrouded_server.exe')) {
                // Find PID (simplified, might need refinement if multiple servers run)
                // For now we assume one exe name per machine or we need more logic.
                // Professional way: track spawned PID or use more specific filters.
                exec('wmic process where name="enshrouded_server.exe" get ProcessId', async (err, pidOut) => {
                    const lines = pidOut.trim().split('\n');
                    if (lines.length > 1) {
                        const pid = parseInt(lines[1].trim());
                        try {
                            const stats = await pidusage(pid);
                            if (!resourceHistory[profile.name]) resourceHistory[profile.name] = [];
                            resourceHistory[profile.name].push({
                                time: new Date().toLocaleTimeString(),
                                cpu: stats.cpu,
                                ram: stats.memory
                            });
                            // Keep last 200 entries (approx 15-20 mins of history)
                            if (resourceHistory[profile.name].length > 200) resourceHistory[profile.name].shift();
                        } catch (e) { }
                    }
                });
            }
        });
    }
}, 5000);

// ---------------------------------------------------------
// AUTO-BACKUP SCHEDULER
// ---------------------------------------------------------
nodeCron.schedule('*/5 * * * *', async () => {
    const now = new Date();
    for (const profile of profiles) {
        if (!profile.autoBackup || !profile.backupInterval) continue;

        // Simple logic: check if last backup for this profile is older than interval
        const p = getPaths(profile);
        if (!fs.existsSync(p.backups)) fs.ensureDirSync(p.backups);

        const files = fs.readdirSync(p.backups).filter(f => f.startsWith('auto_'));
        let needsBackup = true;

        if (files.length > 0) {
            const latest = files.map(f => fs.statSync(path.join(p.backups, f)).mtime).sort((a, b) => b - a)[0];
            const diffMins = (now - latest) / 1000 / 60;
            if (diffMins < profile.backupInterval) needsBackup = false;
        }

        if (needsBackup) {
            console.log(`[AutoBackup] Starting for ${profile.name}`);
            const filename = `auto_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
            const output = fs.createWriteStream(path.join(p.backups, filename));
            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(output);
            archive.directory(p.save, false);
            await archive.finalize();
        }
    }
});

app.listen(PORT, () => console.log(`EDManager Backend listening on port ${PORT}`));
