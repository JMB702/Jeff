#!/usr/bin/env python3
"""
Live development server for Tinder Bot Dashboard.

ONE command to rule them all:
    python3 dev.py

What it does:
  - Serves the dashboard at http://localhost:8000
  - Auto-pulls from git every 5 seconds
  - Auto-reloads your browser when files change
  - You never touch the terminal again
"""

import http.server
import socketserver
import os
import threading
import time
import json
import subprocess
import hashlib
import sys

PORT = 8000
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(SCRIPT_DIR, 'public')


def get_file_hash():
    """Get hash of index.html to detect changes."""
    try:
        with open(os.path.join(PUBLIC_DIR, 'index.html'), 'rb') as f:
            return hashlib.md5(f.read()).hexdigest()
    except Exception:
        return None


BRANCH = 'claude/tinder-messaging-bot-sX6om'


def git_pull_loop():
    """Pull from the feature branch every 5 seconds."""
    # Make sure we're on the right branch first
    subprocess.run(
        ['git', 'checkout', BRANCH],
        cwd=SCRIPT_DIR, capture_output=True, text=True, timeout=15
    )
    while True:
        time.sleep(5)
        try:
            result = subprocess.run(
                ['git', 'pull', 'origin', BRANCH],
                cwd=SCRIPT_DIR,
                capture_output=True,
                text=True,
                timeout=15
            )
            stdout = result.stdout.strip()
            if stdout and 'Already up to date' not in stdout:
                print(f'  [auto-update] New changes pulled from git')
        except Exception:
            pass


class DevHandler(http.server.SimpleHTTPRequestHandler):
    """Custom handler that serves files + a hash endpoint for live reload."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def do_GET(self):
        # Live reload hash endpoint
        if self.path == '/__hash':
            h = get_file_hash()
            body = json.dumps({'h': h}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(body)
            return

        # Serve index.html with no-cache headers
        if self.path in ('/', '/index.html'):
            try:
                with open(os.path.join(PUBLIC_DIR, 'index.html'), 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
                self.send_header('Pragma', 'no-cache')
                self.send_header('Expires', '0')
                self.end_headers()
                self.wfile.write(content)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(f'Error reading index.html: {e}'.encode())
            return

        # Everything else served normally
        super().do_GET()

    def log_message(self, format, *args):
        # Only log errors, suppress normal request spam
        status = str(args[1]) if len(args) > 1 else ''
        if status.startswith('4') or status.startswith('5'):
            super().log_message(format, *args)


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """Handle each request in a new thread so live reload doesn't block."""
    daemon_threads = True
    allow_reuse_address = True


def main():
    # Start git pull background thread
    pull_thread = threading.Thread(target=git_pull_loop, daemon=True)
    pull_thread.start()

    print()
    print('=' * 50)
    print('  LIVE DEV SERVER')
    print(f'  http://localhost:{PORT}')
    print()
    print('  - Auto-pulls from git every 5s')
    print('  - Auto-reloads browser on changes')
    print()
    print('  Just leave this running!')
    print('=' * 50)
    print()

    try:
        server = ThreadedHTTPServer(('', PORT), DevHandler)
    except OSError as e:
        if 'Address already in use' in str(e) or getattr(e, 'errno', 0) == 98:
            print(f'ERROR: Port {PORT} is already in use!')
            print(f'Kill the old server first:')
            print(f'  Mac/Linux: lsof -ti:{PORT} | xargs kill')
            print(f'Then try again: python3 dev.py')
            sys.exit(1)
        raise

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
        server.shutdown()


if __name__ == '__main__':
    main()
