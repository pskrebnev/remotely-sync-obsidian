/**
 * Minimal stand-in for the "obsidian" module, so code that imports it can
 * run under mocha. Only what the tested code paths need is implemented.
 * requestUrl follows Obsidian's documented contract:
 * body is a string or ArrayBuffer, and status >= 400 throws unless
 * `throw: false`.
 */

export const Platform = {
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isMacOS: true,
};

export const requireApiVersion = (_version: string) => true;

export interface RequestUrlParam {
  url: string;
  method?: string;
  contentType?: string;
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
  throw?: boolean;
}

export const requestLog: { method: string; url: string; bodyType: string }[] =
  [];
// tests read it from here (they only import this module as "obsidian")
(globalThis as any).__obsidianStubRequestLog = requestLog;

export async function requestUrl(param: RequestUrlParam) {
  const body = param.body;
  const bodyType =
    body === undefined
      ? "undefined"
      : typeof body === "string"
        ? "string"
        : body instanceof ArrayBuffer
          ? "ArrayBuffer"
          : Object.prototype.toString.call(body);
  requestLog.push({
    method: param.method ?? "GET",
    url: param.url,
    bodyType,
  });
  if (
    bodyType !== "undefined" &&
    bodyType !== "string" &&
    bodyType !== "ArrayBuffer"
  ) {
    throw Error(`requestUrl: unsupported body type ${bodyType}`);
  }
  const headers: Record<string, string> = { ...(param.headers ?? {}) };
  if (param.contentType !== undefined) {
    headers["content-type"] = param.contentType;
  }
  const rsp = await fetch(param.url, {
    method: param.method ?? "GET",
    headers,
    body: body as any,
  });
  const arrayBuffer = await rsp.arrayBuffer();
  if (rsp.status >= 400 && param.throw !== false) {
    const err: any = new Error(`Request failed, status ${rsp.status}`);
    err.status = rsp.status;
    throw err;
  }
  const respHeaders: Record<string, string> = {};
  rsp.headers.forEach((v, k) => {
    respHeaders[k] = v;
  });
  return {
    status: rsp.status,
    headers: respHeaders,
    arrayBuffer,
    get text() {
      return new TextDecoder().decode(arrayBuffer);
    },
  };
}

export const request = async (param: RequestUrlParam) =>
  (await requestUrl(param)).text;

export class Notice {
  constructor(public message: unknown) {}
}
export class Modal {}
export class Setting {}
export class TFile {}
export class TFolder {}
export class Vault {}
export class Events {}
export const moment = { locale: () => "en" };
