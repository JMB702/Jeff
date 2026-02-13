# Premiere Media Relink

Automatic media relinking plugin for Adobe Premiere Pro with AI-powered edge case handling, multi-computer network search, and NAS server integration.

## Architecture

```
┌─────────────────────────┐
│   Premiere Pro (Host)   │
│  ┌───────────────────┐  │
│  │ ExtendScript API  │  │  ← premiere.jsx (reads project, relinks clips)
│  └────────┬──────────┘  │
│           │ CSInterface  │
│  ┌────────▼──────────┐  │
│  │   CEP Panel (UI)  │  │  ← client/ (HTML/CSS/JS panel)
│  └────────┬──────────┘  │
└───────────┼─────────────┘
            │ WebSocket + REST
┌───────────▼─────────────┐
│   Node.js Server        │  ← server/index.js
│  ┌───────────────────┐  │
│  │  Relink Engine     │  │  ← Orchestrates the full pipeline
│  │  ├─ Rule Matcher   │  │  ← 4-pass algorithmic matching
│  │  ├─ Media Scanner  │  │  ← Local disk + NAS scanning
│  │  ├─ Network Disc.  │  │  ← mDNS peer discovery
│  │  ├─ Claude API     │  │  ← AI matching for edge cases
│  │  └─ NAS Manager    │  │  ← Move files to central NAS
│  └───────────────────┘  │
└───────────┬─────────────┘
            │ mDNS + HTTP
┌───────────▼─────────────┐
│  Other Workstations     │  ← Same plugin running on network peers
└─────────────────────────┘
```

## Matching Pipeline

1. **Exact filename** — Direct name match (100% confidence)
2. **Relaxed filename** — Stem match ignoring extension differences (90%)
3. **Fuzzy name** — Levenshtein similarity for renamed files (75%+)
4. **Path pattern** — Directory structure heuristics (80%+)
5. **Claude AI** — Sends metadata + top candidates to Claude API for reasoning about naming conventions, camera card structures, and rename patterns

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Install the CEP panel into Premiere Pro
npm run install-plugin

# 3. Configure your environment
cp .env.example .env
# Edit .env — add your ANTHROPIC_API_KEY and NAS settings

# 4. Start the server
npm start

# 5. In Premiere Pro: Window → Extensions → Media Relink
```

## Multi-Computer Setup

Install on each workstation. The plugin uses mDNS/Bonjour to automatically discover other machines on the network running the same plugin. Each machine shares its media index so files can be found across all workstations.

```bash
# On each machine:
git clone <this-repo>
cd Jeff
npm run setup    # installs deps + plugin
# Edit .env with shared NAS config
npm start
```

### NAS Configuration

Set these in `.env` on every machine:

```
NAS_MOUNT_POINT=/Volumes/NASMedia     # or Z:\ on Windows
NAS_PROTOCOL=local                     # local, smb, or sftp
```

When "Move found media to NAS" is enabled, matched files found on any workstation are automatically copied to the NAS with the original folder structure preserved.

## API

The server exposes a REST API on port 3847:

| Endpoint | Method | Description |
|---|---|---|
| `/api/status` | GET | Server and scan status |
| `/api/scan` | POST | Trigger local media scan |
| `/api/scan/network` | POST | Fetch indexes from network peers |
| `/api/relink` | POST | Run full relink pipeline |
| `/api/results` | GET | Get current results |
| `/api/manual-match` | POST | Manually match a clip to a file |
| `/api/nas/status` | GET | Test NAS connection |
| `/api/nas/move` | POST | Move a file to NAS |
| `/api/claude/analyze` | POST | Ask Claude to analyze unresolved items |
| `/api/peers` | GET | List discovered network peers |
| `/api/config` | GET/PUT | View/update runtime config |

## Requirements

- Adobe Premiere Pro 2023+ (v23.0+)
- Node.js 18+
- Network access for multi-computer features
- Claude API key for AI matching (optional but recommended)
