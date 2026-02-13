/**
 * Premiere Pro ExtendScript Host - Media Relink
 *
 * This runs inside Premiere's ExtendScript engine and provides
 * direct access to the project model, sequences, and clip metadata.
 */

// ─── Project & Media Inspection ──────────────────────────────────

/**
 * Get all offline (unlinked) media items from the active project.
 * Returns a JSON string with clip metadata for each offline item.
 */
function getOfflineMedia() {
    var project = app.project;
    if (!project) return JSON.stringify({ error: "No project open" });

    var rootItem = project.rootItem;
    var offlineItems = [];

    function scanBin(bin, path) {
        for (var i = 0; i < bin.children.numItems; i++) {
            var item = bin.children[i];
            var itemPath = path + "/" + item.name;

            if (item.type === ProjectItemType.BIN) {
                scanBin(item, itemPath);
            } else if (item.type === ProjectItemType.CLIP ||
                       item.type === ProjectItemType.FILE) {
                if (isOffline(item)) {
                    offlineItems.push(extractClipMetadata(item, itemPath));
                }
            }
        }
    }

    scanBin(rootItem, "");
    return JSON.stringify({ items: offlineItems, projectPath: project.path });
}

/**
 * Check if a project item is offline / unlinked.
 */
function isOffline(item) {
    try {
        var mediaPath = item.getMediaPath();
        if (!mediaPath || mediaPath === "") return true;

        var file = new File(mediaPath);
        return !file.exists;
    } catch (e) {
        return true;
    }
}

/**
 * Extract all available metadata from a clip for matching.
 */
function extractClipMetadata(item, binPath) {
    var meta = {
        nodeId: item.nodeId,
        name: item.name,
        binPath: binPath,
        originalPath: "",
        duration: 0,
        inPoint: 0,
        outPoint: 0,
        frameRate: 0,
        hasVideo: false,
        hasAudio: false,
        videoCodec: "",
        audioCodec: "",
        width: 0,
        height: 0,
        fileExtension: "",
        xmpMetadata: {},
        sequences: []
    };

    try { meta.originalPath = item.getMediaPath() || ""; } catch (e) {}

    // Extract the original filename and extension from the path
    if (meta.originalPath !== "") {
        var parts = meta.originalPath.replace(/\\/g, "/").split("/");
        meta.originalFilename = parts[parts.length - 1];
        var extParts = meta.originalFilename.split(".");
        if (extParts.length > 1) {
            meta.fileExtension = "." + extParts[extParts.length - 1].toLowerCase();
        }
    } else {
        meta.originalFilename = item.name;
        var extParts = item.name.split(".");
        if (extParts.length > 1) {
            meta.fileExtension = "." + extParts[extParts.length - 1].toLowerCase();
        }
    }

    // Video/Audio properties
    try {
        var footageInterpretation = item.getFootageInterpretation();
        if (footageInterpretation) {
            meta.frameRate = footageInterpretation.frameRate || 0;
        }
    } catch (e) {}

    // Try to get clip duration
    try {
        var outPoint = item.getOutPoint();
        var inPoint = item.getInPoint();
        if (outPoint) meta.outPoint = outPoint.seconds;
        if (inPoint) meta.inPoint = inPoint.seconds;
        meta.duration = meta.outPoint - meta.inPoint;
    } catch (e) {}

    // XMP Metadata extraction
    try {
        var xmp = item.getProjectMetadata();
        if (xmp) {
            meta.xmpMetadata.raw = xmp;
            // Parse key fields from XMP
            meta.xmpMetadata.tapeName = getXMPValue(xmp, "tapeName");
            meta.xmpMetadata.description = getXMPValue(xmp, "description");
            meta.xmpMetadata.scene = getXMPValue(xmp, "scene");
            meta.xmpMetadata.shotName = getXMPValue(xmp, "shotName");
            meta.xmpMetadata.logNote = getXMPValue(xmp, "logNote");
            meta.xmpMetadata.comment = getXMPValue(xmp, "comment");
            meta.xmpMetadata.label = getXMPValue(xmp, "label");
            meta.xmpMetadata.cameraModel = getXMPValue(xmp, "cameraModel");
            meta.xmpMetadata.cameraManufacturer = getXMPValue(xmp, "cameraManufacturer");
            meta.xmpMetadata.reelName = getXMPValue(xmp, "reelName");
        }
    } catch (e) {}

    // Find which sequences use this clip
    try {
        for (var s = 0; s < project.sequences.numSequences; s++) {
            var seq = project.sequences[s];
            if (clipUsedInSequence(item, seq)) {
                meta.sequences.push(seq.name);
            }
        }
    } catch (e) {}

    return meta;
}

/**
 * Extract a value from XMP metadata string.
 */
