#!/usr/bin/env node
/**
 * Installer for Premiere Media Relink Plugin
 *
 * Creates a symlink from the Adobe CEP extensions directory
 * to this project, so Premiere can load the panel.
 *
 * Usage: node scripts/install.js [--uninstall]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const EXTENSION_ID = 'com.jeff.premiere.mediarelink';
const PROJECT_ROOT = path.resolve(__dirname, '..');

function getExtensionsDir() {
    const platform = os.platform();
    const home = os.homedir();

    if (platform === 'darwin') {
        return path.join(home, 'Library/Application Support/Adobe/CEP/extensions');
    } else if (platform === 'win32') {
        return path.join(process.env.APPDATA || '', 'Adobe/CEP/extensions');
    } else {
        console.error('Unsupported platform:', platform);
        process.exit(1);
    }
}

function enablePlayerDebugMode() {
    const platform = os.platform();

    if (platform === 'darwin') {
        try {
            execSync('defaults write com.adobe.CSXS.12 PlayerDebugMode 1');
            console.log('  Enabled CEP debug mode (CSXS.12)');
        } catch (e) {
            console.warn('  Could not enable debug mode:', e.message);
        }
    } else if (platform === 'win32') {
        try {
            execSync('reg add HKCU\\SOFTWARE\\Adobe\\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f');
            console.log('  Enabled CEP debug mode (CSXS.12)');
        } catch (e) {
            console.warn('  Could not enable debug mode:', e.message);
        }
    }
}

function install() {
    console.log('\n  Premiere Media Relink — Installer\n');

    const extensionsDir = getExtensionsDir();
    const linkPath = path.join(extensionsDir, EXTENSION_ID);

    // Create extensions directory if it doesn't exist
    if (!fs.existsSync(extensionsDir)) {
        fs.mkdirSync(extensionsDir, { recursive: true });
        console.log('  Created extensions directory:', extensionsDir);
    }

    // Remove existing link/directory
    if (fs.existsSync(linkPath)) {
        const stat = fs.lstatSync(linkPath);
        if (stat.isSymbolicLink()) {
            fs.unlinkSync(linkPath);
            console.log('  Removed existing symlink');
        } else {
            fs.rmSync(linkPath, { recursive: true });
            console.log('  Removed existing directory');
        }
    }

    // Create symlink
    fs.symlinkSync(PROJECT_ROOT, linkPath, 'junction');
    console.log(`  Created symlink: ${linkPath} → ${PROJECT_ROOT}`);

    // Enable debug mode for unsigned extensions
    enablePlayerDebugMode();

    // Create .env from example if it doesn't exist
    const envPath = path.join(PROJECT_ROOT, '.env');
    const envExample = path.join(PROJECT_ROOT, '.env.example');
    if (!fs.existsSync(envPath) && fs.existsSync(envExample)) {
        fs.copyFileSync(envExample, envPath);
        console.log('  Created .env from .env.example (configure your API key!)');
    }

    // Create logs directory
    const logsDir = path.join(PROJECT_ROOT, 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    console.log('\n  Installation complete!\n');
    console.log('  Next steps:');
    console.log('  1. Edit .env and add your ANTHROPIC_API_KEY');
    console.log('  2. Configure NAS_PATH and NAS_MOUNT_POINT in .env');
    console.log('  3. Run: npm start');
    console.log('  4. Open Premiere Pro → Window → Extensions → Media Relink');
    console.log('');
}

function uninstall() {
    console.log('\n  Premiere Media Relink — Uninstaller\n');

    const extensionsDir = getExtensionsDir();
    const linkPath = path.join(extensionsDir, EXTENSION_ID);

    if (fs.existsSync(linkPath)) {
        const stat = fs.lstatSync(linkPath);
        if (stat.isSymbolicLink()) {
            fs.unlinkSync(linkPath);
        } else {
            fs.rmSync(linkPath, { recursive: true });
        }
        console.log('  Removed extension:', linkPath);
    } else {
        console.log('  Extension not found (already uninstalled)');
    }

    console.log('\n  Uninstall complete!\n');
}

// ── CLI ──────────────────────────────────────────────────────────
if (process.argv.includes('--uninstall')) {
    uninstall();
} else {
    install();
}
