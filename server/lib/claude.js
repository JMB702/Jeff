/**
 * Claude API Integration for Edge-Case Media Matching
 *
 * When rule-based matching fails, we send the offline clip's metadata
 * and top candidate files to Claude to reason about which file is
 * the most likely match (or that no match exists).
 */
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('./logger');

class ClaudeMediaMatcher {
    constructor(config) {
        this.config = config;
        this.client = null;

        if (config.anthropicApiKey) {
            this.client = new Anthropic({ apiKey: config.anthropicApiKey });
        }
    }

    /**
     * Check if the Claude API is configured and available.
     */
    isAvailable() {
        return this.client !== null;
    }

    /**
     * Ask Claude to match an offline clip to one of the candidates.
     *
     * @param {object} offlineItem - The clip metadata from Premiere
     * @param {object[]} candidates - Top candidate files from the scanner
     * @returns {Promise<{ matchIndex: number|null, confidence: number, reasoning: string }>}
     */
    async matchMedia(offlineItem, candidates) {
        if (!this.client) {
            throw new Error('Claude API not configured. Set ANTHROPIC_API_KEY in .env');
        }

        const prompt = this._buildMatchPrompt(offlineItem, candidates);

        try {
            logger.info(`Asking Claude to match: ${offlineItem.originalFilename || offlineItem.name}`);

            const response = await this.client.messages.create({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 1024,
                system: `You are a media asset management expert helping to relink offline media in Adobe Premiere Pro projects.
You analyze file metadata, naming conventions, folder structures, and production patterns to identify the correct matching file.
Always respond with valid JSON only.`,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            });

            const text = response.content[0]?.text || '';
            return this._parseResponse(text);
        } catch (err) {
            logger.error('Claude API error:', err);
            throw err;
        }
    }

    /**
     * Ask Claude to analyze a batch of unresolved items and suggest
     * search strategies or patterns.
     */
    async analyzeUnresolved(unresolvedItems) {
        if (!this.client) {
            throw new Error('Claude API not configured');
        }

        const prompt = `I have ${unresolvedItems.length} offline media files in a Premiere Pro project that I cannot find on any scanned drives or network peers.

Here are the offline items:
${unresolvedItems.map((item, i) => `
${i + 1}. Filename: "${item.originalFilename || item.name}"
   Original path: "${item.originalPath}"
   Extension: "${item.fileExtension}"
   Bin path: "${item.binPath}"
   XMP tape name: "${item.xmpMetadata?.tapeName || 'N/A'}"
   XMP reel: "${item.xmpMetadata?.reelName || 'N/A'}"
   Camera: "${item.xmpMetadata?.cameraModel || 'N/A'}"
   Used in sequences: ${item.sequences?.join(', ') || 'None'}
`).join('\n')}

Based on the naming conventions, folder structures, and metadata patterns, please analyze:
1. What type of production this appears to be
2. What camera/recording systems were likely used
3. Common folder structure patterns for this type of media
4. Suggested search paths or network locations to check
5. Any files that might be renamed versions of each other

Respond with JSON:
{
  "productionType": "string",
  "cameraSystem": "string",
  "suggestedSearchPaths": ["string"],
  "namingPatterns": ["string"],
  "possibleRenames": [{"item": number, "suggestedNames": ["string"]}],
  "analysis": "string"
}`;

        try {
            const response = await this.client.messages.create({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 2048,
                system: 'You are a media asset management expert. Respond only with valid JSON.',
                messages: [{ role: 'user', content: prompt }]
            });

            const text = response.content[0]?.text || '';
            return JSON.parse(this._extractJSON(text));
        } catch (err) {
            logger.error('Claude analysis error:', err);
            throw err;
        }
    }

    // ── Private methods ──────────────────────────────────────────

    _buildMatchPrompt(offlineItem, candidates) {
        return `I need to relink an offline media clip in Premiere Pro. Help me find the correct match.

## Offline Clip Info:
- Filename: "${offlineItem.originalFilename || offlineItem.name}"
- Original full path: "${offlineItem.originalPath}"
- File extension: "${offlineItem.fileExtension}"
- Bin location in project: "${offlineItem.binPath}"
- Duration: ${offlineItem.duration || 'Unknown'}s
- Frame rate: ${offlineItem.frameRate || 'Unknown'}
- XMP Tape Name: "${offlineItem.xmpMetadata?.tapeName || 'N/A'}"
- XMP Reel Name: "${offlineItem.xmpMetadata?.reelName || 'N/A'}"
- XMP Scene: "${offlineItem.xmpMetadata?.scene || 'N/A'}"
- XMP Shot Name: "${offlineItem.xmpMetadata?.shotName || 'N/A'}"
- Camera: "${offlineItem.xmpMetadata?.cameraModel || 'N/A'}"
- Used in sequences: ${offlineItem.sequences?.join(', ') || 'None'}

## Candidate Files Found:
${candidates.map((c, i) => `
${i}. Path: "${c.filePath}"
   Filename: "${c.filename}"
   Extension: "${c.extension}"
   Size: ${c.size ? (c.size / 1048576).toFixed(1) + 'MB' : 'Unknown'}
   Modified: ${c.modifiedTime || 'Unknown'}
   ${c.remote ? `(Remote - on peer: ${c.peerId})` : '(Local)'}
`).join('')}

Which candidate (by index number) is the most likely match for the offline clip? Consider:
- Filename similarity and naming conventions
- File path / folder structure patterns
- File size and extension compatibility
- Camera card folder structures (BPAV, AVCHD, DCIM, etc.)
- Common rename patterns (spaces→underscores, version suffixes, etc.)

Respond with JSON only:
{
  "matchIndex": <number or null if no good match>,
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation>"
}`;
    }

    _parseResponse(text) {
        try {
            const json = JSON.parse(this._extractJSON(text));
            return {
                matchIndex: typeof json.matchIndex === 'number' ? json.matchIndex : null,
                confidence: typeof json.confidence === 'number' ? json.confidence : 0,
                reasoning: json.reasoning || ''
            };
        } catch (err) {
            logger.error('Failed to parse Claude response:', text);
            return { matchIndex: null, confidence: 0, reasoning: 'Failed to parse response' };
        }
    }

    _extractJSON(text) {
        // Try to extract JSON from markdown code blocks or raw text
        const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) return codeBlockMatch[1].trim();

        const braceMatch = text.match(/\{[\s\S]*\}/);
        if (braceMatch) return braceMatch[0];

        return text;
    }
}

module.exports = ClaudeMediaMatcher;
