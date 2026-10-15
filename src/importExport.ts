import cloneDeep from "lodash/cloneDeep";
import QRCode from "qrcode";

import {
  COMMAND_URI,
  type CloudSyncPluginSettings,
  type QRExportType,
  type UriParams,
} from "./baseTypes";
import { encryptExportPayload } from "./exportCrypto";

import { getShrinkedSettings as getShrinkedSettingsOnedrive } from "./fsOnedrive";

// value of the `enc` parameter in encrypted export links
export const EXPORT_ENCRYPTION_VERSION = "1";

/**
 * The exported settings contain credentials, so they are always
 * encrypted with `passphrase` (see exportCrypto.ts).
 */
export const exportQrCodeUri = async (
  settings: CloudSyncPluginSettings,
  currentVaultName: string,
  pluginVersion: string,
  exportFields: QRExportType,
  passphrase: string
) => {
  let settings2: Partial<CloudSyncPluginSettings> = {};

  if (exportFields === "basic_and_advanced") {
    settings2 = cloneDeep(settings);
    delete settings2.s3;
    delete settings2.dropbox;
    delete settings2.onedrive;
    delete settings2.webdav;
    delete settings2.webdis;
  } else if (exportFields === "s3") {
    settings2 = { s3: cloneDeep(settings.s3) };
  } else if (exportFields === "dropbox") {
    settings2 = { dropbox: cloneDeep(settings.dropbox) };
  } else if (exportFields === "onedrive") {
    settings2 = { onedrive: getShrinkedSettingsOnedrive(settings.onedrive) };
  } else if (exportFields === "webdav") {
    settings2 = { webdav: cloneDeep(settings.webdav) };
  } else if (exportFields === "webdis") {
    settings2 = { webdis: cloneDeep(settings.webdis) };
  }

  delete settings2.vaultRandomID;
  // device-local, never travels
  delete settings2.secretStorageNamespace;
  delete settings2.encryptionMigration;
  const data = encodeURIComponent(
    await encryptExportPayload(JSON.stringify(settings2), passphrase)
  );
  const vault = encodeURIComponent(currentVaultName);
  const version = encodeURIComponent(pluginVersion);
  const rawUri = `obsidian://${COMMAND_URI}?func=settings&version=${version}&vault=${vault}&enc=${EXPORT_ENCRYPTION_VERSION}&data=${data}`;
  // console.info(uri)
  const imgUri = await QRCode.toDataURL(rawUri);
  return {
    rawUri,
    imgUri,
  };
};

export interface ProcessQrCodeResultType {
  status: "error" | "ok";
  message: string;
  result?: CloudSyncPluginSettings;
}

/**
 * we also support directly parse the uri, instead of relying on web browser
 * @param input
 */
export const parseUriByHand = (input: string) => {
  if (!input.startsWith("obsidian://cloud-sync?func=settings&")) {
    throw Error(`not valid string`);
  }

  const k = new URL(input);
  const output = Object.fromEntries(k.searchParams);
  return output;
};

export const importQrCodeUri = (
  inputParams: any,
  currentVaultName: string
): ProcessQrCodeResultType => {
  const params = inputParams as UriParams;
  if (
    params.func === undefined ||
    params.func !== "settings" ||
    params.vault === undefined ||
    params.data === undefined
  ) {
    return {
      status: "error",
      message: "the uri is not for exporting/importing settings",
    };
  }

  if (params.vault !== currentVaultName) {
    return {
      status: "error",
      message: `the target vault is ${params.vault} but you are currently in ${currentVaultName}`,
    };
  }

  let settings = {} as CloudSyncPluginSettings;
  try {
    settings = JSON.parse(params.data);
  } catch (e) {
    return {
      status: "error",
      message: "errors while parsing settings",
    };
  }
  return {
    status: "ok",
    message: "ok",
    result: settings,
  };
};
