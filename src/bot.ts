import { TinderClient } from "./tinder-client";
import { DB } from "./database";
import { ConversationEngine } from "./conversation-engine";
import { ProfileAnalyzer } from "./profile-analyzer";
import { Notifier } from "./notifier";
import { AppConfig, MatchState, TinderMatch } from "./types";

export class Bot {
  private tinder: TinderClient;
  private db: DB;
  private ai: ConversationEngine;
  private profileAnalyzer: ProfileAnalyzer;
  private notifier: Notifier;
  private config: AppConfig;
  private myUserId: string = "";
  private running: boolean = false;
  private lastActivityDate: string = "";

  constructor(config: AppConfig, authToken: string) {
    this.config = config;
    this.tinder = new TinderClient(authToken);
    this.db = new DB();
    this.ai = new ConversationEngine(config);
    this.profileAnalyzer = new ProfileAnalyzer();
    this.notifier = new Notifier(config);
  }

  async start(): Promise<void> {
    console.log("Initializing bot...");

    // Verify auth
    const profile = await this.tinder.getProfile();
    this.myUserId = profile._id;
    console.log(`Authenticated as: ${profile.name} (${this.myUserId})`);

    this.running = true;
    console.log("Bot is running. Press Ctrl+C to stop.\n");

    // Main loop
    while (this.running) {
      try {
        await this.poll();
        this.notifier.printSummaryIfDue();
      } catch (err: any) {
        this.notifier.emit({ type: "error", message: `Poll error: ${err.message}` });
      }
      await this.sleep(this.config.polling.message_check_interval * 1000);
    }
  }

  stop(): void {
    this.running = false;
    this.db.close();
    console.log("\nBot stopped.");
  }

  private async poll(): Promise<void> {
    // Get updates from Tinder
    const updates = await this.tinder.getUpdates(this.lastActivityDate || undefined);
    this.lastActivityDate = updates.last_activity_date;

    // Handle blocks/unmatches
    for (const blockedId of updates.blocks) {
      const matches = this.db.getAllMatches();
      for (const match of matches) {
        if (match.tinder_person_id === blockedId) {
          this.db.upsertMatch({ match_id: match.match_id, status: "unmatched" });
        }
      }
    }

    // Process each match from updates
    for (const match of updates.matches) {
      await this.processMatch(match);
    }

    // Check for follow-ups needed
    await this.processFollowups();
  }

  private async processMatch(match: TinderMatch): Promise<void> {
    const existing = this.db.getMatch(match._id);

    if (!existing) {
      // New match!
      await this.handleNewMatch(match);
    } else {
      // Existing match - check for new messages from her
      await this.handleExistingMatch(match, existing);
    }
  }

  private async handleNewMatch(match: TinderMatch): Promise<void> {
    // Deep-analyze the profile: text + all photos via vision AI
    let profileSummary: string;
    try {
      const analysis = await this.profileAnalyzer.analyzeProfile(match.person);
      profileSummary = this.profileAnalyzer.formatForProfileSummary(match.person, analysis);
    } catch (err: any) {
      // Fallback to basic text-only summary if vision analysis fails
      this.notifier.emit({
        type: "error",
        message: `Photo analysis failed for ${match.person.name}, using text-only: ${err.message}`,
      });
      profileSummary = this.tinder.buildProfileSummary(match.person);
    }

    const state: Partial<MatchState> & { match_id: string } = {
      match_id: match._id,
      tinder_person_id: match.person._id,
      name: match.person.name,
      status: "new",
      profile_summary: profileSummary,
      messages_sent: 0,
      messages_received: 0,
      followups_sent: 0,
    };

    this.db.upsertMatch(state);
    this.notifier.emit({ type: "new_match", match, state: state as MatchState });

    // Generate and send opener (now powered by the rich profile analysis)
    const matchState = this.db.getMatch(match._id)!;
    await this.sendOpener(matchState);
  }

