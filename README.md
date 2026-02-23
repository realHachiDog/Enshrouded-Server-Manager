# EDManager - Professional Enshrouded Server Manager

EDManager is a standalone, professional desktop application designed to manage multiple Enshrouded servers with ease. It features real-time resource monitoring, automated backups, Discord integration, and a premium user interface.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Electron](https://img.shields.io/badge/platform-Electron-brightgreen.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## 🚀 Key Features

- **Multi-Server Profiles**: Manage hundreds of servers from a single interface. Each server has its own dedicated path and configuration.
- **Real-Time Resource Monitoring**: Visualize CPU and RAM usage with interactive history graphs (up to 20 minutes of historical data).
- **Automated Backup & Rollback**:
    - Scheduled ZIP backups of your `savegame` folder.
    - One-click rollback system with safety warnings.
- **Discord Webhook Integration**:
    - Customizable Start/Stop notifications.
    - Admin message box for instant announcements to your Discord community.
- **Smart Configuration Sync**: Non-destructive configuration merging. The manager preserves your custom `enshrouded_server.json` settings while allowing you to change the server name and password directly from the UI.
- **System Tray Support**: Minimize the app to the tray; your servers and backup tasks continue to run in the background.
- **Localization Support**: External JSON-based translation files (Hungarian and English included).

## 🛠️ Tech Stack

- **Framework**: Electron.js
- **Backend**: Node.js, Express
- **Frontend**: Vanilla HTML5, CSS3, JavaScript
- **Charting**: Chart.js
- **Icons**: FontAwesome 6

## 📦 Installation & Setup

1. **Download**: Clone this repository or download the latest release.
2. **Setup**:
    - Open `EDManager.exe` (or run `npm install` and `npm start` for development).
    - On first launch, click **"Add New Server"**.
    - Browse to your Enshrouded Server directory.
3. **Configure**: Set your server name, password, and optional Discord Webhook URL.
4. **Launch**: Press **Start** and enjoy your managed server!

## 📂 Project Structure

- `src/`: Backend logic and Electron entry points.
- `public/`: Frontend assets (HTML, CSS, JS).
- `public/locales/`: Translation files.
- `data/`: Local storage for profiles and global settings (created on first run).

## 🤝 Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request if you have ideas for new features or improvements.

## 📄 License

This project is licensed under the MIT License.

---
Developed with ❤️ for the Enshrouded Community.
