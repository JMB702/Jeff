import { Command } from "commander";
import chalk from "chalk";
import { table } from "table";
import dotenv from "dotenv";
import { Bot } from "./bot";
import { DB } from "./database";
import { loadConfig } from "./config-loader";

dotenv.config();

const program = new Command();

program
  .name("tinder-bot")
  .description("Automated Tinder messaging bot with AI-powered conversations")
  .version("1.0.0");

// --- Run the bot ---
program
  .command("run")
  .description("Start the bot")
  .option("-c, --config <path>", "Path to config file", "config.yaml")
  .action(async (opts) => {
    const authToken = process.env.TINDER_AUTH_TOKEN;
    if (!authToken) {
      console.error(chalk.red("Error: TINDER_AUTH_TOKEN not set in .env file"));
      console.error("Get your token from Tinder web app (browser dev tools > Network tab)");
      process.exit(1);
    }
    if (!process.env.OPENAI_API_KEY) {
      console.error(chalk.red("Error: OPENAI_API_KEY not set in .env file"));
      process.exit(1);
    }

    const config = loadConfig(opts.config);
    const bot = new Bot(config, authToken);

    process.on("SIGINT", () => bot.stop());
    process.on("SIGTERM", () => bot.stop());

    await bot.start();
  });

// --- Status ---
program
  .command("status")
  .description("Show bot status and statistics")
  .action(() => {
    const db = new DB();
    const stats = db.getStats();

    console.log(chalk.bold.underline("\nBot Statistics\n"));
    console.log(`  Total matches tracked:  ${chalk.cyan(stats.total)}`);
    console.log(`  Messages sent:          ${chalk.blue(stats.messages_sent_total)}`);
    console.log(`  Dates confirmed:        ${chalk.green(stats.dates_confirmed)}`);
    console.log("");

    if (Object.keys(stats.by_status).length > 0) {
      console.log(chalk.bold("  Matches by status:"));
      for (const [status, count] of Object.entries(stats.by_status)) {
        const color = statusColor(status);
        console.log(`    ${color(status.padEnd(20))} ${count}`);
      }
    }

    console.log("");
    db.close();
  });

// --- List matches ---
program
  .command("matches")
  .description("List all tracked matches")
  .option("-s, --status <status>", "Filter by status")
  .action((opts) => {
    const db = new DB();
    const matches = opts.status
      ? db.getMatchesByStatus(opts.status)
      : db.getAllMatches();

    if (matches.length === 0) {
      console.log(chalk.gray("\nNo matches found.\n"));
      db.close();
      return;
    }

    const rows = matches.map((m) => [
      m.name,
      statusBadge(m.status),
      `${m.messages_sent}/${m.messages_received}`,
      m.followups_sent.toString(),
      m.date_details || "-",
      m.last_message_at ? timeSince(m.last_message_at) : "-",
      m.match_id.slice(0, 12) + "...",
    ]);

    const header = ["Name", "Status", "Sent/Recv", "Follow-ups", "Date", "Last Activity", "Match ID"];
    console.log("\n" + table([header, ...rows]));
    db.close();
  });

// --- View conversation ---
program
  .command("conversation <matchId>")
  .description("View conversation history with a match")
  .action((matchId) => {
    const db = new DB();
    const match = db.getMatch(matchId);
    if (!match) {
      // Try partial match
      const all = db.getAllMatches();
      const found = all.find((m) => m.match_id.startsWith(matchId) || m.name.toLowerCase() === matchId.toLowerCase());
      if (!found) {
        console.error(chalk.red(`Match not found: ${matchId}`));
        db.close();
        return;
      }
      matchId = found.match_id;
    }

    const state = db.getMatch(matchId)!;
    const messages = db.getConversation(matchId);

    console.log(chalk.bold(`\nConversation with ${state.name} [${state.status}]\n`));

    for (const msg of messages) {
      const sender = msg.role === "assistant" ? chalk.blue("You") : chalk.green(state.name);
      const time = chalk.gray(new Date(msg.timestamp).toLocaleString());
      console.log(`${sender} ${time}`);
      console.log(`  ${msg.content}\n`);
    }

    db.close();
  });

