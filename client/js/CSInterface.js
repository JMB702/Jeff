/**
 * CSInterface.js - Adobe CEP Communication Layer
 *
 * This is a minimal shim that wraps Adobe's CSInterface for communicating
 * between the panel (HTML/JS) and the host ExtendScript (premiere.jsx).
 *
 * In production, replace this with Adobe's official CSInterface.js from:
 * https://github.com/nicedoc/nicedoc/blob/master/lib/CSInterface.js
 * or use the version bundled with the CEP SDK.
 */

function CSInterface() {
    this.hostEnvironment = {
        appName: 'PPRO',
        appVersion: '24.0'
    };
}

/**
 * Evaluate an ExtendScript expression in the host app.
 * @param {string} script - ExtendScript code to execute
 * @param {function} callback - Called with the result string
 */
CSInterface.prototype.evalScript = function(script, callback) {
    try {
        // In a real CEP environment, this calls into the host ExtendScript engine.
        // The native __adobe_cep__ bridge handles this.
        if (typeof __adobe_cep__ !== 'undefined') {
            __adobe_cep__.evalScript(script, callback);
        } else {
            // Development fallback — log and simulate
            console.log('[CSInterface] evalScript:', script);
            if (callback) callback('{}');
        }
    } catch (e) {
        console.error('[CSInterface] evalScript error:', e);
        if (callback) callback(JSON.stringify({ error: e.message }));
    }
};

/**
 * Get the system path for a given type.
 */
CSInterface.prototype.getSystemPath = function(type) {
    if (typeof __adobe_cep__ !== 'undefined') {
        return __adobe_cep__.getSystemPath(type);
    }
    return '';
};

/**
 * Register an event listener for host app events.
 */
CSInterface.prototype.addEventListener = function(type, listener) {
    if (typeof __adobe_cep__ !== 'undefined') {
        __adobe_cep__.addEventListener(type, listener);
    }
};

/**
 * Open a URL in the default browser.
 */
CSInterface.prototype.openURLInDefaultBrowser = function(url) {
    if (typeof __adobe_cep__ !== 'undefined') {
        __adobe_cep__.openURLInDefaultBrowser(url);
    }
};

// System path types
CSInterface.prototype.SYSTEM_PATH = {
    USER_DATA: 'userData',
    COMMON_FILES: 'commonFiles',
    MY_DOCUMENTS: 'myDocuments',
    APPLICATION: 'application',
    EXTENSION: 'extension',
    HOST_APPLICATION: 'hostApplication'
};
