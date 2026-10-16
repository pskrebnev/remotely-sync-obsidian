// Tests only: `require("obsidian")` (what tsx compiles imports to) gets the
// stub in ./obsidian-stub.ts. Every other module resolves as usual.
const Module = require("node:module");
const path = require("node:path");

const stub = path.join(__dirname, "obsidian-stub.ts");
// encryptRClone.ts imports its web worker (bundled by worker-loader);
// tests that don't use rclone only need the import to succeed
const workerStub = path.join(__dirname, "worker-stub.ts");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "obsidian") {
    return stub;
  }
  if (request.endsWith("/encryptRClone.worker")) {
    return workerStub;
  }
  return original.call(this, request, ...rest);
};