  private async sendOpener(matchState: MatchState): Promise<void> {
    try {
      // Random delay to seem human
      await this.humanDelay();

      const opener = await this.ai.generateOpener(matchState);
      await this.tinder.sendMessage(matchState.match_id, opener);

      // Update state
      this.db.addMessage(matchState.match_id, "assistant", opener);
      this.db.upsertMatch({
        match_id: matchState.match_id,
        status: "opener_sent",
        messages_sent: matchState.messages_sent + 1,
        last_message_from: "bot",
        last_message_at: new Date().toISOString(),
        last_bot_message_at: new Date().toISOString(),
      });

      this.notifier.emit({
        type: "message_sent",
        match_id: matchState.match_id,
        name: matchState.name,
        message: opener,
      });
    } catch (err: any) {
      this.notifier.emit({
        type: "error",
        message: `Failed to send opener to ${matchState.name}: ${err.message}`,
      });
    }
  }

  private async handleExistingMatch(match: TinderMatch, existing: MatchState): Promise<void> {
    if (existing.status === "stopped" || existing.status === "ghosted" || existing.status === "unmatched") {
      return;
    }

    // Check for max messages
    if (
      this.config.rules.max_messages_per_match > 0 &&
      existing.messages_sent >= this.config.rules.max_messages_per_match
    ) {
      return;
    }

    // Get recent messages from Tinder
    const { messages } = await this.tinder.getMessages(match._id, 10);

    // Find new messages from the match (not from us)
    const newIncoming = messages.filter((m) => {
      if (m.from === this.myUserId) return false;
      // Check if this message is newer than our last recorded incoming
      if (!existing.last_message_at) return true;
      return new Date(m.sent_date) > new Date(existing.last_message_at);
    });

    if (newIncoming.length === 0) return;

    // Process new messages
    for (const msg of newIncoming.reverse()) {
      this.db.addMessage(match._id, "user", msg.message);

      this.notifier.emit({
        type: "message_received",
        match_id: match._id,
        name: existing.name,
        message: msg.message,
      });
    }

    // Update state
    const latestMsg = newIncoming[0];
    this.db.upsertMatch({
      match_id: match._id,
      status: existing.status === "opener_sent" ? "chatting" : existing.status,
      messages_received: existing.messages_received + newIncoming.length,
      last_message_from: "match",
      last_message_at: latestMsg.sent_date,
      followups_sent: 0, // Reset followup counter when she replies
    });

    // Check if her message is about a date
    const latestMessage = newIncoming[newIncoming.length - 1].message;
    if (existing.status === "date_proposed") {
      const analysis = await this.ai.analyzeForDateMention(latestMessage);
      if (analysis.mentions_date && analysis.accepted) {
        // She said yes! Notify user for confirmation
        const details = analysis.proposed_details || existing.date_details || "Details TBD";
        this.db.upsertMatch({
          match_id: match._id,
          status: "date_pending",
          date_details: details,
        });
        this.notifier.emit({
          type: "date_pending_approval",
          match_id: match._id,
          name: existing.name,
          details,
        });
        return;
      }
    }

    // Generate and send reply
    await this.sendReply(match._id);
  }

  private async sendReply(matchId: string): Promise<void> {
    const matchState = this.db.getMatch(matchId);
    if (!matchState) return;

    try {
      await this.humanDelay();

      const conversation = this.db.getConversation(matchId);
      const reply = await this.ai.generateReply(matchState, conversation);

      if (!reply) return;

      await this.tinder.sendMessage(matchId, reply);

      // Check if this reply is a date proposal
      const dateAnalysis = await this.ai.analyzeForDateMention(reply);
      const newStatus = dateAnalysis.mentions_date ? "date_proposed" : matchState.status;

      this.db.addMessage(matchId, "assistant", reply);
      this.db.upsertMatch({
        match_id: matchId,
        status: newStatus,
        messages_sent: matchState.messages_sent + 1,
        last_message_from: "bot",
        last_message_at: new Date().toISOString(),
        last_bot_message_at: new Date().toISOString(),
        date_details: dateAnalysis.proposed_details || matchState.date_details,
      });

      this.notifier.emit({
        type: "message_sent",
        match_id: matchId,
        name: matchState.name,
        message: reply,
      });

      if (dateAnalysis.mentions_date) {
        this.notifier.emit({
          type: "date_proposed",
          match_id: matchId,
          name: matchState.name,
          details: dateAnalysis.proposed_details || "See conversation",
        });
      }
    } catch (err: any) {
      this.notifier.emit({
        type: "error",
        message: `Failed to reply to ${matchState.name}: ${err.message}`,
      });
    }
  }