// --- Approve date ---
program
  .command("approve-date <matchId>")
  .description("Approve a pending date")
  .action(async (matchId) => {
    const authToken = process.env.TINDER_AUTH_TOKEN;
    if (!authToken) {
      console.error(chalk.red("Error: TINDER_AUTH_TOKEN not set"));
      process.exit(1);
    }

    const config = loadConfig();
    const bot = new Bot(config, authToken);

    try {
      await bot.approveDate(matchId);
      console.log(chalk.green("\nDate approved and confirmation sent!"));
    } catch (err: any) {
      console.error(chalk.red(`\nError: ${err.message}`));
    }
  });

// --- Reject date ---
program
  .command("reject-date <matchId>")
  .description("Reject a pending date (will suggest rescheduling)")
  .action(async (matchId) => {
    const authToken = process.env.TINDER_AUTH_TOKEN;
    if (!authToken) {
      console.error(chalk.red("Error: TINDER_AUTH_TOKEN not set"));
      process.exit(1);
    }

    const config = loadConfig();
    const bot = new Bot(config, authToken);

    try {
      await bot.rejectDate(matchId);
      console.log(chalk.yellow("\nDate declined. Bot will suggest rescheduling."));
    } catch (err: any) {
      console.error(chalk.red(`\nError: ${err.message}`));
    }
  });

// --- Stop bot for specific match ---
program
  .command("stop-match <matchId>")
  .description("Stop the bot from messaging a specific match")
  .action((matchId) => {
    const db = new DB();
    db.upsertMatch({ match_id: matchId, status: "stopped" });
    console.log(chalk.yellow(`\nBot will no longer message match ${matchId}`));
    db.close();
  });

// --- Resume match ---
program
  .command("resume-match <matchId>")
  .description("Resume the bot for a stopped match")
  .action((matchId) => {
    const db = new DB();
    db.upsertMatch({ match_id: matchId, status: "chatting" });
    console.log(chalk.green(`\nBot will resume messaging match ${matchId}`));
    db.close();
  });

// --- Config info ---
program
  .command("config")
  .description("Show current configuration")
  .option("-c, --config <path>", "Path to config file", "config.yaml")
  .action((opts) => {
    const config = loadConfig(opts.config);
    console.log(chalk.bold.underline("\nCurrent Configuration\n"));
    console.log(chalk.bold("Personality:"));
    console.log(`  Name: ${config.personality.name}`);
    console.log(`  Traits: ${config.personality.traits.join(", ")}`);
    console.log(chalk.bold("\nRules:"));
    console.log(`  Min messages before date: ${config.rules.min_messages_before_date_proposal}`);
    console.log(`  Max messages per match: ${config.rules.max_messages_per_match || "unlimited"}`);
    console.log(chalk.bold("\nFollow-up:"));
    console.log(`  Wait time: ${config.followup.wait_hours} hours`);
    console.log(`  Max follow-ups: ${config.followup.max_followups || "unlimited"}`);
    console.log(chalk.bold("\nPolling:"));
    console.log(`  Match check: every ${config.polling.new_match_interval}s`);
    console.log(`  Message check: every ${config.polling.message_check_interval}s`);
    console.log(`  Response delay: ${config.polling.response_delay_min}-${config.polling.response_delay_max}s`);
    console.log("");
  });

// --- Helpers ---

function statusColor(status: string): (s: string) => string {
  const colors: Record<string, (s: string) => string> = {
    new: chalk.white,
    opener_sent: chalk.blue,
    chatting: chalk.cyan,
    date_proposed: chalk.yellow,
    date_pending: chalk.yellowBright,
    date_confirmed: chalk.green,
    date_rejected: chalk.red,
    ghosted: chalk.gray,
    unmatched: chalk.gray,
    stopped: chalk.gray,
  };
  return colors[status] || chalk.white;
}

function statusBadge(status: string): string {
  return statusColor(status)(status);
}

function timeSince(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

program.parse();
