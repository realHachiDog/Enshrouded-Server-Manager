let activeProfile = null;
let profiles = [];
let chart = null;
let translations = {};

// ---------------------------------------------------------
// INITIALIZATION
// ---------------------------------------------------------
async function init() {
    let retries = 0;
    const maxRetries = 10;

    while (retries < maxRetries) {
        try {
            await fetchSettings();
            await fetchProfiles();

            // Success! Hide loading
            document.getElementById('loading-overlay').style.display = 'none';

            if (profiles.length === 0) {
                showProfileSelect();
                showNewProfileForm();
            } else if (!activeProfile) {
                showProfileSelect();
            } else {
                loadDashboard();
            }
            return;
        } catch (e) {
            retries++;
            console.warn(`Connection attempt ${retries} failed...`);
            document.getElementById('loading-msg').innerText = `Szerver csatlakozás sikertelen (${retries}/${maxRetries})... Újrapróbálás...`;
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Final fail
    document.getElementById('loading-title').innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Hiba';
    document.getElementById('loading-msg').innerText = "Nem sikerült kapcsolódni a belső szerverhez. Kérlek indítsd újra a programot!";
    document.getElementById('btn-retry').style.display = 'block';
}

async function fetchSettings() {
    const resp = await fetch('/api/settings');
    const settings = await resp.json();
    document.getElementById('mgr-lang').value = settings.language;
    await loadTranslations(settings.language);
}

async function loadTranslations(lang) {
    try {
        const resp = await fetch(`/locales/${lang}.json`);
        translations = await resp.json();
        applyTranslations();
    } catch (e) { console.error("i18n fail", e); }
}

function applyTranslations() {
    // Basic labels
    document.getElementById('setup-title').innerText = translations.setupTitle || "Szerver Menedzser";
    // More elements as needed...
}

// ---------------------------------------------------------
// PROFILES
// ---------------------------------------------------------
async function fetchProfiles() {
    const resp = await fetch('/api/profiles');
    profiles = await resp.json();
    renderProfilesGrid();
}

function renderProfilesGrid() {
    const grid = document.getElementById('profiles-grid');
    grid.innerHTML = '';
    profiles.forEach(p => {
        const card = document.createElement('div');
        card.className = 'profile-card';
        card.innerHTML = `<i class="fa-solid fa-server"></i><span>${p.name}</span>`;
        card.onclick = () => selectProfile(p.name);
        grid.appendChild(card);
    });
}

async function selectProfile(name) {
    activeProfile = profiles.find(p => p.name === name);
    document.getElementById('header-profile-name').innerText = name;
    document.getElementById('setup-overlay').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    loadDashboard();
}

async function createNewProfile() {
    const name = document.getElementById('new-prof-name').value;
    const path = document.getElementById('new-prof-path').value;
    if (!name || !path) return showToast("Minden mezőt tölts ki!", true);

    const resp = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, path })
    });
    if (resp.ok) {
        await fetchProfiles();
        showProfileSelect();
        showToast("Profil létrehozva!");
    }
}

// ---------------------------------------------------------
// DASHBOARD & GRAPH
// ---------------------------------------------------------
function loadDashboard() {
    showTab('dashboard');
    initChart();
    updateLoop();
}

function initChart() {
    const ctx = document.getElementById('resourceChart').getContext('2d');
    if (chart) chart.destroy();

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'CPU (%)',
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    data: [],
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'RAM (GB)',
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    data: [],
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            },
            plugins: { legend: { labels: { color: '#94a3b8' } } }
        }
    });
}

async function updateLoop() {
    if (!activeProfile) return;

    // Status & Stats
    const statsResp = await fetch(`/api/stats/${activeProfile.name}`);
    const history = await statsResp.json();

    if (history.length > 0) {
        const last = history[history.length - 1];
        document.getElementById('cpu-current').innerText = `${Math.round(last.cpu)}%`;
        document.getElementById('ram-current').innerText = `${Math.round(last.ram / 1024 / 1024)} MB`;

        // Update Chart
        chart.data.labels = history.map(h => h.time);
        chart.data.datasets[0].data = history.map(h => h.cpu);
        chart.data.datasets[1].data = history.map(h => h.ram / 1024 / 1024 / 1024); // GB
        chart.update('none');
    }

    // Check running status
    // (Simplified logic for now, would be a separate API call)

    setTimeout(updateLoop, 3000);
}

// ---------------------------------------------------------
// ACTIONS
// ---------------------------------------------------------
async function startServer() {
    if (!activeProfile) return;
    showToast("Indítás folyamatban...");
    await fetch(`/api/server/start/${activeProfile.name}`, { method: 'POST' });
}

