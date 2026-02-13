#!/usr/bin/env node
// Convenience wrapper — runs install.js with --uninstall flag
process.argv.push('--uninstall');
require('./install');
