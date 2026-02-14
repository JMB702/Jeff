# Tinder Auto-Messenger Bot

An AI-powered Tinder bot that automatically messages your matches, carries on conversations, and sets up dates — all while keeping you in the loop.

## How It Works

1. **New match detected** → Bot analyzes her entire profile (bio, job, school, interests) AND all her photos using GPT-4o vision to understand her personality and find conversation hooks
2. **Personalized opener sent** → Based on the deep profile analysis, crafts a unique opening message referencing specific things from her profile/photos
3. **She replies** → Bot generates a natural, contextual reply matching her energy
4. **Conversation progresses** → After enough rapport (configurable), bot proposes a date using your availability and preferences
5. **She says yes** → You get notified and must approve/reject before the bot confirms
6. **No response** → Bot follows up after a configurable delay with fresh conversation starters (not guilt trips)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

- **`TINDER_AUTH_TOKEN`** — Get this from Tinder's web app:
  1. Go to [tinder.com](https://tinder.com) and log in
  2. Open browser dev tools (F12) → Network tab
  3. Look for requests to `api.gotinder.com`
  4. Copy the `X-Auth-Token` header value

- **`OPENAI_API_KEY`** — Get from [platform.openai.com](https://platform.openai.com)

### 3. Customize the config

Edit `config.yaml` to set:
- Your name and personality style
- Conversation rules (what to say / never say)
- Follow-up timing and limits
- Date preferences and availability
- Polling intervals and response delays

### 4. Run the bot

```bash
npm run bot
```

### 5. Open the web dashboard

```bash
npm run web
```

Then open [http://localhost:3000](http://localhost:3000) in your browser. The dashboard lets you:
- View all matches and their statuses
- Read conversation histories
- Send manual messages
- Approve or decline dates
- Stop/resume the bot for specific matches
- View AI profile analyses
- See live updates via real-time streaming

## Commands

| Command | Description |
|---------|-------------|
| `npm run bot` | Start the bot |
| `npm run web` | Open web dashboard at localhost:3000 |
| `npm run status` | Show statistics (total matches, messages sent, dates confirmed) |
| `npm run matches` | List all tracked matches with status |
| `npm run matches -- -s chatting` | Filter matches by status |
| `npm run approve-date -- <matchId>` | Approve a pending date |
| `npm run reject-date -- <matchId>` | Reject a date (bot will suggest rescheduling) |

### Additional CLI commands

```bash
# View full conversation with a match
npx ts-node src/index.ts conversation <matchId or name>

# View the AI's profile analysis for a match
npx ts-node src/index.ts profile <matchId or name>

# Stop the bot for a specific match
npx ts-node src/index.ts stop-match <matchId>

# Resume a stopped match
npx ts-node src/index.ts resume-match <matchId>

# Send a manual message (overrides the bot for one message)
npx ts-node src/index.ts send <matchId> "your message here"

# Show current config
npm run config

# Live dashboard
npx ts-node src/index.ts dashboard
```

## Configuration Guide

### Personality

```yaml
personality:
  name: "Jeff"
  style: |
    Be natural, witty, and confident but not arrogant...
  opener_strategy: |
    Look at her profile and craft a personalized opener...
  traits:
    - witty
    - confident
    - genuine
```

The `style` field is the core system prompt that controls how the AI talks. Write it as if you're describing yourself to a friend who's going to text on your behalf.

### Rules

```yaml
rules:
  blacklist:
    - never send explicit messages
    - never be rude or insulting
  whitelist:
    - be curious about her interests
    - use humor naturally
  min_messages_before_date_proposal: 6
  max_messages_per_match: 0  # 0 = unlimited
```

### Follow-ups

```yaml
followup:
  wait_hours: 24        # Wait 24h before following up
  max_followups: 3      # Max 3 follow-ups (0 = unlimited)
  strategy: |
    Send a casual, low-pressure follow-up...
```

Set `max_followups: 0` for unlimited follow-ups.

### Dating

```yaml
dating:
  availability: |
    Free evenings after 6pm weekdays, flexible weekends.
  preferred_activities:
    - drinks at a bar
    - coffee
  preferred_areas:
    - downtown
```

### Timing

```yaml
polling:
  new_match_interval: 30    # Check for new matches every 30s
  message_check_interval: 15 # Check for messages every 15s
  response_delay_min: 30     # Wait at least 30s before replying
  response_delay_max: 180    # Wait at most 3min before replying
```

The response delay makes the bot appear human by waiting a random amount of time before sending each message.

## Match Statuses

| Status | Meaning |
|--------|---------|
| `new` | Just matched, opener not yet sent |
| `opener_sent` | First message sent, waiting for reply |
| `chatting` | Active conversation |
| `date_proposed` | Bot proposed a date, waiting for her response |
| `date_pending` | She said yes — **waiting for YOUR approval** |
| `date_confirmed` | Date is confirmed |
| `ghosted` | Max follow-ups reached with no response |
| `unmatched` | She unmatched |
| `stopped` | You manually stopped the bot for this match |

## Data Storage

All data is stored locally in `tinder-bot.db` (SQLite):
- Match states and metadata
- Full conversation logs
- Profile analyses

The database file is gitignored.
