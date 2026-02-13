/**
 * Network Peer Discovery & Communication
 *
 * Uses mDNS/Bonjour to discover other machines running this plugin.
 * Each peer shares its media index so we can find files across the network.
 */
const http = require('http');
const { Bonjour } = require('bonjour-service');
const logger = require('./logger');

class NetworkDiscovery {
    constructor(config) {
        this.config = config;
        this.bonjour = null;
        this.browser = null;
        this.service = null;
        this.peers = new Map(); // peerId → { host, port, name, lastSeen }
        this.onPeerFound = null;
        this.onPeerLost = null;
    }

    /**
     * Start advertising this machine and browsing for others.
     * @param {number} port - The port our HTTP server listens on
     * @param {string} machineId - Unique identifier for this machine
     */
    start(port, machineId) {
        if (!this.config.network.enabled) {
            logger.info('Network discovery disabled');
            return;
        }

        this.bonjour = new Bonjour();
        const os = require('os');

        // Publish our service
        this.service = this.bonjour.publish({
            name: `${os.hostname()}-media-relink`,
            type: this.config.network.serviceType,
            port: port,
            txt: {
                machineId,
                version: '1.0.0',
                hostname: os.hostname()
            }
        });

        logger.info(`Publishing mDNS service on port ${port}`);

        // Browse for peers
        this.browser = this.bonjour.find({ type: this.config.network.serviceType });

        this.browser.on('up', (service) => {
            const peerId = service.txt?.machineId;
            if (!peerId || peerId === machineId) return; // Skip self

            const peer = {
                id: peerId,
                host: service.referer?.address || service.addresses?.[0],
                port: service.port,
                name: service.txt?.hostname || service.name,
                lastSeen: Date.now()
            };

            this.peers.set(peerId, peer);
            logger.info(`Peer discovered: ${peer.name} (${peer.host}:${peer.port})`);

            if (this.onPeerFound) this.onPeerFound(peer);
        });

        this.browser.on('down', (service) => {
            const peerId = service.txt?.machineId;
            if (peerId && this.peers.has(peerId)) {
                const peer = this.peers.get(peerId);
                logger.info(`Peer lost: ${peer.name}`);
                this.peers.delete(peerId);
                if (this.onPeerLost) this.onPeerLost(peer);
            }
        });
    }

    /**
     * Fetch the media index from a remote peer.
     * @param {object} peer - { host, port }
     * @returns {Promise<object[]>} Array of file entries from the peer
     */
    async fetchPeerIndex(peer) {
        return new Promise((resolve, reject) => {
            const url = `http://${peer.host}:${peer.port}/api/index`;
            logger.info(`Fetching index from peer ${peer.name} at ${url}`);

            const req = http.get(url, { timeout: 30000 }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed.files || []);
                    } catch (e) {
                        reject(new Error(`Failed to parse peer response: ${e.message}`));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Peer request timed out'));
            });
        });
    }

    /**
     * Request a file transfer from a peer (copy to NAS or local).
     * @param {object} peer - The peer holding the file
     * @param {string} remoteFilePath - Path to the file on the peer
     * @param {string} destinationPath - Where to save the file
     * @returns {Promise<boolean>}
     */
    async requestFileTransfer(peer, remoteFilePath, destinationPath) {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({ filePath: remoteFilePath, destination: destinationPath });
            const options = {
                hostname: peer.host,
                port: peer.port,
                path: '/api/transfer',
                method: 'POST',
                timeout: 300000, // 5 min for large files
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const result = JSON.parse(data);
                        resolve(result.success);
                    } catch (e) {
                        reject(new Error(`Transfer response parse error: ${e.message}`));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Transfer timed out'));
            });

            req.write(postData);
            req.end();
        });
    }

    /**
     * Get list of currently known peers.
     */
    getPeers() {
        return Array.from(this.peers.values());
    }

    /**
     * Stop discovery services.
     */
    stop() {
        if (this.service) this.service.stop();
        if (this.browser) this.browser.stop();
        if (this.bonjour) this.bonjour.destroy();
        logger.info('Network discovery stopped');
    }
}

module.exports = NetworkDiscovery;
