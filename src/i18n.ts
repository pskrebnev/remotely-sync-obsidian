import Mustache from "mustache";
import { moment } from "obsidian";

import { LANGS } from "./langs";

export type LangType = keyof typeof LANGS;
export type LangTypeAndAuto = LangType | "auto";
export type TransItemType = keyof (typeof LANGS)["en"];

export class I18n {
  lang: LangTypeAndAuto;
  readonly saveSettingFunc: (tolang: LangTypeAndAuto) => Promise<void>;
  constructor(
    lang: LangTypeAndAuto,
    saveSettingFunc: (tolang: LangTypeAndAuto) => Promise<void>
  ) {
    this.lang = lang;
    this.saveSettingFunc = saveSettingFunc;
  }
  async changeTo(anotherLang: LangTypeAndAuto) {
    this.lang = anotherLang;
    await this.saveSettingFunc(anotherLang);
  }

  _get(key: TransItemType) {
    let realLang: LangType = "en";
    if (this.lang === "auto") {
      const locale = moment.locale().replace("-", "_");
      if (locale in LANGS) {
        realLang = locale as LangType;
      }
    } else if (this.lang in LANGS) {
      realLang = this.lang;
    }

    const res: string =
      (LANGS[realLang] as (typeof LANGS)["en"])[key] || LANGS["en"][key] || key;
    return res;
  }

  t(key: TransItemType, vars?: Record<string, string>) {
    if (vars === undefined) {
      return this._get(key);
    }
    return Mustache.render(this._get(key), vars);
  }
}
