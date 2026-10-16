// Tests only: `require("obsidian")` (what tsx compiles imports to) gets the
// stub in ./obsidian-stub.ts. Every other module resolves as usual.
const Module = require("node:module");
const path = require("node:path");

const stub = path.join(__dirname, "obsidian-stub.ts");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "obsidian") {
    return stub;
  }
  return original.call(this, request, ...rest);
};
