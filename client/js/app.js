/**
 * Media Relink Panel - Client Application
 *
 * Connects to the local Node.js server via WebSocket for real-time
 * progress and REST API for commands. Communicates with Premiere Pro
 * via CSInterface/ExtendScript.
 */

(function() {
    'use strict';

    // ── Configuration ────────────────────────────────────────────
    const SERVER_PORT = 3847;
    const SERVER_URL = `http://localhost:${SERVER_PORT}`;
    const WS_URL = `ws://localhost:${SERVER_PORT}`;

    // ── State ────────────────────────────────────────────────────
    const cs = new CSInterface();
    let ws = null;
    let offlineItems = [];
    let relinkResults = null;

    // ── DOM Elements ─────────────────────────────────────────────
    const els = {
        nasStatus:       document.getElementById('nas-status'),
        claudeStatus:    document.getElementById('claude-status'),
        peersCount:      document.getElementById('peers-count'),
        projectDetails:  document.getElementById('project-details'),
        btnScan:         document.getElementById('btn-scan'),
        btnRelink:       document.getElementById('btn-relink'),
        btnApply:        document.getElementById('btn-apply'),
        progressSection: document.getElementById('progress-section'),
        progressFill:    document.getElementById('progress-fill'),
        progressMessage: document.getElementById('progress-message'),
        resultsSection:  document.getElementById('results-section'),
        resultsSummary:  document.getElementById('results-summary'),
        resultsList:     document.getElementById('results-list'),
        optNetwork:      document.getElementById('opt-network'),
        optClaude:       document.getElementById('opt-claude'),
        optNAS:          document.getElementById('opt-nas'),
        nasPath:         document.getElementById('nas-path'),
        nasProtocol:     document.getElementById('nas-protocol'),
        btnTestNAS:      document.getElementById('btn-test-nas')
    };

    // ── Initialize ───────────────────────────────────────────────
    function init() {
        connectWebSocket();
        setupEventListeners();
        loadProjectInfo();
    }

    // ── WebSocket Connection ─────────────────────────────────────
    function connectWebSocket() {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            console.log('WebSocket connected');
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            handleWSMessage(msg);
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected, reconnecting in 3s...');
            setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };
    }

    function handleWSMessage(msg) {
        switch (msg.type) {
            case 'init':
                updateStatusIndicators(msg.data);
                break;

            case 'progress':
                updateProgress(msg.data);
                break;

            case 'peer_found':
            case 'peer_lost':
                fetchPeers();
                break;

            case 'nas_status':
                els.nasStatus.classList.toggle('active', msg.data.connected);
                break;
        }
    }

    // ── Status Indicators ────────────────────────────────────────
    function updateStatusIndicators(data) {
        els.nasStatus.classList.toggle('active', data.nasConnected);
        els.claudeStatus.classList.toggle('active', data.claudeAvailable);
        els.peersCount.textContent = `${data.peers.length} Peers`;
        els.peersCount.classList.toggle('active', data.peers.length > 0);
    }

    async function fetchPeers() {
        try {
            const res = await fetch(`${SERVER_URL}/api/peers`);
            const data = await res.json();
            els.peersCount.textContent = `${data.peers.length} Peers`;
            els.peersCount.classList.toggle('active', data.peers.length > 0);
        } catch (e) {}
    }

    // ── Project Info ─────────────────────────────────────────────
    function loadProjectInfo() {
        cs.evalScript('getProjectInfo()', (result) => {
            try {
                const info = JSON.parse(result);
                if (info.error) {
                    els.projectDetails.innerHTML = `<p class="muted">${info.error}</p>`;
                    return;
                }

                els.projectDetails.innerHTML = `
                    <p><strong>${info.name}</strong></p>
                    <p>${info.totalClips} clips &middot; <span style="color: ${info.offlineClips > 0 ? 'var(--warning)' : 'var(--success)'}">
                        ${info.offlineClips} offline</span> &middot; ${info.sequences} sequences
                    </p>
                `;

                if (info.offlineClips > 0) {
                    els.btnRelink.disabled = false;
                }
            } catch (e) {
                els.projectDetails.innerHTML = '<p class="muted">Connect to Premiere Pro</p>';
            }
        });
    }

    // ── Event Listeners ──────────────────────────────────────────
    function setupEventListeners() {
        els.btnScan.addEventListener('click', scanMedia);
        els.btnRelink.addEventListener('click', startRelink);
        els.btnApply.addEventListener('click', applyRelinks);
        els.btnTestNAS.addEventListener('click', testNAS);

        // Collapsible sections
        document.querySelectorAll('.collapsible-header').forEach(header => {
            header.addEventListener('click', () => {
                header.parentElement.classList.toggle('open');
            });
        });

        // Refresh project info periodically
        setInterval(loadProjectInfo, 10000);
    }

    // ── Scan ─────────────────────────────────────────────────────
    async function scanMedia() {
        els.btnScan.disabled = true;
        els.btnScan.textContent = 'Scanning...';

        try {
            const res = await fetch(`${SERVER_URL}/api/scan`, { method: 'POST' });
            const data = await res.json();
            els.btnScan.textContent = `${data.filesIndexed} files indexed`;
        } catch (e) {
            els.btnScan.textContent = 'Scan failed';
        }

        setTimeout(() => {
            els.btnScan.disabled = false;
            els.btnScan.textContent = 'Scan Media';
        }, 2000);
    }

    // ── Relink ───────────────────────────────────────────────────
    function startRelink() {
        els.btnRelink.disabled = true;

        // Get offline items from Premiere
        cs.evalScript('getOfflineMedia()', async (result) => {
            try {
                const data = JSON.parse(result);
                if (data.error) {
                    alert(data.error);
                    els.btnRelink.disabled = false;
                    return;
                }

                offlineItems = data.items;

                if (offlineItems.length === 0) {
                    alert('No offline media found!');
                    els.btnRelink.disabled = false;
                    return;
                }

                // Show progress
                els.progressSection.classList.remove('hidden');
                els.resultsSection.classList.add('hidden');

                // Extract project name from path
                const projectName = data.projectPath
                    ? data.projectPath.split('/').pop().replace('.prproj', '')
                    : 'Untitled';

                // Send to server
                const options = {
                    useNetwork: els.optNetwork.checked,
                    useClaude: els.optClaude.checked,
                    moveToNAS: els.optNAS.checked,
                    projectName
                };

                const res = await fetch(`${SERVER_URL}/api/relink`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ offlineItems, options })
                });

                relinkResults = await res.json();
                showResults(relinkResults);
            } catch (e) {
                console.error('Relink error:', e);
                alert('Relink failed: ' + e.message);
            }

            els.btnRelink.disabled = false;
        });
    }

    // ── Progress ─────────────────────────────────────────────────
    function updateProgress(progress) {
        els.progressSection.classList.remove('hidden');

        const pct = progress.total > 0
            ? Math.round((progress.current / progress.total) * 100)
            : 0;

        els.progressFill.style.width = pct + '%';
        els.progressMessage.textContent = progress.message;

        if (progress.phase === 'complete' || progress.phase === 'error') {
            els.progressFill.style.width = '100%';
        }
    }

    // ── Results ──────────────────────────────────────────────────
    function showResults(data) {
        els.resultsSection.classList.remove('hidden');

        els.resultsSummary.innerHTML = `
            <div class="stat total">
                <div class="number">${data.total}</div>
                <div class="label">Total</div>
            </div>
            <div class="stat matched">
                <div class="number">${data.matched}</div>
                <div class="label">Matched</div>
            </div>
            <div class="stat unresolved">
                <div class="number">${data.unresolved}</div>
                <div class="label">Unresolved</div>
            </div>
        `;

        els.resultsList.innerHTML = '';

        for (const result of data.results) {
            const item = result.item;
            const el = document.createElement('div');
            el.className = 'result-item';
            el.innerHTML = `
                <span class="status-dot ${result.status}"></span>
                <span class="name" title="${item.originalFilename || item.name}">${item.originalFilename || item.name}</span>
                <span class="method">${formatMethod(result.method)}</span>
                <span class="confidence">${result.confidence > 0 ? Math.round(result.confidence * 100) + '%' : '-'}</span>
            `;

            // Click to see details or manually pick
            if (result.status === 'unresolved' && result.topCandidates?.length > 0) {
                el.style.cursor = 'pointer';
                el.addEventListener('click', () => showCandidatePicker(result));
            }

            els.resultsList.appendChild(el);
        }

        if (data.matched > 0) {
            els.btnApply.disabled = false;
        }
    }

    function formatMethod(method) {
        const labels = {
            'exact_filename': 'Exact',
            'relaxed_filename': 'Name',
            'relaxed_filename_ext': 'Name+Ext',
            'fuzzy_name': 'Fuzzy',
            'path_pattern': 'Path',
            'claude_api': 'Claude AI',
            'manual': 'Manual',
            'none': 'No match'
        };
        return labels[method] || method;
    }

    // ── Candidate Picker (for unresolved items) ──────────────────
    function showCandidatePicker(result) {
        const candidates = result.topCandidates || [];
        if (candidates.length === 0) return;

        const names = candidates.map((c, i) =>
            `${i + 1}. ${c.filename} (${c.filePath})`
        ).join('\n');

        const pick = prompt(
            `Pick a match for "${result.item.originalFilename || result.item.name}":\n\n${names}\n\nEnter number (or 0 to skip):`,
            '1'
        );

        const idx = parseInt(pick) - 1;
        if (idx >= 0 && idx < candidates.length) {
            manualMatch(result.item.nodeId, candidates[idx].filePath);
        }
    }

    async function manualMatch(nodeId, filePath) {
        try {
            const res = await fetch(`${SERVER_URL}/api/manual-match`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nodeId, filePath })
            });
            const data = await res.json();

            if (data.success) {
                // Refresh results
                const res2 = await fetch(`${SERVER_URL}/api/results`);
                const updated = await res2.json();
                relinkResults.results = updated.results;
                relinkResults.matched = updated.results.filter(r => r.status === 'matched').length;
                relinkResults.unresolved = updated.results.filter(r => r.status === 'unresolved').length;
                showResults(relinkResults);
            }
        } catch (e) {
            console.error('Manual match error:', e);
        }
    }

    // ── Apply Relinks in Premiere ────────────────────────────────
    function applyRelinks() {
        if (!relinkResults?.relinkMappings?.length) return;

        els.btnApply.disabled = true;
        els.btnApply.textContent = 'Applying...';

        const mappings = relinkResults.relinkMappings;
        const mappingsJson = JSON.stringify(mappings).replace(/'/g, "\\'");

        cs.evalScript(`batchRelinkMedia('${mappingsJson}')`, (result) => {
            try {
                const data = JSON.parse(result);
                els.btnApply.textContent =
                    `Done! ${data.succeeded}/${data.total} relinked`;

                // Save project
                cs.evalScript('saveProject()', () => {});

                // Refresh project info
                setTimeout(loadProjectInfo, 1000);
            } catch (e) {
                els.btnApply.textContent = 'Apply failed';
                console.error('Apply error:', e);
            }

            setTimeout(() => {
                els.btnApply.textContent = 'Apply Relinks in Premiere';
                els.btnApply.disabled = false;
            }, 3000);
        });
    }

    // ── NAS Test ─────────────────────────────────────────────────
    async function testNAS() {
        els.btnTestNAS.textContent = 'Testing...';
        els.btnTestNAS.disabled = true;

        try {
            // Update config first
            await fetch(`${SERVER_URL}/api/config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nas: {
                        mountPoint: els.nasPath.value,
                        protocol: els.nasProtocol.value
                    }
                })
            });

            const res = await fetch(`${SERVER_URL}/api/nas/status`);
            const data = await res.json();

            if (data.connected) {
                els.btnTestNAS.textContent = 'Connected!';
                els.nasStatus.classList.add('active');
            } else {
                els.btnTestNAS.textContent = 'Failed: ' + (data.error || 'Unknown');
            }
        } catch (e) {
            els.btnTestNAS.textContent = 'Error';
        }

        setTimeout(() => {
            els.btnTestNAS.textContent = 'Test Connection';
            els.btnTestNAS.disabled = false;
        }, 3000);
    }

    // ── Boot ─────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', init);
})();
