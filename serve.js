#!/usr/bin/env node
// Zero-dependency web server - uses only Node.js built-ins
// No TypeScript, no Express, no SQLite needed to serve the dashboard

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const HTML_FILE = path.join(__dirname, 'public', 'index.html');

// In-memory state (no database needed for dashboard UI)
let killed = false;
let matches = [];
let sseClients = [];

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch(e) {}
  }
}

function getStats() {
  return { total: matches.length, messages_sent_total: 0, dates_confirmed: 0, by_status: {} };
}

function sendJSON(res, data, status) {
  res.writeHead(status || 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  // API routes
  if (pathname === '/api/stats' && method === 'GET') {
    return sendJSON(res, getStats());
  }
  if (pathname === '/api/matches' && method === 'GET') {
    return sendJSON(res, matches);
  }
  if (pathname === '/api/bot/status' && method === 'GET') {
    return sendJSON(res, { running: false, killed });
  }
  if (pathname === '/api/bot/kill' && method === 'POST') {
    killed = !killed;
    broadcast('kill_switch', { killed });
    return sendJSON(res, { killed });
  }
  if (pathname === '/api/config' && method === 'GET') {
    return sendJSON(res, {});
  }
  if (pathname === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.flushHeaders();
    sseClients.push(res);
    req.on('close', () => {
      sseClients = sseClients.filter(c => c !== res);
    });
    return;
  }

  // Match-specific API routes
  if (pathname.startsWith('/api/matches/') && pathname.endsWith('/conversation')) {
    return sendJSON(res, { match: null, conversation: [] });
  }
  if (pathname.startsWith('/api/matches/') && (pathname.endsWith('/stop') || pathname.endsWith('/resume') || pathname.endsWith('/send'))) {
    return sendJSON(res, { success: true });
  }

  // Serve HTML for root
  if (pathname === '/' || pathname === '/index.html') {
    try {
      const html = fs.readFileSync(HTML_FILE, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error: Could not read ' + HTML_FILE + '\n' + err.message);
    }
    return;
  }

  // 404
  sendJSON(res, { error: 'Not found' }, 404);
});

// Broadcast stats periodically
setInterval(() => {
  if (sseClients.length > 0) {
    broadcast('update', { stats: getStats(), matches, killed });
  }
}, 3000);

server.listen(PORT, () => {
  console.log('');
  console.log('='.repeat(50));
  console.log('  DASHBOARD IS RUNNING');
  console.log('  Open this URL in your browser:');
  console.log('');
  console.log('  http://localhost:' + PORT);
  console.log('');
  console.log('  Keep this terminal window open!');
  console.log('='.repeat(50));
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error('ERROR: Port ' + PORT + ' is already in use!');
    console.error('Run this first: killall node');
    console.error('Then try again: node serve.js');
    console.error('');
    process.exit(1);
  }
  throw err;
});
