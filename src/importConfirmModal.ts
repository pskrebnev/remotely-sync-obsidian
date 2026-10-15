import { type App, Modal, Setting } from "obsidian";
import type { TransItemType } from "./i18n";
import type { ImportChange } from "./importValidate";
import type CloudSyncPlugin from "./main";
import { wrapTextWithPasswordHide } from "./settings";

/**
 * Shows every setting an import would change, before anything is saved.
 */
export class ImportSettingsConfirmModal extends Modal {
  readonly plugin: CloudSyncPlugin;
  readonly changes: ImportChange[];
  readonly ignoredKeys: string[];
  readonly onConfirm: () => Promise<void>;
  constructor(
    app: App,
    plugin: CloudSyncPlugin,
    changes: ImportChange[],
    ignoredKeys: string[],
    onConfirm: () => Promise<void>
  ) {
    super(app);
    this.plugin = plugin;
    this.changes = changes;
    this.ignoredKeys = ignoredKeys;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    const t = (x: TransItemType, vars?: any) => {
      return this.plugin.i18n.t(x, vars);
    };

    contentEl.createEl("h2", { text: t("modal_importconfirm_title") });
    contentEl.createEl("p", { text: t("modal_importconfirm_warning") });

    const list = contentEl.createEl("ul");
    for (const c of this.changes) {
      const li = list.createEl("li");
      if (c.risky) {
        li.createEl("strong", { text: `⚠ ${c.path}` });
      } else {
        li.createEl("span", { text: c.path });
      }
      li.createEl("span", { text: `: ${c.before} → ${c.after}` });
    }

    if (this.ignoredKeys.length > 0) {
      contentEl.createEl("p", {
        text: t("modal_importconfirm_ignored", {
          keys: this.ignoredKeys.join(", "),
        }),
      });
    }

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText(t("modal_importconfirm_apply"));
        button.setWarning();
        button.onClick(async () => {
          this.close();
          await this.onConfirm();
        });
      })
      .addButton((button) => {
        button.setButtonText(t("cancel"));
        button.onClick(() => {
          this.close();
        });
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Asks for the passphrase of an encrypted settings export.
 */
export class ImportPassphraseModal extends Modal {
  readonly plugin: CloudSyncPlugin;
  readonly onSubmit: (passphrase: string) => Promise<void>;
  constructor(
    app: App,
    plugin: CloudSyncPlugin,
    onSubmit: (passphrase: string) => Promise<void>
  ) {
    super(app);
    this.plugin = plugin;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    const t = (x: TransItemType, vars?: any) => {
      return this.plugin.i18n.t(x, vars);
    };

    contentEl.createEl("h2", { text: t("modal_importpassphrase_title") });
    contentEl.createEl("p", { text: t("modal_importpassphrase_desc") });

    let passphrase = "";
    new Setting(contentEl)
      .addText((text) => {
        wrapTextWithPasswordHide(text);
        text.onChange((val) => {
          passphrase = val;
        });
      })
      .addButton((button) => {
        button.setButtonText(t("modal_importpassphrase_decrypt"));
        button.setCta();
        button.onClick(async () => {
          this.close();
          await this.onSubmit(passphrase);
        });
      })
      .addButton((button) => {
        button.setButtonText(t("cancel"));
        button.onClick(() => {
          this.close();
        });
      });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
