import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto.ts";

describe("token encryption", () => {
  it("round-trips", () => expect(decrypt(encrypt("EAAB-token"))).toBe("EAAB-token"));
  it("rejects tampering", () => {
    const [iv, tag, body] = encrypt("EAAB-token").split(".");
    expect(() => decrypt([iv, tag, body!.slice(0, -2) + "AA"].join("."))).toThrow();
  });
});