  private async processFollowups(): Promise<void> {
    const needFollowup = this.db.getMatchesNeedingFollowup(
      this.config.followup.wait_hours,
      this.config.followup.max_followups
    );

    for (const match of needFollowup) {
      // Check if we've hit the max (when not unlimited)
      if (
        this.config.followup.max_followups > 0 &&
        match.followups_sent >= this.config.followup.max_followups
      ) {
        this.db.upsertMatch({ match_id: match.match_id, status: "ghosted" });
        this.notifier.emit({
          type: "match_ghosted",
          match_id: match.match_id,
          name: match.name,
        });
        continue;
      }

      try {
        await this.humanDelay();

        const conversation = this.db.getConversation(match.match_id);
        const followup = await this.ai.generateFollowup(match, conversation);

        if (!followup) continue;

        await this.tinder.sendMessage(match.match_id, followup);

        this.db.addMessage(match.match_id, "assistant", followup);
        this.db.upsertMatch({
          match_id: match.match_id,
          messages_sent: match.messages_sent + 1,
          followups_sent: match.followups_sent + 1,
          last_message_from: "bot",
          last_message_at: new Date().toISOString(),
          last_bot_message_at: new Date().toISOString(),
        });

        this.notifier.emit({
          type: "followup_sent",
          match_id: match.match_id,
          name: match.name,
          attempt: match.followups_sent + 1,
        });
      } catch (err: any) {
        this.notifier.emit({
          type: "error",
          message: `Failed to follow up with ${match.name}: ${err.message}`,
        });
      }
    }
  }

  // --- Public methods for CLI ---

  getDB(): DB {
    return this.db;
  }

  async approveDate(matchId: string): Promise<void> {
    const match = this.db.getMatch(matchId);
    if (!match) throw new Error(`Match ${matchId} not found`);
    if (match.status !== "date_pending") {
      throw new Error(`Match ${match.name} is not pending date approval (status: ${match.status})`);
    }

    this.db.upsertMatch({ match_id: matchId, status: "date_confirmed" });

    // Send confirmation message to the match
    const conversation = this.db.getConversation(matchId);
    const reply = await this.ai.generateReply(
      { ...match, status: "date_confirmed" },
      [
        ...conversation,
        {
          role: "user" as const,
          content: "(System: The user has confirmed the date. Send an enthusiastic confirmation message with the date details.)",
          timestamp: new Date().toISOString(),
        },
      ]
    );

    if (reply) {
      await this.tinder.sendMessage(matchId, reply);
      this.db.addMessage(matchId, "assistant", reply);
    }

    this.notifier.emit({
      type: "date_confirmed",
      match_id: matchId,
      name: match.name,
      details: match.date_details || "See conversation",
    });
  }

  async rejectDate(matchId: string): Promise<void> {
    const match = this.db.getMatch(matchId);
    if (!match) throw new Error(`Match ${matchId} not found`);

    this.db.upsertMatch({
      match_id: matchId,
      status: "chatting",
      date_details: null,
    });

    // Send a message suggesting a different time
    const conversation = this.db.getConversation(matchId);
    const reply = await this.ai.generateReply(
      { ...match, status: "chatting" },
      [
        ...conversation,
        {
          role: "user" as const,
          content: "(System: That time doesn't work. Suggest rescheduling for a different day/time. Be casual about it.)",
          timestamp: new Date().toISOString(),
        },
      ]
    );

    if (reply) {
      await this.tinder.sendMessage(matchId, reply);
      this.db.addMessage(matchId, "assistant", reply);
    }
  }

  private async humanDelay(): Promise<void> {
    const min = this.config.polling.response_delay_min * 1000;
    const max = this.config.polling.response_delay_max * 1000;
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await this.sleep(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
