import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { base64ToBytes, bytesToBase64 } from "./desktop-bytes.ts";

describe("desktop pdf bytes", () => {
  it("round-trips binary pdf bytes through standard base64", () => {
    const bytes = Uint8Array.from([0, 1, 255, 37, 80, 68, 70, 10, 128, 64]);
    const encoded = bytesToBase64(bytes);
    assert.equal(encoded, Buffer.from(bytes).toString("base64"));
    assert.deepEqual(base64ToBytes(encoded), bytes);
  });

  it("round-trips a buffer larger than one chunk", () => {
    const bytes = new Uint8Array(20_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  });
});
