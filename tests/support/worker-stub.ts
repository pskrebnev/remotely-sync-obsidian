// Tests only: stands in for the rclone web worker (see
// register-obsidian-stub.cjs). Creating it is an error, so a test that
// accidentally uses rclone fails loudly.
export default class WorkerStub {
  constructor() {
    throw Error("the rclone web worker is not available in tests");
  }
}
