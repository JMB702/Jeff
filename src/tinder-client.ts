import axios, { AxiosInstance } from "axios";
import { TinderMatch, TinderMessage, TinderProfile } from "./types";

const TINDER_API_BASE = "https://api.gotinder.com";

export class TinderClient {
  private client: AxiosInstance;
  private userId: string | null = null;

  constructor(authToken: string) {
    this.client = axios.create({
      baseURL: TINDER_API_BASE,
      headers: {
        "X-Auth-Token": authToken,
        "Content-Type": "application/json",
        "User-Agent": "Tinder/14.21.0 (iPhone; iOS 16.6; Scale/3.00)",
        "platform": "ios",
        "app-version": "4523",
      },
    });
  }

  async getProfile(): Promise<TinderProfile & { _id: string }> {
    const res = await this.client.get("/v2/profile?include=user");
    this.userId = res.data.data.user._id;
    return res.data.data.user;
  }

  getMyUserId(): string | null {
    return this.userId;
  }

  async getMatches(count: number = 60, pageToken?: string): Promise<{
    matches: TinderMatch[];
    next_page_token?: string;
  }> {
    const params: Record<string, string> = {
      count: count.toString(),
      is_tinder_u: "false",
      locale: "en",
    };
    if (pageToken) {
      params.page_token = pageToken;
    }
    const res = await this.client.get("/v2/matches", { params });
    return {
      matches: res.data.data.matches || [],
      next_page_token: res.data.data.next_page_token,
    };
  }

  async getMatch(matchId: string): Promise<TinderMatch> {
    const res = await this.client.get(`/v2/matches/${matchId}?locale=en`);
    return res.data.data;
  }

  async getMessages(matchId: string, count: number = 100, pageToken?: string): Promise<{
    messages: TinderMessage[];
    next_page_token?: string;
  }> {
    const params: Record<string, string> = {
      count: count.toString(),
      locale: "en",
    };
    if (pageToken) {
      params.page_token = pageToken;
    }
    const res = await this.client.get(`/v2/matches/${matchId}/messages`, { params });
    return {
      messages: res.data.data.messages || [],
      next_page_token: res.data.data.next_page_token,
    };
  }

  async sendMessage(matchId: string, message: string): Promise<TinderMessage> {
    const res = await this.client.post(`/user/matches/${matchId}`, {
      message,
    });
    return res.data;
  }

  async getUpdates(lastActivityDate?: string): Promise<{
    matches: TinderMatch[];
    blocks: string[];
    last_activity_date: string;
  }> {
    const res = await this.client.post("/updates", {
      last_activity_date: lastActivityDate || "",
    });
    return {
      matches: res.data.matches || [],
      blocks: res.data.blocks || [],
      last_activity_date: res.data.last_activity_date,
    };
  }

  async getUser(userId: string): Promise<TinderProfile> {
    const res = await this.client.get(`/user/${userId}`);
    return res.data.results;
  }

  buildProfileSummary(profile: TinderProfile): string {
    const parts: string[] = [];
    parts.push(`Name: ${profile.name}`);
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
    if (profile.city?.name) {
      parts.push(`City: ${profile.city.name}`);
    }
    if (profile.common_interests?.length) {
      parts.push(`Common interests: ${profile.common_interests.map((i) => i.name).join(", ")}`);
    }
    if (profile.distance_mi) {
      parts.push(`Distance: ${profile.distance_mi} miles away`);
    }
    return parts.join("\n");
  }
}
