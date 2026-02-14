// =============================================================================
// Core Types
// =============================================================================

export interface TinderProfile {
  _id: string;
  name: string;
  bio: string;
  birth_date: string;
  photos: TinderPhoto[];
  jobs: Array<{ title?: { name: string }; company?: { name: string } }>;
  schools: Array<{ name: string }>;
  city?: { name: string };
  distance_mi?: number;
  common_interests?: Array<{ name: string }>;
}

export interface TinderPhoto {
  id: string;
  url: string;
}

export interface TinderMatch {
  _id: string;
  person: TinderProfile;
  created_date: string;
  last_activity_date: string;
  messages: TinderMessage[];
  seen?: { match_seen: boolean };
}

export interface TinderMessage {
  _id: string;
  match_id: string;
  from: string;
  to: string;
  message: string;
  sent_date: string;
  timestamp: number;
}

// =============================================================================
// Internal State Types
// =============================================================================

export type MatchStatus =
  | "new"              // Just matched, no message sent yet
  | "opener_sent"      // First message sent, awaiting response
  | "chatting"         // Active back-and-forth conversation
  | "date_proposed"    // Bot has proposed a date, awaiting her response
  | "date_pending"     // She said yes, waiting for user confirmation
  | "date_confirmed"   // User confirmed the date
  | "date_rejected"    // User rejected the proposed date
  | "ghosted"          // Max follow-ups reached with no response
  | "unmatched"        // She unmatched
  | "stopped";         // User manually stopped the bot for this match

export interface MatchState {
  match_id: string;
  tinder_person_id: string;
  name: string;
  status: MatchStatus;
  messages_sent: number;
  messages_received: number;
  last_message_from: "bot" | "match" | null;
  last_message_at: string | null;
  last_bot_message_at: string | null;
  followups_sent: number;
  date_details: string | null;
  created_at: string;
  updated_at: string;
  profile_summary: string;
}

export interface ConversationMessage {
  role: "assistant" | "user";
  content: string;
  timestamp: string;
}

// =============================================================================
// Configuration Types
// =============================================================================

export interface AppConfig {
  personality: {
    name: string;
    style: string;
    opener_strategy: string;
    traits: string[];
  };
  rules: {
    blacklist: string[];
    whitelist: string[];
    min_messages_before_date_proposal: number;
    max_messages_per_match: number;
  };
  followup: {
    wait_hours: number;
    max_followups: number;
    strategy: string;
  };
  dating: {
    availability: string;
    preferred_activities: string[];
    preferred_areas: string[];
    proposal_strategy: string;
  };
  polling: {
    new_match_interval: number;
    message_check_interval: number;
    response_delay_min: number;
    response_delay_max: number;
  };
  notifications: {
    on_new_match: boolean;
    on_date_proposed: boolean;
    on_date_confirmed: boolean;
    on_message: boolean;
    summary_interval_minutes: number;
  };
}

// =============================================================================
// Event Types
// =============================================================================

export type BotEvent =
  | { type: "new_match"; match: TinderMatch; state: MatchState }
  | { type: "message_received"; match_id: string; name: string; message: string }
  | { type: "message_sent"; match_id: string; name: string; message: string }
  | { type: "date_proposed"; match_id: string; name: string; details: string }
  | { type: "date_pending_approval"; match_id: string; name: string; details: string }
  | { type: "date_confirmed"; match_id: string; name: string; details: string }
  | { type: "followup_sent"; match_id: string; name: string; attempt: number }
  | { type: "match_ghosted"; match_id: string; name: string }
  | { type: "error"; message: string };
