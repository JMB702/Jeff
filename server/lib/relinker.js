/**
 * Relink Orchestrator
 *
 * Coordinates the full relink pipeline:
 *   1. Get offline media from Premiere
 *   2. Scan local + network for candidates
 *   3. Run rule-based matching
 *   4. Send unresolved to Claude API
 *   5. Move matched files to NAS if configured
 *   6. Relink in Premiere
 */
const logger = require('./logger');
const MediaMatcher = require('./matcher');
const MediaScanner = require('./scanner');
const ClaudeMediaMatcher = require('./claude');
const NASManager = require('./nas');
const NetworkDiscovery = require('./network');

class Relinker {
    constructor(config) {
        this.config = config;
        this.matcher = new MediaMatcher(config);
        this.scanner = new MediaScanner(config);
        this.claude = new ClaudeMediaMatcher(config);
        this.nas = new NASManager(config);
        this.network = new NetworkDiscovery(config);

        // State
        this.results = [];
        this.progress = { phase: 'idle', current: 0, total: 0, message: '' };
        this.onProgress = null; // Callback for progress updates
    }

    /**
     * Run the full relink pipeline.
     *
     * @param {object[]} offlineItems - Array of offline clip metadata from Premiere
     * @param {object} options - { useNetwork, useClaude, moveToNAS, projectName }
     * @returns {object} Final results
     */
    async run(offlineItems, options = {}) {
        const {
            useNetwork = true,
            useClaude = true,
            moveToNAS = false,
            projectName = 'Untitled'
        } = options;

        this.results = [];
        const startTime = Date.now();

        try {
            // Phase 1: Local scan
            this._updateProgress('scanning', 0, 1, 'Scanning local drives for media...');
            await this.scanner.scanLocal();

            // Phase 2: Network scan
            if (useNetwork && this.config.network.enabled) {
                this._updateProgress('network', 0, 1, 'Fetching media indexes from network peers...');
                await this._fetchNetworkIndexes();
            }

            const allCandidates = this.scanner.getAllCandidates();
            logger.info(`Total candidates available: ${allCandidates.length}`);

            // Phase 3: Rule-based matching
            this._updateProgress('matching', 0, offlineItems.length, 'Running rule-based matching...');
            const unresolved = [];

            for (let i = 0; i < offlineItems.length; i++) {
                const item = offlineItems[i];
                this._updateProgress('matching', i + 1, offlineItems.length,
                    `Matching: ${item.originalFilename || item.name}`);

                const result = this.matcher.match(item, allCandidates);

                if (result.match && result.confidence >= this.config.matching.metadataMatchThreshold) {
                    this.results.push({
                        item,
                        match: result.match,
                        confidence: result.confidence,
                        method: result.method,
                        status: 'matched'
                    });
                } else {
                    unresolved.push({ item, topCandidates: result.candidates });
                }
            }

            logger.info(`Rule-based matching: ${this.results.length} matched, ${unresolved.length} unresolved`);

            // Phase 4: Claude API for unresolved
            if (useClaude && unresolved.length > 0 && this.claude.isAvailable()) {
                this._updateProgress('claude', 0, unresolved.length, 'Asking Claude to analyze unresolved media...');

                for (let i = 0; i < unresolved.length; i++) {
                    const { item, topCandidates } = unresolved[i];
                    this._updateProgress('claude', i + 1, unresolved.length,
                        `Claude analyzing: ${item.originalFilename || item.name}`);

                    if (topCandidates.length === 0) {
                        this.results.push({
                            item,
                            match: null,
                            confidence: 0,
                            method: 'none',
                            status: 'unresolved'
                        });
                        continue;
                    }

                    try {
                        const claudeResult = await this.claude.matchMedia(item, topCandidates);

                        if (claudeResult.matchIndex !== null &&
                            claudeResult.confidence >= this.config.matching.claudeConfidenceThreshold) {
                            this.results.push({
                                item,
                                match: topCandidates[claudeResult.matchIndex],
                                confidence: claudeResult.confidence,
                                method: 'claude_api',
                                reasoning: claudeResult.reasoning,
                                status: 'matched'
                            });
                        } else {
                            this.results.push({
                                item,
                                match: null,
                                confidence: claudeResult.confidence,
                                method: 'claude_api',
                                reasoning: claudeResult.reasoning,
                                status: 'unresolved',
                                topCandidates: topCandidates.slice(0, 5)
                            });
                        }
                    } catch (err) {
                        logger.error(`Claude match failed for ${item.name}:`, err);
                        this.results.push({
                            item,
                            match: null,
                            confidence: 0,
                            method: 'claude_error',
                            status: 'unresolved',
                            error: err.message,
                            topCandidates: topCandidates.slice(0, 5)
                        });
                    }
                }
            } else {
                // No Claude — mark remaining as unresolved
                for (const { item, topCandidates } of unresolved) {
                    this.results.push({
                        item,
                        match: null,
                        confidence: 0,
                        method: 'none',
                        status: 'unresolved',
                        topCandidates: topCandidates.slice(0, 5)
                    });
                }
            }

            // Phase 5: Move to NAS
            if (moveToNAS) {
                await this._moveMatchedToNAS(projectName);
            }

            // Summary
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const matched = this.results.filter(r => r.status === 'matched');
            const unresolvedFinal = this.results.filter(r => r.status === 'unresolved');

            this._updateProgress('complete', offlineItems.length, offlineItems.length,
                `Done! ${matched.length} matched, ${unresolvedFinal.length} unresolved (${elapsed}s)`);

            return {
                total: offlineItems.length,
                matched: matched.length,
                unresolved: unresolvedFinal.length,
                elapsed,
                results: this.results,
                relinkMappings: matched.map(r => ({
                    nodeId: r.item.nodeId,
                    newPath: r.nasPath || r.match.filePath
                }))
            };
        } catch (err) {
            logger.error('Relink pipeline error:', err);
            this._updateProgress('error', 0, 0, `Error: ${err.message}`);
            throw err;
        }
    }

    /**
     * Fetch indexes from all known network peers.
     */
    async _fetchNetworkIndexes() {
        const peers = this.network.getPeers();
        for (const peer of peers) {
            try {
                const files = await this.network.fetchPeerIndex(peer);
                this.scanner.mergeRemoteIndex(peer.id, files);
            } catch (err) {
                logger.warn(`Failed to fetch index from peer ${peer.name}: ${err.message}`);
            }
        }
    }

    /**
     * Move all matched local files to NAS.
     */
    async _moveMatchedToNAS(projectName) {
        const matched = this.results.filter(r => r.status === 'matched' && r.match && !r.match.remote);

        if (matched.length === 0) return;

        this._updateProgress('nas_move', 0, matched.length, 'Moving matched files to NAS...');

        for (let i = 0; i < matched.length; i++) {
            const result = matched[i];
            this._updateProgress('nas_move', i + 1, matched.length,
                `Moving: ${result.match.filename}`);

            try {
                const moveResult = await this.nas.moveToNAS(
                    result.match.filePath,
                    projectName,
                    result.item.originalPath
                );

                if (moveResult.success) {
                    result.nasPath = moveResult.nasPath;
                    logger.info(`Moved to NAS: ${result.match.filePath} → ${moveResult.nasPath}`);
                }
            } catch (err) {
                logger.warn(`Failed to move ${result.match.filename} to NAS: ${err.message}`);
            }
        }
    }

    _updateProgress(phase, current, total, message) {
        this.progress = { phase, current, total, message };
        if (this.onProgress) this.onProgress(this.progress);
    }
}

module.exports = Relinker;
