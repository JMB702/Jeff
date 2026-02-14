import OpenAI from "openai";
import { AppConfig, ConversationMessage, MatchState } from "./types";

export class ConversationEngine {
  private openai: OpenAI;
  private model: string;
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.model = process.env.OPENAI_MODEL || "gpt-4o";
    this.config = config;
  }

  private buildSystemPrompt(matchState: MatchState, context: "opener" | "reply" | "followup" | "date_proposal"): string {
    const c = this.config;
    let prompt = `${c.personality.style.trim()}\n\n`;

    prompt += `Your name is ${c.personality.name}.\n`;
    prompt += `Key traits: ${c.personality.traits.join(", ")}.\n\n`;

    // Profile context
    prompt += `Here is what you know about the person you're talking to:\n${matchState.profile_summary}\n\n`;

    // Rules
    prompt += "ABSOLUTE RULES - you must follow these:\n";
    for (const rule of c.rules.blacklist) {
      prompt += `- ${rule}\n`;
    }
    prompt += "\nGuidelines to follow:\n";
    for (const guideline of c.rules.whitelist) {
      prompt += `- ${guideline}\n`;
    }

    // Context-specific instructions
    switch (context) {
      case "opener":
        prompt += `\n--- TASK ---\nCraft an opening message to this new match.\n${c.personality.opener_strategy}\n`;
        prompt += "Respond with ONLY the message text, nothing else.\n";
        break;

      case "reply":
        prompt += `\n--- TASK ---\nYou are in an ongoing conversation. Reply naturally to her latest message.\n`;
        prompt += "Keep the conversation moving forward. Be engaging.\n";
        prompt += "Respond with ONLY the message text, nothing else.\n";
        break;

      case "followup":
        prompt += `\n--- TASK ---\n${c.followup.strategy}\n`;
        prompt += `This is follow-up attempt #${matchState.followups_sent + 1}.\n`;
        prompt += "Respond with ONLY the message text, nothing else.\n";
        break;

      case "date_proposal":
        prompt += `\n--- TASK ---\nIt's time to suggest meeting up! You've been chatting for a while and rapport seems good.\n`;
        prompt += `${c.dating.proposal_strategy}\n`;
        prompt += `Your availability: ${c.dating.availability}\n`;
        prompt += `Preferred activities: ${c.dating.preferred_activities.join(", ")}\n`;
        prompt += `Preferred areas: ${c.dating.preferred_areas.join(", ")}\n`;
        prompt += "Respond with ONLY the message text, nothing else.\n";
        break;
    }

    return prompt;
  }

  async generateOpener(matchState: MatchState): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(matchState, "opener");

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Generate an opening message for this match." },
      ],
      max_tokens: 200,
      temperature: 0.9,
    });

    return response.choices[0]?.message?.content?.trim() || "Hey! How's it going?";
  }

  async generateReply(
    matchState: MatchState,
    conversationHistory: ConversationMessage[]
  ): Promise<string> {
    const shouldProposDate = this.shouldProposeDateNow(matchState);
    const context = shouldProposDate ? "date_proposal" : "reply";
    const systemPrompt = this.buildSystemPrompt(matchState, context);

    const messages: Array<{ role: "system" | "assistant" | "user"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    // Add conversation history
    for (const msg of conversationHistory) {
      messages.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content,
      });
    }

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: 300,
      temperature: 0.85,
    });

    return response.choices[0]?.message?.content?.trim() || "";
  }

  async generateFollowup(
    matchState: MatchState,
    conversationHistory: ConversationMessage[]
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(matchState, "followup");

    const messages: Array<{ role: "system" | "assistant" | "user"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    for (const msg of conversationHistory) {
      messages.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content,
      });
    }

    messages.push({
      role: "user",
      content: "(She hasn't responded. Generate a follow-up message.)",
    });

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: 200,
      temperature: 0.9,
    });

    return response.choices[0]?.message?.content?.trim() || "";
  }

  async analyzeForDateMention(message: string): Promise<{
    mentions_date: boolean;
    accepted: boolean;
    proposed_details: string | null;
  }> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `Analyze this message from a Tinder match and determine:
1. Does it mention or respond to a date/meetup proposal?
2. If yes, did they accept/show interest or decline?
3. If they accepted, what details were mentioned (day, time, place)?

Respond in JSON format: {"mentions_date": boolean, "accepted": boolean, "proposed_details": string|null}`,
        },
        { role: "user", content: message },
      ],
      max_tokens: 150,
      temperature: 0,
      response_format: { type: "json_object" },
    });

    try {
      const content = response.choices[0]?.message?.content || "{}";
      return JSON.parse(content);
    } catch {
      return { mentions_date: false, accepted: false, proposed_details: null };
    }
  }

  private shouldProposeDateNow(matchState: MatchState): boolean {
    const totalExchanges = matchState.messages_sent + matchState.messages_received;
    const minMessages = this.config.rules.min_messages_before_date_proposal;
    return (
      totalExchanges >= minMessages &&
      matchState.status === "chatting" &&
      matchState.last_message_from === "match"
    );
  }
}
