/**
 * "Check Connectivity" must always end with a visible result.
 * Creating the client can throw (e.g. an http:// endpoint is refused),
 * the check can report an error object instead of text, or a request can
 * hang; all of these used to end silently.
 */

export const CONNECTIVITY_CHECK_TIMEOUT_MS = 30 * 1000;

interface CheckableClient {
  checkConnect(callbackFunc?: (err: unknown) => void): Promise<boolean>;
}

export type ConnectivityResult = { ok: true } | { ok: false; message: string };

/**
 * Readable text for anything thrown or reported as an error.
 */
export const errorToMessage = (e: unknown): string => {
  if (e === undefined || e === null) {
    return "unknown error";
  }
  if (typeof e === "string") {
    return e === "" ? "unknown error" : e;
  }
  const errors = (e as any).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    // AggregateError: the parts carry the useful messages
    return errors.map((x) => errorToMessage(x)).join("\n");
  }
  if (e instanceof Error) {
    return e.message !== "" ? e.message : e.name;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
};

export const runConnectivityCheck = async (
  createClient: () => CheckableClient,
  timeoutMs: number = CONNECTIVITY_CHECK_TIMEOUT_MS
): Promise<ConnectivityResult> => {
  let client: CheckableClient;
  try {
    client = createClient();
  } catch (e) {
    return { ok: false, message: errorToMessage(e) };
  }

  const check = (async (): Promise<ConnectivityResult> => {
    let reported: unknown = undefined;
    try {
      const ok = await client.checkConnect((err) => {
        reported = err;
      });
      if (ok) {
        return { ok: true };
      }
      return {
        ok: false,
        message: errorToMessage(reported ?? "the check failed"),
      };
    } catch (e) {
      return { ok: false, message: errorToMessage(e) };
    }
  })();

  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  const timeout = new Promise<ConnectivityResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        ok: false,
        message: `No answer within ${Math.round(timeoutMs / 1000)} seconds. Check the address (endpoint) and your network connection.`,
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([check, timeout]);
  } finally {
    clearTimeout(timer);
  }
};
