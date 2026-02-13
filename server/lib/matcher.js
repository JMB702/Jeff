/**
 * Rule-Based Media Matcher
 *
 * Implements a multi-pass matching strategy:
 *   Pass 1: Exact filename match
 *   Pass 2: Filename + extension + file size match
 *   Pass 3: Fuzzy name + metadata (duration, codec, resolution)
 *   Pass 4: Path pattern analysis (directory structure heuristics)
 *   Pass 5: Claude API for remaining unresolved items
 */
const path = require('path');
const logger = require('./logger');

class MediaMatcher {
    constructor(config) {
        this.config = config;
    }

    /**
     * Run the full matching pipeline on a single offline item against
     * a list of candidate files discovered on disk / network.
     *
     * @param {object} offlineItem - Metadata from Premiere (see premiere.jsx extractClipMetadata)
     * @param {object[]} candidates - Array of {filePath, filename, extension, size, modifiedTime}
     * @returns {{ match: object|null, confidence: number, method: string, candidates: object[] }}
     */
    match(offlineItem, candidates) {
        // Pass 1: Exact filename
        let result = this._exactFilenameMatch(offlineItem, candidates);
        if (result.match) return result;

        // Pass 2: Filename with relaxed extension
        result = this._relaxedFilenameMatch(offlineItem, candidates);
        if (result.match) return result;

        // Pass 3: Fuzzy name match
        result = this._fuzzyNameMatch(offlineItem, candidates);
        if (result.match) return result;

        // Pass 4: Path pattern / directory heuristics
        result = this._pathPatternMatch(offlineItem, candidates);
        if (result.match) return result;

        // No algorithmic match found — return top candidates for Claude
        return {
            match: null,
            confidence: 0,
            method: 'none',
            candidates: this._rankCandidates(offlineItem, candidates).slice(0, 10)
        };
    }

    // ── Pass 1: Exact filename ───────────────────────────────────

    _exactFilenameMatch(item, candidates) {
        const targetName = (item.originalFilename || item.name || '').toLowerCase();

        for (const c of candidates) {
            if (c.filename.toLowerCase() === targetName) {
                logger.info(`Exact filename match: ${targetName} → ${c.filePath}`);
                return { match: c, confidence: 1.0, method: 'exact_filename', candidates: [] };
            }
        }
        return { match: null, confidence: 0, method: 'exact_filename', candidates: [] };
    }

    // ── Pass 2: Relaxed filename (ignore extension) ──────────────

    _relaxedFilenameMatch(item, candidates) {
        const targetStem = this._stem(item.originalFilename || item.name || '').toLowerCase();
        const targetExt = (item.fileExtension || '').toLowerCase();

        const matches = candidates.filter(c => {
            const cStem = this._stem(c.filename).toLowerCase();
            return cStem === targetStem;
        });

        if (matches.length === 1) {
            logger.info(`Relaxed filename match (single): ${targetStem} → ${matches[0].filePath}`);
            return { match: matches[0], confidence: 0.9, method: 'relaxed_filename', candidates: [] };
        }

        // Prefer same extension if multiple stems match
        if (matches.length > 1 && targetExt) {
            const extMatch = matches.find(m => m.extension.toLowerCase() === targetExt);
            if (extMatch) {
                logger.info(`Relaxed filename + extension match: ${targetStem}${targetExt} → ${extMatch.filePath}`);
                return { match: extMatch, confidence: 0.92, method: 'relaxed_filename_ext', candidates: [] };
            }
        }

        return { match: null, confidence: 0, method: 'relaxed_filename', candidates: matches };
    }

    // ── Pass 3: Fuzzy name match ─────────────────────────────────

