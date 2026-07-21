import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  stripSecrets,
  rateLimitAccess,
  lookupReferral,
  parseClientReferenceId,
  saveDraft,
  getDraft,
  linkSessionToDraft,
  getDraftBySession,
} from "../src/portal.js";

function fakeKvEnv() {
  const store = new Map();
  return {
    PORTAL_KV: {
      async get(key, opts) {
        if (!store.has(key)) return null;
        const raw = store.get(key);
        return opts?.type === "json" ? JSON.parse(raw) : raw;
      },
      async put(key, value) {
        store.set(key, typeof value === "string" ? value : JSON.stringify(value));
      },
    },
  };
}

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

describe("parseClientReferenceId", () => {
  it("separa ref y draftId cuando vienen combinados", () => {
    assert.deepEqual(parseClientReferenceId("r.ABC123_d.uuid-1"), { ref: "ABC123", draftId: "uuid-1" });
  });
  it("acepta solo uno de los dos", () => {
    assert.deepEqual(parseClientReferenceId("d.uuid-1"), { ref: null, draftId: "uuid-1" });
    assert.deepEqual(parseClientReferenceId("r.ABC123"), { ref: "ABC123", draftId: null });
  });
  it("sigue leyendo codigos de referido viejos (sin prefijo)", () => {
    assert.deepEqual(parseClientReferenceId("RCR7K2A"), { ref: "RCR7K2A", draftId: null });
  });
  it("vacio o basura no truena", () => {
    assert.deepEqual(parseClientReferenceId(""), { ref: null, draftId: null });
    assert.deepEqual(parseClientReferenceId(null), { ref: null, draftId: null });
    assert.deepEqual(parseClientReferenceId("no-es-nada-valido!!"), { ref: null, draftId: null });
  });
});

describe("saveDraft / getDraft", () => {
  it("guarda y regresa el mismo borrador", async () => {
    const env = fakeKvEnv();
    const data = { business: { name: "Taquería La Bendita" }, links: [] };
    const draftId = await saveDraft(env, "cliente@correo.com", data);
    assert.ok(draftId);
    const draft = await getDraft(env, draftId);
    assert.equal(draft.email, "cliente@correo.com");
    assert.deepEqual(draft.data, data);
  });

  it("rechaza borradores demasiado grandes", async () => {
    const env = fakeKvEnv();
    const huge = { business: { name: "x".repeat(300000) } };
    await assert.rejects(() => saveDraft(env, "a@b.com", huge));
  });
});

describe("linkSessionToDraft / getDraftBySession", () => {
  it("encuentra el borrador a partir del session_id", async () => {
    const env = fakeKvEnv();
    const draftId = await saveDraft(env, "cliente@correo.com", { business: { name: "X" } });
    await linkSessionToDraft(env, "cs_test_123", draftId);
    const found = await getDraftBySession(env, "cs_test_123");
    assert.equal(found.draftId, draftId);
    assert.equal(found.email, "cliente@correo.com");
  });

  it("regresa null si no hay mapeo", async () => {
    const env = fakeKvEnv();
    assert.equal(await getDraftBySession(env, "cs_no_existe"), null);
  });
});