// ---------------------------------------------------------
// BACKUPS & ROLLBACK
// ---------------------------------------------------------
async function fetchBackups() {
    if (!activeProfile) return;
    const resp = await fetch(`/api/backups/${activeProfile.name}`);
    const backups = await resp.json();
    const list = document.getElementById('backup-list');
    list.innerHTML = backups.map(b => `
        <div class="stat-card mt-2 justify-between">
            <div class="flex-row gap-3">
                <i class="fa-solid fa-file-zipper"></i>
                <div class="stat-info">
                    <span class="value">${b.name}</span>
                    <span class="label">${new Date(b.date).toLocaleString()} (${Math.round(b.size / 1024 / 1024)} MB)</span>
                </div>
            </div>
            <button class="btn btn-warning btn-sm" onclick="confirmRollback('${b.name}')">Rollback</button>
        </div>
    `).join('');
}

function confirmRollback(filename) {
    showConfirm("Visszaállítás", `Biztosan visszaállítod a mentést? (${filename}) Minden jelenlegi játékmentés elveszik!`, async () => {
        showToast("Visszaállítás folyamatban...");
        const resp = await fetch(`/api/backups/rollback/${activeProfile.name}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        });
        if (resp.ok) showToast("Visszaállítás sikeres!");
        else showToast("Hiba a visszaállítás során.", true);
    });
}

async function createBackup() {
    if (!activeProfile) return;
    showToast("Mentés készítése...");
    const resp = await fetch(`/api/backups/create/${activeProfile.name}`, { method: 'POST' });
    if (resp.ok) { showToast("Sikeres mentés!"); fetchBackups(); }
}

// ---------------------------------------------------------
// DISCORD & CONSOLE
// ---------------------------------------------------------
async function saveWebhookSettings() {
    if (!activeProfile) return;
    const data = {
        webhookUrl: document.getElementById('webhook-url').value,
        webhookStartMsg: document.getElementById('webhook-start-msg').value,
        webhookStopMsg: document.getElementById('webhook-stop-msg').value
    };
    const resp = await fetch(`/api/profiles/update/${activeProfile.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (resp.ok) {
        showToast("Webhook beállítások mentve!");
        // Update local state
        Object.assign(activeProfile, data);
    }
}

async function sendAdminWebhook() {
    const msg = document.getElementById('admin-discord-msg').value;
    if (!msg) return;
    const resp = await fetch(`/api/discord/admin-msg/${activeProfile.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
    });
    if (resp.ok) {
        showToast("Discord üzenet elküldve!");
        document.getElementById('admin-discord-msg').value = '';
    } else {
        showToast("Hiba! (Nincs webhook?)", true);
    }
}

async function fetchLogs() {
    if (!activeProfile) return;
    const resp = await fetch(`/api/logs/${activeProfile.name}`);
    const { logs } = await resp.json();
    const view = document.getElementById('console-view');
    view.innerText = logs;
    view.scrollTop = view.scrollHeight;
}

function clearConsole() {
    if (!activeProfile) return;
    showConfirm("Konvol ürítése", "Biztosan törlöd a logokat?", async () => {
        await fetch(`/api/logs/clear/${activeProfile.name}`, { method: 'POST' });
        fetchLogs();
    });
}

// ---------------------------------------------------------
// UI UTILS
// ---------------------------------------------------------
function showTab(id) {
    document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
    document.getElementById(`tab-${id}`).style.display = 'block';
    document.querySelectorAll('.nav-menu a').forEach(a => a.classList.remove('active'));
    document.getElementById(`nav-${id}`).classList.add('active');

    if (id === 'backups') fetchBackups();
    if (id === 'console') fetchLogs();
}

function showConfirm(title, msg, onOk) {
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-msg').innerText = msg;
    document.getElementById('confirm-modal').style.display = 'flex';
    document.getElementById('btn-confirm-ok').onclick = () => {
        onOk();
        closeConfirm();
    };
}

async function saveAsTemplate() {
    const tName = prompt("Add meg a sablon nevét:");
    if (!tName || !activeProfile) return;
    const resp = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileName: activeProfile.name, templateName: tName })
    });
    if (resp.ok) showToast("Sablon elmentve!");
}

function showProfileSelect() {
    document.getElementById('setup-overlay').style.display = 'flex';
    document.getElementById('profile-list-area').style.display = 'block';
    document.getElementById('new-profile-form').style.display = 'none';
}

function showNewProfileForm() {
    document.getElementById('profile-list-area').style.display = 'none';
    document.getElementById('new-profile-form').style.display = 'block';
}

function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.style.background = isError ? 'var(--danger)' : 'var(--accent)';
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 3000);
}

document.addEventListener('DOMContentLoaded', init);
