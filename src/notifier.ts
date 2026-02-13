import chalk from "chalk";
import { AppConfig, BotEvent } from "./types";

export class Notifier {
  private config: AppConfig;
  private eventLog: Array<{ time: string; event: BotEvent }> = [];
  private lastSummaryAt: number = Date.now();

  constructor(config: AppConfig) {
    this.config = config;
  }

  emit(event: BotEvent): void {
    const now = new Date().toISOString();
    this.eventLog.push({ time: now, event });

    switch (event.type) {
      case "new_match":
        if (this.config.notifications.on_new_match) {
          this.print(
            chalk.magenta("NEW MATCH"),
            `${chalk.bold(event.state.name)} just matched with you!`
          );
        }
        break;

      case "message_sent":
        if (this.config.notifications.on_message) {
          this.print(
            chalk.blue("SENT"),
            `To ${chalk.bold(event.name)}: ${this.truncate(event.message, 80)}`
          );
        }
        break;

      case "message_received":
        if (this.config.notifications.on_message) {
          this.print(
            chalk.green("RECEIVED"),
            `From ${chalk.bold(event.name)}: ${this.truncate(event.message, 80)}`
          );
        }
        break;

      case "date_proposed":
        if (this.config.notifications.on_date_proposed) {
          this.print(
            chalk.yellow("DATE PROPOSED"),
            `Proposed a date with ${chalk.bold(event.name)}: ${event.details}`
          );
        }
        break;

      case "date_pending_approval":
        this.print(
          chalk.yellowBright.bold("ACTION REQUIRED"),
          `${chalk.bold(event.name)} said yes to a date! Details: ${event.details}\n` +
            `  Run: ${chalk.cyan(`npm run approve-date -- ${event.match_id}`)} to confirm\n` +
            `  Run: ${chalk.cyan(`npm run reject-date -- ${event.match_id}`)} to decline`
        );
        break;

      case "date_confirmed":
        this.print(
          chalk.green.bold("DATE CONFIRMED"),
          `You have a date with ${chalk.bold(event.name)}! ${event.details}`
        );
        break;

      case "followup_sent":
        this.print(
          chalk.gray("FOLLOW-UP"),
          `Sent follow-up #${event.attempt} to ${chalk.bold(event.name)}`
        );
        break;

      case "match_ghosted":
        this.print(
          chalk.gray("GHOSTED"),
          `${chalk.bold(event.name)} hasn't responded after max follow-ups. Moving on.`
        );
        break;

      case "error":
        this.print(chalk.red("ERROR"), event.message);
        break;
    }
  }

  printSummaryIfDue(): void {
    const interval = this.config.notifications.summary_interval_minutes;
    if (interval <= 0) return;

    const elapsed = Date.now() - this.lastSummaryAt;
    if (elapsed < interval * 60 * 1000) return;

    this.printSummary();
    this.lastSummaryAt = Date.now();
  }

  printSummary(): void {
    const recentEvents = this.eventLog.filter((e) => {
      const eventTime = new Date(e.time).getTime();
      return Date.now() - eventTime < this.config.notifications.summary_interval_minutes * 60 * 1000;
    });

    const newMatches = recentEvents.filter((e) => e.event.type === "new_match").length;
    const messagesSent = recentEvents.filter((e) => e.event.type === "message_sent").length;
    const messagesReceived = recentEvents.filter((e) => e.event.type === "message_received").length;
    const datesProposed = recentEvents.filter((e) => e.event.type === "date_proposed").length;
    const datesConfirmed = recentEvents.filter((e) => e.event.type === "date_confirmed").length;

    console.log("\n" + chalk.bold.underline("Activity Summary"));
    console.log(chalk.magenta(`  New matches:      ${newMatches}`));
    console.log(chalk.blue(`  Messages sent:    ${messagesSent}`));
    console.log(chalk.green(`  Messages received: ${messagesReceived}`));
    console.log(chalk.yellow(`  Dates proposed:   ${datesProposed}`));
    console.log(chalk.green(`  Dates confirmed:  ${datesConfirmed}`));
    console.log("");
  }

  private print(tag: string, message: string): void {
    const time = new Date().toLocaleTimeString();
    console.log(`${chalk.gray(time)} [${tag}] ${message}`);
  }

  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 3) + "...";
  }
}
