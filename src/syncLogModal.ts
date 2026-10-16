import { type App, Modal, Notice, Setting } from "obsidian";
import type { TransItemType } from "./i18n";
import type SyncItSimplyStupidPlugin from "./main";

/**
 * Shows the newest part of the sync log (see syncLog.ts).
 */
export class SyncLogModal extends Modal {
  readonly plugin: SyncItSimplyStupidPlugin;
  constructor(app: App, plugin: SyncItSimplyStupidPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { contentEl } = this;
    const t = (x: TransItemType, vars?: any) => {
      return this.plugin.i18n.t(x, vars);
    };

    contentEl.createEl("h2", { text: t("modal_synclog_title") });
    contentEl.createEl("p", {
      text: t("modal_synclog_desc", { path: this.plugin.getSyncLogPath() }),
    });

    const log = await this.plugin.readSyncLog();
    const lines = log.split("\n").filter((l) => l !== "");
    const newestFirst = lines.slice(-200).reverse().join("\n");
    const pre = contentEl.createEl("pre", {
      text: newestFirst === "" ? t("modal_synclog_empty") : newestFirst,
    });
    pre.style.maxHeight = "50vh";
    pre.style.overflow = "auto";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.userSelect = "text";

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText(t("modal_synclog_copy"));
        button.onClick(async () => {
          await navigator.clipboard.writeText(log);
          new Notice(t("modal_synclog_copied"));
        });
      })
      .addButton((button) => {
        button.setButtonText(t("goback"));
        button.onClick(() => this.close());
      });
  }

  onClose() {
    this.contentEl.empty();
  }
}
