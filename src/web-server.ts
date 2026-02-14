import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import { DB } from "./database";
import { Bot } from "./bot";
import { loadConfig } from "./config-loader";
import { MatchStatus, BotEvent } from "./types";

dotenv.config();

const app = express();
app.use(express.json());

const db = new DB();
const config = loadConfig();

let bot: Bot | null = null;
let botRunning = false;

// SSE clients for real-time updates
const sseClients: Response[] = [];

function broadcast(event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

// Periodically broadcast stats for live dashboard
setInterval(() => {
  if (sseClients.length > 0) {
    const stats = db.getStats();
    const matches = db.getAllMatches();
    const killed = db.getState("kill_switch") === "true";
    broadcast("update", { stats, matches, killed });
  }
}, 3000);

// --- SSE endpoint ---
app.get("/api/events", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.push(res);
  res.on("close", () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

// --- API routes ---

app.get("/api/stats", (_req: Request, res: Response) => {
  const stats = db.getStats();
  res.json(stats);
});

app.get("/api/matches", (req: Request, res: Response) => {
  const status = req.query.status as MatchStatus | undefined;
  const matches = status ? db.getMatchesByStatus(status) : db.getAllMatches();
  res.json(matches);
});

app.get("/api/matches/:id", (req: Request, res: Response) => {
  const match = findMatch(req.params.id as string);
  if (!match) return res.status(404).json({ error: "Match not found" });
  res.json(match);
});

app.get("/api/matches/:id/conversation", (req: Request, res: Response) => {
  const match = findMatch(req.params.id as string);
  if (!match) return res.status(404).json({ error: "Match not found" });
  const conversation = db.getConversation(match.match_id);
  res.json({ match, conversation });
});

app.post("/api/matches/:id/stop", (req: Request, res: Response) => {
  const match = findMatch(req.params.id as string);
  if (!match) return res.status(404).json({ error: "Match not found" });
  db.upsertMatch({ match_id: match.match_id, status: "stopped" });
  broadcast("match_updated", { match_id: match.match_id, status: "stopped" });
  res.json({ success: true });
});

app.post("/api/matches/:id/resume", (req: Request, res: Response) => {
  const match = findMatch(req.params.id as string);
  if (!match) return res.status(404).json({ error: "Match not found" });
  db.upsertMatch({ match_id: match.match_id, status: "chatting" });
  broadcast("match_updated", { match_id: match.match_id, status: "chatting" });
  res.json({ success: true });
});

app.post("/api/matches/:id/approve-date", async (req: Request, res: Response) => {
  const match = findMatch(req.params.id as string);
  if (!match) return res.status(404).json({ error: "Match not found" });
  if (match.status !== "date_pending") {
    return res.status(400).json({ error: `Match is not pending date approval (status: ${match.status})` });
  }

  try {
    const authToken = process.env.TINDER_AUTH_TOKEN;
    if (!authToken) return res.status(500).json({ error: "TINDER_AUTH_TOKEN not set" });
    const actionBot = new Bot(config, authToken);
    await actionBot.approveDate(match.match_id);
    broadcast("date_confirmed", { match_id: match.match_id, name: match.name });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/matches/:id/reject-date", async (req: Request, res: Response) => {
  const match = findMatch(req.params.id as string);
  if (!match) return res.status(404).json({ error: "Match not found" });

  try {
    const authToken = process.env.TINDER_AUTH_TOKEN;
    if (!authToken) return res.status(500).json({ error: "TINDER_AUTH_TOKEN not set" });
    const actionBot = new Bot(config, authToken);
    await actionBot.rejectDate(match.match_id);
    broadcast("date_rejected", { match_id: match.match_id, name: match.name });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/matches/:id/send", async (req: Request, res: Response) => {
  const match = findMatch(req.params.id as string);
  if (!match) return res.status(404).json({ error: "Match not found" });

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "Message is required" });

  try {
    const authToken = process.env.TINDER_AUTH_TOKEN;
    if (!authToken) return res.status(500).json({ error: "TINDER_AUTH_TOKEN not set" });
    const actionBot = new Bot(config, authToken);
    await actionBot.sendManualMessage(match.match_id, message);
    broadcast("message_sent", { match_id: match.match_id, name: match.name, message });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/config", (_req: Request, res: Response) => {
  res.json(config);
});

app.get("/api/bot/status", (_req: Request, res: Response) => {
  const killed = db.getState("kill_switch") === "true";
  res.json({ running: botRunning, killed });
});

app.post("/api/bot/kill", (_req: Request, res: Response) => {
  const current = db.getState("kill_switch") === "true";
  const newState = !current;
  db.setState("kill_switch", String(newState));

  // When kill switch is ON, stop all active matches
  if (newState) {
    const active = db.getAllMatches().filter(m =>
      ["new", "opener_sent", "chatting", "date_proposed"].includes(m.status)
    );
    for (const m of active) {
      db.upsertMatch({ match_id: m.match_id, status: "stopped" });
    }
  }

  broadcast("kill_switch", { killed: newState });
  res.json({ killed: newState });
});

// --- Serve frontend ---
app.get("/", (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

function findMatch(matchId: string) {
  const direct = db.getMatch(matchId);
  if (direct) return direct;
  const all = db.getAllMatches();
  return all.find(
    (m) => m.match_id.startsWith(matchId) || m.name.toLowerCase() === matchId.toLowerCase()
  ) || null;
}

export function startWebServer(port: number = 3000) {
  app.listen(port, () => {
    console.log(`\nDashboard running at http://localhost:${port}\n`);
  });
}
