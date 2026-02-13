/**
 * NAS Server Media Manager
 *
 * Handles moving/copying media files to the central NAS server.
 * Supports SMB shares, SFTP, and locally-mounted NAS paths.
 */
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const logger = require('./logger');

class NASManager {
    constructor(config) {
        this.config = config.nas;
        this.connected = false;
        this.sftpClient = null;
    }

    /**
     * Test NAS connectivity.
     */
    async testConnection() {
        if (!this.config.path && !this.config.mountPoint) {
            return { connected: false, error: 'No NAS path configured' };
        }

        const targetPath = this._getLocalNASPath();

        // For locally mounted NAS, just check the mount point
        if (targetPath && fs.existsSync(targetPath)) {
            this.connected = true;
            return { connected: true, path: targetPath, protocol: 'local_mount' };
        }

        // For SFTP
        if (this.config.protocol === 'sftp') {
            try {
                await this._connectSFTP();
                this.connected = true;
                return { connected: true, path: this.config.path, protocol: 'sftp' };
            } catch (err) {
                return { connected: false, error: err.message };
            }
        }

        return { connected: false, error: 'NAS path not accessible' };
    }

    /**
     * Move a local file to the NAS server, preserving relative folder structure.
     *
     * @param {string} sourcePath - The local file to move
     * @param {string} projectName - Project name for NAS folder organization
     * @param {string} originalRelativePath - Original relative path for structure preservation
     * @returns {Promise<{ success: boolean, nasPath: string }>}
     */
    async moveToNAS(sourcePath, projectName, originalRelativePath) {
        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Source file does not exist: ${sourcePath}`);
        }

        const filename = path.basename(sourcePath);

        // Build destination path on NAS
        let destDir;
        if (this.config.preserveStructure && originalRelativePath) {
            const relDir = path.dirname(originalRelativePath);
            destDir = path.join(this._getLocalNASPath(), projectName, relDir);
        } else {
            destDir = path.join(this._getLocalNASPath(), projectName);
        }

        const destPath = path.join(destDir, filename);

        if (this.config.protocol === 'sftp') {
            return this._moveViaSFTP(sourcePath, destDir, destPath, filename);
        }

        // Local mount - use filesystem copy
        return this._moveViaLocalMount(sourcePath, destDir, destPath);
    }

    /**
     * Copy via locally-mounted NAS path.
     */
    async _moveViaLocalMount(sourcePath, destDir, destPath) {
        try {
            // Create destination directory
            fs.mkdirSync(destDir, { recursive: true });

            // Check if file already exists at destination
            if (fs.existsSync(destPath)) {
                const srcStat = fs.statSync(sourcePath);
                const dstStat = fs.statSync(destPath);

                // If same size, consider it already transferred
                if (srcStat.size === dstStat.size) {
                    logger.info(`File already exists on NAS (same size): ${destPath}`);
                    return { success: true, nasPath: destPath, alreadyExisted: true };
                }

                // Different size — rename with suffix
                const ext = path.extname(destPath);
                const stem = path.basename(destPath, ext);
                destPath = path.join(destDir, `${stem}_${Date.now()}${ext}`);
            }

            // Stream copy (handles large files)
            const readStream = fs.createReadStream(sourcePath);
            const writeStream = fs.createWriteStream(destPath);
            await pipeline(readStream, writeStream);

            logger.info(`Copied to NAS: ${sourcePath} → ${destPath}`);
            return { success: true, nasPath: destPath };
        } catch (err) {
            logger.error(`NAS copy failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    /**
     * Copy via SFTP.
     */
    async _moveViaSFTP(sourcePath, destDir, destPath, filename) {
        try {
            const sftp = await this._connectSFTP();
            await sftp.mkdir(destDir, true);
            await sftp.put(sourcePath, destPath);

            logger.info(`SFTP uploaded: ${sourcePath} → ${destPath}`);
            return { success: true, nasPath: destPath };
        } catch (err) {
            logger.error(`SFTP upload failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    /**
     * Connect via SFTP (lazy init).
     */
    async _connectSFTP() {
        if (this.sftpClient) return this.sftpClient;

        const SFTPClient = require('ssh2-sftp-client');
        this.sftpClient = new SFTPClient();

        const [host, sharePath] = this.config.path.replace('//', '').split('/');

        await this.sftpClient.connect({
            host: host,
            port: 22,
            username: this.config.username,
            password: this.config.password
        });

        return this.sftpClient;
    }

    /**
     * Get the local filesystem path to the NAS mount.
     */
    _getLocalNASPath() {
        if (this.config.mountPoint) return this.config.mountPoint;
        if (this.config.protocol === 'local') return this.config.path;
        return this.config.mountPoint || '';
    }

    /**
     * List files already on the NAS for a project.
     */
    async listProjectFiles(projectName) {
        const projectDir = path.join(this._getLocalNASPath(), projectName);
        if (!fs.existsSync(projectDir)) return [];

        const files = [];
        this._walkDir(projectDir, files);
        return files;
    }

    _walkDir(dir, results) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    this._walkDir(fullPath, results);
                } else if (entry.isFile()) {
                    results.push({
                        filePath: fullPath,
                        filename: entry.name,
                        extension: path.extname(entry.name).toLowerCase(),
                        size: fs.statSync(fullPath).size
                    });
                }
            }
        } catch (e) { /* permission errors */ }
    }

    /**
     * Disconnect any open connections.
     */
    async disconnect() {
        if (this.sftpClient) {
            await this.sftpClient.end();
            this.sftpClient = null;
        }
        this.connected = false;
    }
}

module.exports = NASManager;