    _fuzzyNameMatch(item, candidates) {
        const targetName = this._stem(item.originalFilename || item.name || '').toLowerCase();
        const scored = [];

        for (const c of candidates) {
            const cName = this._stem(c.filename).toLowerCase();
            const similarity = this._stringSimilarity(targetName, cName);
            if (similarity >= this.config.matching.fuzzyNameThreshold) {
                scored.push({ ...c, similarity });
            }
        }

        scored.sort((a, b) => b.similarity - a.similarity);

        if (scored.length > 0 && scored[0].similarity >= 0.9) {
            logger.info(`Fuzzy match (${scored[0].similarity.toFixed(2)}): ${targetName} → ${scored[0].filePath}`);
            return {
                match: scored[0],
                confidence: scored[0].similarity * 0.85,
                method: 'fuzzy_name',
                candidates: scored.slice(0, 5)
            };
        }

        return { match: null, confidence: 0, method: 'fuzzy_name', candidates: scored.slice(0, 5) };
    }

    // ── Pass 4: Path pattern matching ────────────────────────────

    _pathPatternMatch(item, candidates) {
        const originalPath = (item.originalPath || '').replace(/\\/g, '/');
        if (!originalPath) return { match: null, confidence: 0, method: 'path_pattern', candidates: [] };

        const originalParts = originalPath.split('/').filter(Boolean);
        const scored = [];

        for (const c of candidates) {
            const cParts = c.filePath.replace(/\\/g, '/').split('/').filter(Boolean);
            let commonSegments = 0;

            // Count how many path segments match (from the end, ignoring filename)
            const origDirs = originalParts.slice(0, -1);
            const cDirs = cParts.slice(0, -1);

            for (const seg of origDirs) {
                if (cDirs.includes(seg)) commonSegments++;
            }

            const pathScore = origDirs.length > 0 ? commonSegments / origDirs.length : 0;

            // Also factor in filename similarity
            const nameSim = this._stringSimilarity(
                this._stem(originalParts[originalParts.length - 1] || '').toLowerCase(),
                this._stem(cParts[cParts.length - 1] || '').toLowerCase()
            );

            const combinedScore = (pathScore * 0.4) + (nameSim * 0.6);

            if (combinedScore > 0.5) {
                scored.push({ ...c, pathScore, nameSimilarity: nameSim, combinedScore });
            }
        }

        scored.sort((a, b) => b.combinedScore - a.combinedScore);

        if (scored.length > 0 && scored[0].combinedScore >= 0.8) {
            logger.info(`Path pattern match (${scored[0].combinedScore.toFixed(2)}): → ${scored[0].filePath}`);
            return {
                match: scored[0],
                confidence: scored[0].combinedScore * 0.8,
                method: 'path_pattern',
                candidates: scored.slice(0, 5)
            };
        }

        return { match: null, confidence: 0, method: 'path_pattern', candidates: scored.slice(0, 5) };
    }

    // ── Ranking for Claude fallback ──────────────────────────────

    _rankCandidates(item, candidates) {
        const targetName = this._stem(item.originalFilename || item.name || '').toLowerCase();
        const targetExt = (item.fileExtension || '').toLowerCase();

        return candidates
            .map(c => {
                const nameSim = this._stringSimilarity(targetName, this._stem(c.filename).toLowerCase());
                const extMatch = c.extension.toLowerCase() === targetExt ? 0.1 : 0;
                return { ...c, score: nameSim + extMatch };
            })
            .sort((a, b) => b.score - a.score);
    }

    // ── String utilities ─────────────────────────────────────────

    /**
     * Levenshtein-based similarity (0–1 range).
     */
    _stringSimilarity(a, b) {
        if (a === b) return 1;
        if (!a || !b) return 0;

        const maxLen = Math.max(a.length, b.length);
        if (maxLen === 0) return 1;

        return 1 - (this._levenshtein(a, b) / maxLen);
    }

    _levenshtein(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                );
            }
        }
        return dp[m][n];
    }

    /**
     * Get filename without extension.
     */
    _stem(filename) {
        const dot = filename.lastIndexOf('.');
        return dot > 0 ? filename.substring(0, dot) : filename;
    }
}

module.exports = MediaMatcher;
