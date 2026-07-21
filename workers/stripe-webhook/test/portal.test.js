import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  stripSecrets,
  rateLimitAccess,
  lookupReferral,
} from "../src/portal.js";

describe("stripSecrets", () => {
  it("removes owner fields", () => {
    const out = stripSecrets({
      slug: "lulu",
      ownerEmail: "a@b.c",
      ownerToken: "tok",
      referralCode: "ABC12",
      orderStage: "published",
    });
    assert.equal(out.slug, "lulu");
    assert.equal(out.orderStage, "published");
    assert.equal(out.ownerEmail, undefined);
    assert.equal(out.ownerToken, undefined);
    assert.equal(out.referralCode, undefined);
  });
});

describe("rateLimitAccess", () => {
  it("allows then blocks after limit", async () => {
    const store = new Map();
    const env = {
      PORTAL_KV: {
        async get(key) {
          return store.has(key) ? store.get(key) : null;
        },
        async put(key, value) {
          store.set(key, value);
        },
      },
    };
    assert.equal((await rateLimitAccess(env, "1.2.3.4", 2)).allowed, true);
    assert.equal((await rateLimitAccess(env, "1.2.3.4", 2)).allowed, true);
    assert.equal((await rateLimitAccess(env, "1.2.3.4", 2)).allowed, false);
  });
});

describe("lookupReferral", () => {
  it("normalizes code and reads KV", async () => {
    const env = {
      PORTAL_KV: {
        async get(key, opts) {
          assert.equal(key, "ref:RCR7K2A");
          return opts?.type === "json" ? { slug: "lulu" } : JSON.stringify({ slug: "lulu" });
        },
      },
    };
    const hit = await lookupReferral(env, "rcr7k2a");
    assert.equal(hit.slug, "lulu");
    assert.equal(await lookupReferral(env, "bad!"), null);
  });
});
