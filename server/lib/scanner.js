/**
 * Local & Network Media Scanner
 *
 * Scans local drives and discovered network peers for media files.
 * Builds an indexed cache of available media for fast matching.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { glob } = require('glob');
const logger = require('./logger');

class MediaScanner {
    constructor(config) {
        this.config = config;
        this.mediaIndex = new Map();      // filename → [{ filePath, size, modified, extension }]
        this.scanInProgress = false;
        this.lastScanTime = null;
    }

    /**
     * Scan all configured local search paths and build the media index.
     * @returns {number} Total files indexed
     */
    async scanLocal() {
        if (this.scanInProgress) {
            logger.warn('Scan already in progress, skipping');
            return this.mediaIndex.size;
        }

        this.scanInProgress = true;
        const startTime = Date.now();
        logger.info('Starting local media scan...');

        try {
            const extensions = this.config.mediaExtensions;
            const searchPaths = this.config.searchPaths
                .map(p => p.replace('~', os.homedir()))
                .filter(p => fs.existsSync(p));

            for (const searchPath of searchPaths) {
                await this._scanDirectory(searchPath, extensions, 0, 5);
            }

            this.lastScanTime = Date.now();
            const elapsed = ((this.lastScanTime - startTime) / 1000).toFixed(1);
            logger.info(`Local scan complete: ${this.mediaIndex.size} unique filenames, ${this._totalFiles()} total files in ${elapsed}s`);

            return this.mediaIndex.size;
        } catch (err) {
            logger.error('Scan error:', err);
            throw err;
        } finally {
            this.scanInProgress = false;
        }
    }

    /**
     * Recursively scan a directory for media files.
     */
    async _scanDirectory(dirPath, extensions, depth, maxDepth) {
        if (depth > maxDepth) return;

        let entries;
        try {
            entries = fs.readdirSync(dirPath, { withFileTypes: true });
        } catch (err) {
            // Permission denied, etc.
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            try {
                if (entry.isDirectory()) {
                    // Skip hidden directories, node_modules, system dirs
                    if (entry.name.startsWith('.') ||
                        entry.name === 'node_modules' ||
                        entry.name === 'System' ||
                        entry.name === 'Library' ||
                        entry.name === 'Windows' ||
                        entry.name === '$Recycle.Bin') {
                        continue;
                    }
                    await this._scanDirectory(fullPath, extensions, depth + 1, maxDepth);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (extensions.includes(ext)) {
                        this._indexFile(fullPath, entry.name, ext);
                    }
                }
            } catch (err) {
                // Skip inaccessible files
            }
        }
    }

    /**
     * Add a file to the media index.
     */
    _indexFile(filePath, filename, extension) {
        let stat;
        try {
            stat = fs.statSync(filePath);
        } catch {
            return;
        }

        const entry = {
            filePath,
            filename,
            extension,
            size: stat.size,
            modifiedTime: stat.mtime.toISOString()
        };

        const key = filename.toLowerCase();
        if (!this.mediaIndex.has(key)) {
            this.mediaIndex.set(key, []);
        }
        this.mediaIndex.get(key).push(entry);
    }

    /**
     * Merge remote peer's index into our own (with source tagging).
     */
    mergeRemoteIndex(peerId, remoteFiles) {
        let added = 0;
        for (const file of remoteFiles) {
            const entry = {
                ...file,
                remote: true,
                peerId
            };
            const key = file.filename.toLowerCase();
            if (!this.mediaIndex.has(key)) {
                this.mediaIndex.set(key, []);
            }

            // Don't add duplicates from same peer
            const existing = this.mediaIndex.get(key);
            const isDupe = existing.some(e => e.peerId === peerId && e.filePath === file.filePath);
            if (!isDupe) {
                existing.push(entry);
                added++;
            }
        }
        logger.info(`Merged ${added} files from peer ${peerId}`);
        return added;
    }

    /**
     * Get all candidate files as a flat array for matching.
     */
    getAllCandidates() {
        const all = [];
        for (const entries of this.mediaIndex.values()) {
            all.push(...entries);
        }
        return all;
    }

    /**
     * Quick lookup by exact filename.
     */
    lookupByFilename(filename) {
        return this.mediaIndex.get(filename.toLowerCase()) || [];
    }

    /**
     * Get scan status info.
     */
    getStatus() {
        return {
            totalUniqueFilenames: this.mediaIndex.size,
            totalFiles: this._totalFiles(),
            scanInProgress: this.scanInProgress,
            lastScanTime: this.lastScanTime
        };
    }

    /**
     * Clear the entire index.
     */
    clear() {
        this.mediaIndex.clear();
        this.lastScanTime = null;
    }

    _totalFiles() {
        let count = 0;
        for (const entries of this.mediaIndex.values()) {
            count += entries.length;
        }
        return count;
    }
}

module.exports = MediaScanner;
