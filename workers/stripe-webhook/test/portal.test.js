import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  stripSecrets,
  rateLimitAccess,
  lookupReferral,
  parseClientReferenceId,
  saveDraft,
  getDraft,
  updateDraft,
  linkSessionToDraft,
  getDraftBySession,
  resolveLinksQuota,
  validateLinks,
  getLinks,
  setLinks,
  resolveServicesQuota,
  validateServices,
  getServices,
  setServices,
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
    const huge = { businessName: "x".repeat(600000) };
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

describe("updateDraft", () => {
  it("edita el data conservando email y createdAt", async () => {
    const env = fakeKvEnv();
    const draftId = await saveDraft(env, "cliente@correo.com", { businessName: "Antes" });
    const before = await getDraft(env, draftId);

    const updated = await updateDraft(env, draftId, { businessName: "Después" });
    assert.equal(updated.email, "cliente@correo.com");
    assert.equal(updated.data.businessName, "Después");

    const after = await getDraft(env, draftId);
    assert.equal(after.email, before.email);
    assert.equal(after.createdAt, before.createdAt);
    assert.equal(after.data.businessName, "Después");
  });

  it("regresa null si el borrador no existe", async () => {
    const env = fakeKvEnv();
    assert.equal(await updateDraft(env, "no-existe", { x: 1 }), null);
  });

  it("rechaza datos demasiado grandes", async () => {
    const env = fakeKvEnv();
    const draftId = await saveDraft(env, "a@b.com", { businessName: "X" });
    await assert.rejects(() => updateDraft(env, draftId, { businessName: "x".repeat(600000) }));
  });
});

describe("resolveLinksQuota", () => {
  it("usa el cupo del paquete conocido", () => {
    assert.equal(resolveLinksQuota("lanzamiento"), 3);
    assert.equal(resolveLinksQuota("personalizado"), 6);
    assert.equal(resolveLinksQuota("premium"), 12);
  });

  it("no distingue mayúsculas", () => {
    assert.equal(resolveLinksQuota("Premium"), 12);
  });

  it("cliente viejo sin paquete no pierde links que ya tenía", () => {
    assert.equal(resolveLinksQuota("", 9), 9);
    assert.equal(resolveLinksQuota(undefined, 2), 6); // default (personalizado) si trae menos
  });
});

describe("validateLinks", () => {
  it("acepta links válidos dentro del cupo", () => {
    const out = validateLinks(
      [{ label: "Instagram", url: "https://instagram.com/x" }, { label: "WhatsApp", url: "https://wa.me/521234567890" }],
      3
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].label, "Instagram");
    assert.equal(out[0].icon, "link-45deg"); // default
  });

  it("rechaza si se pasa del cupo", () => {
    assert.throws(() => validateLinks([{ label: "A", url: "https://a.com" }, { label: "B", url: "https://b.com" }], 1));
  });

  it("rechaza links sin nombre o con URL inválida", () => {
    assert.throws(() => validateLinks([{ label: "", url: "https://a.com" }], 5));
    assert.throws(() => validateLinks([{ label: "A", url: "javascript:alert(1)" }], 5));
  });

  it("rechaza si no es un arreglo", () => {
    assert.throws(() => validateLinks("no-es-arreglo", 5));
  });
});

describe("getLinks / setLinks", () => {
  it("guarda y regresa el override de links", async () => {
    const env = fakeKvEnv();
    assert.equal(await getLinks(env, "lulu"), null);
    await setLinks(env, "lulu", [{ label: "IG", url: "https://instagram.com/lulu" }]);
    const record = await getLinks(env, "lulu");
    assert.equal(record.links.length, 1);
    assert.equal(record.links[0].label, "IG");
  });
});

describe("resolveServicesQuota", () => {
  it("usa el cupo del paquete conocido", () => {
    assert.equal(resolveServicesQuota("premium"), 20);
    assert.equal(resolveServicesQuota("personalizado"), 8);
    assert.equal(resolveServicesQuota("lanzamiento"), 0);
  });
});

describe("validateServices", () => {
  it("acepta servicios con precio numérico o string", () => {
    const out = validateServices(
      [
        { name: "Fade", description: "Degradado", price: 180 },
        { name: "Barba", desc: "Perfilado", price: "$110" },
      ],
      8
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].price, 180);
    assert.equal(out[1].price, 110);
    assert.equal(out[1].description, "Perfilado");
  });

  it("rechaza si se pasa del cupo o el paquete no incluye precios", () => {
    assert.throws(() => validateServices([{ name: "A", price: 1 }], 0));
    assert.throws(() => validateServices([{ name: "A", price: 1 }, { name: "B", price: 2 }], 1));
  });

  it("rechaza servicios sin nombre", () => {
    assert.throws(() => validateServices([{ name: "", price: 10 }], 5));
  });
});

describe("getServices / setServices", () => {
  it("guarda y regresa el override de servicios", async () => {
    const env = fakeKvEnv();
    assert.equal(await getServices(env, "rcr-barbershop"), null);
    await setServices(env, "rcr-barbershop", [{ id: "fade", name: "Fade", price: 180, order: 0, active: true }]);
    const record = await getServices(env, "rcr-barbershop");
    assert.equal(record.services.length, 1);
    assert.equal(record.services[0].name, "Fade");
  });
});
