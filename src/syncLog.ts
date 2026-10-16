/**
 * A plain-text log of syncs and connectivity checks, kept in the plugin's
 * folder (.obsidian/plugins/<id>/sync-log.txt). It is never synced: the
 * config-folder lister only takes main.js, manifest.json, styles.css,
 * .gitignore and (never) data.json from this plugin's folder.
 *
 * Entries contain outcomes, counts, error messages and the names of
 * skipped remote objects. Error text is sanitized: URL query strings and
 * secret-looking key=value pairs are removed. Vault file names are not
 * logged.
 */

export const SYNC_LOG_FILE_NAME = "sync-log.txt";
export const MAX_SYNC_LOG_LINES = 1000;

export type SyncLogOutcome = "ok" | "failed" | "info";

export interface SyncLogEntry {
  time: Date;
  event: string;
  outcome: SyncLogOutcome;
  details?: string[];
}

const SECRET_PAIR =
  /\b(authorization|x-amz-security-token|x-amz-signature|x-amz-credential|signature|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret(?:[_-]?access[_-]?key)?|password|passphrase|token|code)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;]+)/gi;

export const sanitizeLogText = (text: string): string =>
  text
    // query strings can carry signatures and tokens
    .replace(/(https?:\/\/[^\s?#"'<>]+)\?[^\s"'<>]*/g, "$1?<query removed>")
    .replace(SECRET_PAIR, "$1$2<redacted>")
    // AWS-style access key ids
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "<access key id>");

const pad = (n: number) => `${n}`.padStart(2, "0");
export const formatLogTime = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export const formatSyncLogEntry = (e: SyncLogEntry): string[] => {
  const lines = [
    `${formatLogTime(e.time)} [${e.outcome.toUpperCase()}] ${sanitizeLogText(e.event)}`,
  ];
  for (const d of e.details ?? []) {
    for (const line of sanitizeLogText(d).split(/\r?\n/)) {
      if (line.trim() !== "") {
        lines.push(`    ${line}`);
      }
    }
  }
  return lines;
};

/**
 * Appends lines and keeps only the newest `maxLines`.
 */
export const appendLogLines = (
  existing: string,
  lines: string[],
  maxLines: number = MAX_SYNC_LOG_LINES
): string => {
  const all = existing
    .split("\n")
    .filter((l) => l !== "")
    .concat(lines);
  return `${all.slice(Math.max(0, all.length - maxLines)).join("\n")}\n`;
};
