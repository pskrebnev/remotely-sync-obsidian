import * as http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A tiny in-memory S3-compatible server (path-style, no auth checks)
 * for testing the S3 client end to end. `mode` simulates failures.
 */
export type FakeS3Mode = "ok" | "forbidden" | "hang";

export const startFakeS3 = async (bucket: string) => {
  const objects = new Map<string, Buffer>();
  const state = { mode: "ok" as FakeS3Mode, requests: [] as string[] };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      state.requests.push(`${req.method} ${url.pathname}${url.search}`);
      if (state.mode === "hang") {
        return; // never answer
      }
      if (state.mode === "forbidden") {
        res.writeHead(403, { "content-type": "application/xml" });
        res.end(
          "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>"
        );
        return;
      }
      const parts = url.pathname.split("/").filter((x) => x !== "");
      if (parts[0] !== bucket) {
        res.writeHead(404, { "content-type": "application/xml" });
        res.end(
          "<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>"
        );
        return;
      }
      const key =
        decodeURIComponent(parts.slice(1).join("/")) +
        (url.pathname.endsWith("/") && parts.length > 1 ? "/" : "");
      if (req.method === "GET" && key === "") {
        const prefix = url.searchParams.get("prefix") ?? "";
        const contents = [...objects.keys()]
          .filter((k) => k.startsWith(prefix))
          .map(
            (k) =>
              `<Contents><Key>${k}</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>"x"</ETag><Size>${objects.get(k)!.length}</Size></Contents>`
          )
          .join("");
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><KeyCount>${objects.size}</KeyCount><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`
        );
        return;
      }
      if (req.method === "PUT") {
        objects.set(key, Buffer.concat(chunks));
        res.writeHead(200, { etag: '"x"' });
        res.end();
        return;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        const body = objects.get(key);
        if (body === undefined) {
          res.writeHead(404, { "content-type": "application/xml" });
          res.end("<Error><Code>NoSuchKey</Code></Error>");
          return;
        }
        res.writeHead(200, {
          "content-length": `${body.length}`,
          "last-modified": "Thu, 01 Jan 2026 00:00:00 GMT",
          etag: '"x"',
        });
        res.end(req.method === "GET" ? body : undefined);
        return;
      }
      if (req.method === "DELETE") {
        objects.delete(key);
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(400);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    state,
    objects,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
};
