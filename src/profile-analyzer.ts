import axios from "axios";
import OpenAI from "openai";
import { TinderProfile } from "./types";

export interface ProfileAnalysis {
  summary: string;
  photo_observations: string[];
  personality_signals: string[];
  conversation_hooks: string[];
  suggested_approach: string;
}

export class ProfileAnalyzer {
  private openai: OpenAI;
  private model: string;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.model = process.env.OPENAI_MODEL || "gpt-4o";
  }

  async analyzeProfile(profile: TinderProfile): Promise<ProfileAnalysis> {
    // Build the multimodal message content: text bio + all photo URLs
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "low" | "high" } }
    > = [];

    // Add text context first
    const textContext = this.buildTextContext(profile);
    content.push({ type: "text", text: textContext });

    // Add each profile photo for vision analysis
    for (const photo of profile.photos.slice(0, 6)) {
      const imageUrl = await this.getAccessibleImageUrl(photo.url);
      if (imageUrl) {
        content.push({
          type: "image_url",
          image_url: { url: imageUrl, detail: "low" },
        });
      }
    }

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: ANALYSIS_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content,
        },
      ],
      max_tokens: 800,
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    try {
      const raw = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(raw);
      return {
        summary: parsed.summary || this.buildBasicSummary(profile),
        photo_observations: parsed.photo_observations || [],
        personality_signals: parsed.personality_signals || [],
        conversation_hooks: parsed.conversation_hooks || [],
        suggested_approach: parsed.suggested_approach || "Be genuine and ask about her interests.",
      };
    } catch {
      // Fallback if JSON parsing fails
      return {
        summary: this.buildBasicSummary(profile),
        photo_observations: [],
        personality_signals: [],
        conversation_hooks: [],
        suggested_approach: "Be genuine and ask about her interests.",
      };
    }
  }

  formatForProfileSummary(profile: TinderProfile, analysis: ProfileAnalysis): string {
    const parts: string[] = [];

    parts.push(`Name: ${profile.name}`);
    parts.push(`\n--- Profile Text ---`);
    if (profile.bio) parts.push(`Bio: ${profile.bio}`);
    if (profile.jobs?.length) {
      const job = profile.jobs[0];
      const jobParts: string[] = [];
      if (job.title?.name) jobParts.push(job.title.name);
      if (job.company?.name) jobParts.push(`at ${job.company.name}`);
      if (jobParts.length) parts.push(`Job: ${jobParts.join(" ")}`);
    }
    if (profile.schools?.length) {
      parts.push(`School: ${profile.schools.map((s) => s.name).join(", ")}`);
    }
    if (profile.city?.name) parts.push(`City: ${profile.city.name}`);
    if (profile.common_interests?.length) {
      parts.push(`Common interests: ${profile.common_interests.map((i) => i.name).join(", ")}`);
    }
    if (profile.distance_mi) parts.push(`Distance: ${profile.distance_mi} miles away`);

    parts.push(`\n--- Photo Analysis ---`);
    if (analysis.photo_observations.length > 0) {
      for (const obs of analysis.photo_observations) {
        parts.push(`- ${obs}`);
      }
    }

    parts.push(`\n--- Personality Signals ---`);
    if (analysis.personality_signals.length > 0) {
      for (const sig of analysis.personality_signals) {
        parts.push(`- ${sig}`);
      }
    }

    parts.push(`\n--- Conversation Hooks (things to bring up) ---`);
    if (analysis.conversation_hooks.length > 0) {
      for (const hook of analysis.conversation_hooks) {
        parts.push(`- ${hook}`);
      }
    }

    parts.push(`\n--- Suggested Approach ---`);
    parts.push(analysis.suggested_approach);

    return parts.join("\n");
  }

  private buildTextContext(profile: TinderProfile): string {
    const parts: string[] = [
      "Analyze this Tinder profile. Here is the text information:",
      "",
    ];

    parts.push(`Name: ${profile.name}`);
    if (profile.bio) parts.push(`Bio: "${profile.bio}"`);
    if (profile.jobs?.length) {
      const job = profile.jobs[0];
      if (job.title?.name || job.company?.name) {
        parts.push(`Job: ${job.title?.name || ""} ${job.company?.name ? `at ${job.company.name}` : ""}`);
      }
    }
    if (profile.schools?.length) {
      parts.push(`School: ${profile.schools.map((s) => s.name).join(", ")}`);
    }
    if (profile.common_interests?.length) {
      parts.push(`Shared interests: ${profile.common_interests.map((i) => i.name).join(", ")}`);
    }
    parts.push("");
    parts.push(`The following images are her profile photos. Analyze them for clues about her personality, interests, lifestyle, and good conversation starters.`);

    return parts.join("\n");
  }

  private buildBasicSummary(profile: TinderProfile): string {
    const parts: string[] = [];
    parts.push(`Name: ${profile.name}`);
    if (profile.bio) parts.push(`Bio: ${profile.bio}`);
    return parts.join("\n");
  }

  private async getAccessibleImageUrl(url: string): Promise<string | null> {
    // Tinder photo URLs are typically directly accessible CDN URLs
    // Try to convert to a base64 data URL for reliability with the OpenAI API
    try {
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      });
      const base64 = Buffer.from(response.data).toString("base64");
      const contentType = response.headers["content-type"] || "image/jpeg";
      return `data:${contentType};base64,${base64}`;
    } catch {
      // If we can't download, try passing the URL directly
      // OpenAI can fetch public URLs
      return url;
    }
  }
}

const ANALYSIS_SYSTEM_PROMPT = `You are analyzing a Tinder profile to help craft the perfect personalized opening message.

Examine both the text information AND all profile photos carefully. Look for:

FROM PHOTOS:
- Activities shown (hiking, travel, sports, cooking, pets, etc.)
- Locations/settings (beach, mountains, city, restaurants, etc.)
- Style/vibe (adventurous, artsy, sporty, glamorous, casual, etc.)
- Pets visible
- Group photos vs solo (social vs independent)
- Any notable items, hobbies, or interests visible
- Travel destinations
- Outfits/style that suggest personality

FROM TEXT:
- Stated interests and hobbies
- Humor style (if bio shows humor)
- What they seem to be looking for
- Conversation starters embedded in bio
- Shared interests or common ground

Respond in JSON format:
{
  "summary": "A 2-3 sentence overall impression of this person",
  "photo_observations": ["observation 1", "observation 2", ...],
  "personality_signals": ["signal 1", "signal 2", ...],
  "conversation_hooks": ["specific topic/question that could start a great conversation", ...],
  "suggested_approach": "How to best approach this person based on their vibe - tone, topics to lead with, etc."
}

Be specific and actionable. The conversation hooks should be things that would make her think "wow, he actually looked at my profile" rather than generic comments.`;
