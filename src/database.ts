import Database from "better-sqlite3";
import path from "path";
import { MatchState, MatchStatus, ConversationMessage } from "./types";

export class DB {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || path.join(process.cwd(), "tinder-bot.db");
    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS match_states (
        match_id TEXT PRIMARY KEY,
        tinder_person_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',
        messages_sent INTEGER NOT NULL DEFAULT 0,
        messages_received INTEGER NOT NULL DEFAULT 0,
        last_message_from TEXT,
        last_message_at TEXT,
        last_bot_message_at TEXT,
        followups_sent INTEGER NOT NULL DEFAULT 0,
        date_details TEXT,
        profile_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS conversation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (match_id) REFERENCES match_states(match_id)
      );

      CREATE TABLE IF NOT EXISTS bot_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_match ON conversation_log(match_id);
      CREATE INDEX IF NOT EXISTS idx_match_status ON match_states(status);
    `);
  }

  // --- Match State ---

  getMatch(matchId: string): MatchState | null {
    const row = this.db
      .prepare("SELECT * FROM match_states WHERE match_id = ?")
      .get(matchId) as MatchState | undefined;
    return row || null;
  }

  getAllMatches(): MatchState[] {
    return this.db
      .prepare("SELECT * FROM match_states ORDER BY updated_at DESC")
      .all() as MatchState[];
  }

  getMatchesByStatus(status: MatchStatus): MatchState[] {
    return this.db
      .prepare("SELECT * FROM match_states WHERE status = ? ORDER BY updated_at DESC")
      .all(status) as MatchState[];
  }

  upsertMatch(state: Partial<MatchState> & { match_id: string }): void {
    const existing = this.getMatch(state.match_id);
    if (existing) {
      const fields: string[] = [];
      const values: any[] = [];
      for (const [key, val] of Object.entries(state)) {
        if (key !== "match_id" && key !== "created_at" && val !== undefined) {
          fields.push(`${key} = ?`);
          values.push(val);
        }
      }
      fields.push("updated_at = datetime('now')");
      values.push(state.match_id);
      this.db
        .prepare(`UPDATE match_states SET ${fields.join(", ")} WHERE match_id = ?`)
        .run(...values);
    } else {
      this.db
        .prepare(
          `INSERT INTO match_states (match_id, tinder_person_id, name, status, profile_summary, messages_sent, messages_received, followups_sent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          state.match_id,
          state.tinder_person_id || "",
          state.name || "Unknown",
          state.status || "new",
          state.profile_summary || "",
          state.messages_sent || 0,
          state.messages_received || 0,
          state.followups_sent || 0
        );
    }
  }

  // --- Conversation Log ---

  addMessage(matchId: string, role: "assistant" | "user", content: string): void {
    this.db
      .prepare("INSERT INTO conversation_log (match_id, role, content) VALUES (?, ?, ?)")
      .run(matchId, role, content);
  }

  getConversation(matchId: string, limit: number = 50): ConversationMessage[] {
    return this.db
      .prepare(
        "SELECT role, content, timestamp FROM conversation_log WHERE match_id = ? ORDER BY id ASC LIMIT ?"
      )
      .all(matchId, limit) as ConversationMessage[];
  }

  getConversationCount(matchId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM conversation_log WHERE match_id = ?")
      .get(matchId) as { count: number };
    return row.count;
  }

  // --- Bot State ---

  getState(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM bot_state WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value || null;
  }

  setState(key: string, value: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  // --- Queries for follow-up logic ---

  getMatchesNeedingFollowup(waitHours: number, maxFollowups: number): MatchState[] {
    const unlimitedFollowups = maxFollowups === 0;
    const query = unlimitedFollowups
      ? `SELECT * FROM match_states
         WHERE status IN ('opener_sent', 'chatting', 'date_proposed')
         AND last_message_from = 'bot'
         AND last_bot_message_at IS NOT NULL
         AND datetime(last_bot_message_at, '+' || ? || ' hours') <= datetime('now')
         ORDER BY last_bot_message_at ASC`
      : `SELECT * FROM match_states
         WHERE status IN ('opener_sent', 'chatting', 'date_proposed')
         AND last_message_from = 'bot'
         AND last_bot_message_at IS NOT NULL
         AND followups_sent < ?
         AND datetime(last_bot_message_at, '+' || ? || ' hours') <= datetime('now')
         ORDER BY last_bot_message_at ASC`;

    if (unlimitedFollowups) {
      return this.db.prepare(query).all(waitHours) as MatchState[];
    }
    return this.db.prepare(query).all(maxFollowups, waitHours) as MatchState[];
  }

  // --- Stats ---

  getStats(): {
    total: number;
    by_status: Record<string, number>;
    dates_confirmed: number;
    messages_sent_total: number;
  } {
    const total = (
      this.db.prepare("SELECT COUNT(*) as c FROM match_states").get() as { c: number }
    ).c;

    const statusRows = this.db
      .prepare("SELECT status, COUNT(*) as c FROM match_states GROUP BY status")
      .all() as Array<{ status: string; c: number }>;

    const by_status: Record<string, number> = {};
    for (const row of statusRows) {
      by_status[row.status] = row.c;
    }

    const dates_confirmed = by_status["date_confirmed"] || 0;

    const msgRow = this.db
      .prepare("SELECT SUM(messages_sent) as total FROM match_states")
      .get() as { total: number | null };

    return {
      total,
      by_status,
      dates_confirmed,
      messages_sent_total: msgRow.total || 0,
    };
  }

  close(): void {
    this.db.close();
  }
}
