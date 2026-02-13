/**
 * Default configuration for the Media Relink server.
 */
const path = require('path');
const os = require('os');

module.exports = {
    // Server
    port: parseInt(process.env.PORT) || 3847,
    host: process.env.HOST || '0.0.0.0',
    peerPort: parseInt(process.env.PEER_PORT) || 3848,

    // Claude API
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

    // NAS Configuration
    nas: {
        path: process.env.NAS_PATH || '',
        protocol: process.env.NAS_PROTOCOL || 'smb',   // 'smb' | 'sftp' | 'nfs' | 'local'
        username: process.env.NAS_USERNAME || '',
        password: process.env.NAS_PASSWORD || '',
        mountPoint: process.env.NAS_MOUNT_POINT || '',
        autoMove: true,       // Automatically move found media to NAS
        preserveStructure: true // Keep relative folder structure on NAS
    },

    // Media search
    mediaExtensions: (process.env.MEDIA_EXTENSIONS ||
        '.mp4,.mov,.mxf,.avi,.mkv,.wav,.mp3,.aif,.aiff,.jpg,.jpeg,.png,.tif,.tiff,.psd,.ai,.exr,.dpx,.bmp,.gif')
        .split(',').map(e => e.trim().toLowerCase()),

    searchPaths: (process.env.MEDIA_SEARCH_PATHS ||
        getDefaultSearchPaths()).split(',').map(p => p.trim()),

    // Network discovery
    network: {
        enabled: process.env.NETWORK_SCAN_ENABLED !== 'false',
        scanInterval: parseInt(process.env.NETWORK_SCAN_INTERVAL) || 300000,
        serviceName: 'premiere-media-relink',
        serviceType: 'premiere-relink'
    },

    // Matching thresholds
    matching: {
        exactNameThreshold: 1.0,
        fuzzyNameThreshold: 0.75,
        metadataMatchThreshold: 0.6,
        claudeConfidenceThreshold: 0.7
    },

    // Logging
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        file: process.env.LOG_FILE || path.join(__dirname, '../../logs/relink.log')
    }
};

function getDefaultSearchPaths() {
    const platform = os.platform();
    if (platform === 'darwin') {
        return '/Volumes,~/Desktop,~/Documents,~/Downloads,~/Movies';
    } else if (platform === 'win32') {
        return 'C:\\,D:\\,E:\\,F:\\';
    } else {
        return '/mnt,/media,~/Desktop,~/Documents,~/Downloads';
    }
}
