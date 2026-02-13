/**
 * Media Relink Server
 *
 * Express + WebSocket server that bridges the Premiere Pro CEP panel
 * with the Node.js relink engine. The CEP panel connects via WebSocket
 * for real-time progress, and via REST for commands.
 */
require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const path = require('path');
const config = require('./config/default');
const logger = require('./lib/logger');
const Relinker = require('./lib/relinker');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Unique machine ID for network peer identification
const machineId = crypto.randomUUID();

// Initialize relinker
const relinker = new Relinker(config);

// Wire up progress to WebSocket broadcast
relinker.onProgress = (progress) => {
    broadcast({ type: 'progress', data: progress });
};

// ── Middleware ────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../client')));

// CORS for CEP panel
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ── API Routes ───────────────────────────────────────────────────
app.use('/api', apiRoutes(relinker, config));

// ── WebSocket ────────────────────────────────────────────────────
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    logger.info(`WebSocket client connected (total: ${clients.size})`);

    // Send current state on connect
    ws.send(JSON.stringify({
        type: 'init',
        data: {
            machineId,
            progress: relinker.progress,
            scanStatus: relinker.scanner.getStatus(),
            peers: relinker.network.getPeers(),
            nasConnected: relinker.nas.connected,
            claudeAvailable: relinker.claude.isAvailable()
        }
    }));

    ws.on('close', () => {
        clients.delete(ws);
        logger.info(`WebSocket client disconnected (total: ${clients.size})`);
    });
});

function broadcast(message) {
    const data = JSON.stringify(message);
    for (const client of clients) {
        if (client.readyState === 1) { // OPEN
            client.send(data);
        }
    }
}

// ── Network Discovery ────────────────────────────────────────────
relinker.network.onPeerFound = (peer) => {
    broadcast({ type: 'peer_found', data: peer });
};

relinker.network.onPeerLost = (peer) => {
    broadcast({ type: 'peer_lost', data: peer });
};

// ── Peer Index Endpoint (for other machines to query) ────────────
app.get('/api/index', (req, res) => {
    const candidates = relinker.scanner.getAllCandidates()
        .filter(c => !c.remote); // Only share local files
    res.json({ machineId, files: candidates });
});

// ── File Transfer Endpoint (for peer-to-peer transfers) ──────────
app.post('/api/transfer', async (req, res) => {
    const { filePath, destination } = req.body;
    const fs = require('fs');

    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'File not found' });
    }

    try {
        const readStream = fs.createReadStream(filePath);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
        readStream.pipe(res);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Start Server ─────────────────────────────────────────────────
server.listen(config.port, config.host, () => {
    logger.info(`Media Relink server running on http://${config.host}:${config.port}`);

    // Start network discovery
    relinker.network.start(config.port, machineId);

    // Initial local scan
    relinker.scanner.scanLocal().catch(err => {
        logger.warn('Initial scan failed:', err.message);
    });

    // Test NAS connection
    relinker.nas.testConnection().then(result => {
        if (result.connected) {
            logger.info(`NAS connected: ${result.path} (${result.protocol})`);
        } else {
            logger.warn(`NAS not available: ${result.error}`);
        }
        broadcast({ type: 'nas_status', data: result });
    });
});

// ── Graceful Shutdown ────────────────────────────────────────────
process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    relinker.network.stop();
    await relinker.nas.disconnect();
    server.close();
    process.exit(0);
});

module.exports = { app, server, relinker };