function getXMPValue(xmpString, fieldName) {
    try {
        var patterns = [
            new RegExp('<premierePrivateProjectMetaData:' + fieldName + '>([^<]*)</premierePrivateProjectMetaData:' + fieldName + '>'),
            new RegExp('<dc:' + fieldName + '>([^<]*)</dc:' + fieldName + '>'),
            new RegExp('<xmp:' + fieldName + '>([^<]*)</xmp:' + fieldName + '>')
        ];
        for (var i = 0; i < patterns.length; i++) {
            var match = xmpString.match(patterns[i]);
            if (match && match[1]) return match[1];
        }
    } catch (e) {}
    return "";
}

/**
 * Check if a clip is used in a specific sequence.
 */
function clipUsedInSequence(item, sequence) {
    try {
        var tracks = sequence.videoTracks;
        for (var t = 0; t < tracks.numTracks; t++) {
            var clips = tracks[t].clips;
            for (var c = 0; c < clips.numItems; c++) {
                if (clips[c].projectItem && clips[c].projectItem.nodeId === item.nodeId) {
                    return true;
                }
            }
        }
        tracks = sequence.audioTracks;
        for (var t = 0; t < tracks.numTracks; t++) {
            var clips = tracks[t].clips;
            for (var c = 0; c < clips.numItems; c++) {
                if (clips[c].projectItem && clips[c].projectItem.nodeId === item.nodeId) {
                    return true;
                }
            }
        }
    } catch (e) {}
    return false;
}


// ─── Media Relinking ─────────────────────────────────────────────

/**
 * Relink a single clip to a new file path.
 * @param {string} nodeId - The project item nodeId
 * @param {string} newPath - The new file path to link to
 * @returns {string} JSON result
 */
function relinkMedia(nodeId, newPath) {
    var project = app.project;
    if (!project) return JSON.stringify({ success: false, error: "No project open" });

    var item = findItemByNodeId(project.rootItem, nodeId);
    if (!item) {
        return JSON.stringify({ success: false, error: "Item not found: " + nodeId });
    }

    var file = new File(newPath);
    if (!file.exists) {
        return JSON.stringify({ success: false, error: "File does not exist: " + newPath });
    }

    try {
        var success = item.changeMediaPath(newPath, false);
        return JSON.stringify({
            success: success,
            nodeId: nodeId,
            newPath: newPath,
            name: item.name
        });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

/**
 * Batch relink multiple clips. Expects JSON string input.
 * @param {string} mappingsJson - JSON array of {nodeId, newPath} objects
 * @returns {string} JSON results array
 */
function batchRelinkMedia(mappingsJson) {
    var mappings = JSON.parse(mappingsJson);
    var results = [];

    for (var i = 0; i < mappings.length; i++) {
        var result = JSON.parse(relinkMedia(mappings[i].nodeId, mappings[i].newPath));
        results.push(result);
    }

    return JSON.stringify({
        total: mappings.length,
        succeeded: results.filter(function(r) { return r.success; }).length,
        failed: results.filter(function(r) { return !r.success; }).length,
        results: results
    });
}

/**
 * Recursively find a project item by its nodeId.
 */
function findItemByNodeId(bin, nodeId) {
    for (var i = 0; i < bin.children.numItems; i++) {
        var item = bin.children[i];
        if (item.nodeId === nodeId) return item;
        if (item.type === ProjectItemType.BIN) {
            var found = findItemByNodeId(item, nodeId);
            if (found) return found;
        }
    }
    return null;
}


// ─── Project Info ────────────────────────────────────────────────

/**
 * Get project summary info.
 */
function getProjectInfo() {
    var project = app.project;
    if (!project) return JSON.stringify({ error: "No project open" });

    var totalClips = 0;
    var offlineClips = 0;

    function countItems(bin) {
        for (var i = 0; i < bin.children.numItems; i++) {
            var item = bin.children[i];
            if (item.type === ProjectItemType.BIN) {
                countItems(item);
            } else {
                totalClips++;
                if (isOffline(item)) offlineClips++;
            }
        }
    }

    countItems(project.rootItem);

    return JSON.stringify({
        name: project.name,
        path: project.path,
        totalClips: totalClips,
        offlineClips: offlineClips,
        sequences: project.sequences.numSequences
    });
}

/**
 * Get all media paths in the project (for network search seeding).
 */
function getAllMediaPaths() {
    var project = app.project;
    if (!project) return JSON.stringify({ error: "No project open" });

    var paths = [];

    function gatherPaths(bin) {
        for (var i = 0; i < bin.children.numItems; i++) {
            var item = bin.children[i];
            if (item.type === ProjectItemType.BIN) {
                gatherPaths(item);
            } else {
                try {
                    var p = item.getMediaPath();
                    if (p && p !== "") paths.push(p);
                } catch (e) {}
            }
        }
    }

    gatherPaths(project.rootItem);
    return JSON.stringify({ paths: paths });
}

/**
 * Save the project.
 */
function saveProject() {
    try {
        app.project.save();
        return JSON.stringify({ success: true });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}
