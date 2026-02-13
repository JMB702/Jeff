import fs from "fs";
import path from "path";
import YAML from "yaml";
import { AppConfig } from "./types";

const DEFAULT_CONFIG: AppConfig = {
  personality: {
    name: "Jeff",
    style: "Be natural, witty, and confident. Use casual texting style.",
    opener_strategy: "Reference something from her profile. Be creative. Ask a question.",
    traits: ["witty", "confident", "genuine"],
  },
  rules: {
    blacklist: ["never send explicit messages", "never be rude"],
    whitelist: ["be curious about her interests", "use humor"],
    min_messages_before_date_proposal: 6,
    max_messages_per_match: 0,
  },
  followup: {
    wait_hours: 24,
    max_followups: 3,
    strategy: "Send a casual follow-up without referencing the lack of response.",
  },
  dating: {
    availability: "Free evenings after 6pm weekdays, flexible weekends.",
    preferred_activities: ["drinks", "coffee"],
    preferred_areas: ["downtown"],
    proposal_strategy: "Suggest meeting up with a specific activity and timeframe.",
  },
  polling: {
    new_match_interval: 30,
    message_check_interval: 15,
    response_delay_min: 30,
    response_delay_max: 180,
  },
  notifications: {
    on_new_match: true,
    on_date_proposed: true,
    on_date_confirmed: true,
    on_message: false,
    summary_interval_minutes: 60,
  },
};

export function loadConfig(configPath?: string): AppConfig {
  const resolved = configPath || path.join(process.cwd(), "config.yaml");

  if (!fs.existsSync(resolved)) {
    console.warn(`Config file not found at ${resolved}, using defaults.`);
    return DEFAULT_CONFIG;
  }

  const raw = fs.readFileSync(resolved, "utf-8");
  const parsed = YAML.parse(raw);

  // Deep merge with defaults
  return deepMerge(DEFAULT_CONFIG, parsed) as AppConfig;
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object"
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}
