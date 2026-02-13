/**
 * REST API Routes
 */
const express = require('express');
const logger = require('../lib/logger');

module.exports = function(relinker, config) {
    const router = express.Router();

    // ── Status ───────────────────────────────────────────────────

    router.get('/status', (req, res) => {
        res.json({
            progress: relinker.progress,
            scanStatus: relinker.scanner.getStatus(),
            peers: relinker.network.getPeers(),
            nasConnected: relinker.nas.connected,
            claudeAvailable: relinker.claude.isAvailable(),
            results: relinker.results.length > 0 ? {
                total: relinker.results.length,
                matched: relinker.results.filter(r => r.status === 'matched').length,
                unresolved: relinker.results.filter(r => r.status === 'unresolved').length
            } : null
        });
    });

    // ── Scan ─────────────────────────────────────────────────────

    router.post('/scan', async (req, res) => {
        try {
            const count = await relinker.scanner.scanLocal();
            res.json({ success: true, filesIndexed: count });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    router.post('/scan/network', async (req, res) => {
        try {
            const peers = relinker.network.getPeers();
            let totalMerged = 0;

            for (const peer of peers) {
                try {
                    const files = await relinker.network.fetchPeerIndex(peer);
                    totalMerged += relinker.scanner.mergeRemoteIndex(peer.id, files);
                } catch (err) {
                    logger.warn(`Failed to fetch from peer ${peer.name}: ${err.message}`);
                }
            }

            res.json({ success: true, peersScanned: peers.length, filesMerged: totalMerged });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ── Relink ───────────────────────────────────────────────────

    router.post('/relink', async (req, res) => {
        const { offlineItems, options } = req.body;

        if (!offlineItems || !Array.isArray(offlineItems)) {
            return res.status(400).json({ error: 'offlineItems array required' });
        }

        try {
            const results = await relinker.run(offlineItems, options);
            res.json(results);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ── Results ──────────────────────────────────────────────────

    router.get('/results', (req, res) => {
        res.json({ results: relinker.results });
    });

    // ── Manual match (user picks from candidates) ────────────────

    router.post('/manual-match', (req, res) => {
        const { nodeId, filePath } = req.body;

        if (!nodeId || !filePath) {
            return res.status(400).json({ error: 'nodeId and filePath required' });
        }

        // Find the result and update it
        const result = relinker.results.find(r => r.item.nodeId === nodeId);
        if (!result) {
            return res.status(404).json({ error: 'Item not found in results' });
        }

        result.match = { filePath, filename: require('path').basename(filePath) };
        result.confidence = 1.0;
        result.method = 'manual';
        result.status = 'matched';

        res.json({ success: true, result });
    });

    // ── NAS ──────────────────────────────────────────────────────

    router.get('/nas/status', async (req, res) => {
        const status = await relinker.nas.testConnection();
        res.json(status);
    });

    router.post('/nas/move', async (req, res) => {
        const { filePath, projectName, originalPath } = req.body;

        try {
            const result = await relinker.nas.moveToNAS(filePath, projectName || 'Untitled', originalPath);
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ── Claude Analysis ──────────────────────────────────────────

    router.post('/claude/analyze', async (req, res) => {
        const { unresolvedItems } = req.body;

        if (!relinker.claude.isAvailable()) {
            return res.status(400).json({ error: 'Claude API not configured' });
        }

        try {
            const analysis = await relinker.claude.analyzeUnresolved(unresolvedItems);
            res.json(analysis);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Peers ────────────────────────────────────────────────────

    router.get('/peers', (req, res) => {
        res.json({ peers: relinker.network.getPeers() });
    });

    // ── Config ───────────────────────────────────────────────────

    router.get('/config', (req, res) => {
        res.json({
            mediaExtensions: config.mediaExtensions,
            searchPaths: config.searchPaths,
            nas: {
                path: config.nas.path,
                protocol: config.nas.protocol,
                mountPoint: config.nas.mountPoint,
                autoMove: config.nas.autoMove
            },
            network: config.network,
            matching: config.matching
        });
    });

    router.put('/config', (req, res) => {
        const updates = req.body;

        // Allow runtime config updates
        if (updates.searchPaths) config.searchPaths = updates.searchPaths;
        if (updates.mediaExtensions) config.mediaExtensions = updates.mediaExtensions;
        if (updates.nas) Object.assign(config.nas, updates.nas);
        if (updates.matching) Object.assign(config.matching, updates.matching);

        res.json({ success: true, config: updates });
    });

    return router;
};
