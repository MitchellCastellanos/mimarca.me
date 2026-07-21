import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isValidEmail,
  isValidPassword,
  createAccount,
  verifyLogin,
  setPassword,
  createAccountSession,
  resolveAccountSession,
  destroyAccountSession,
  createResetToken,
  consumeResetToken,
  listOrdersForAccount,
} from "../src/account.js";

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
      async delete(key) {
        store.delete(key);
      },
    },
  };
}

describe("isValidEmail / isValidPassword", () => {
  it("valida formato de correo", () => {
    assert.equal(isValidEmail("a@b.com"), true);
    assert.equal(isValidEmail("no-es-correo"), false);
    assert.equal(isValidEmail(""), false);
  });
  it("exige minimo 8 caracteres", () => {
    assert.equal(isValidPassword("1234567"), false);
    assert.equal(isValidPassword("12345678"), true);
  });
});

describe("createAccount / verifyLogin", () => {
  it("crea la cuenta y valida el login con la contraseña correcta", async () => {
    const env = fakeKvEnv();
    const created = await createAccount(env, "Cliente@Correo.com", "password123");
    assert.equal(created.created, true);

    assert.equal(await verifyLogin(env, "cliente@correo.com", "password123"), true);
    assert.equal(await verifyLogin(env, "cliente@correo.com", "otra-cosa"), false);
    assert.equal(await verifyLogin(env, "no-existe@correo.com", "password123"), false);
  });

  it("no deja crear dos cuentas con el mismo correo", async () => {
    const env = fakeKvEnv();
    await createAccount(env, "a@b.com", "password123");
    const second = await createAccount(env, "a@b.com", "otra12345");
    assert.equal(second.created, false);
    // la contraseña original sigue siendo la valida
    assert.equal(await verifyLogin(env, "a@b.com", "password123"), true);
  });

  it("rechaza contraseñas débiles y correos invalidos", async () => {
    const env = fakeKvEnv();
    await assert.rejects(() => createAccount(env, "a@b.com", "corta"));
    await assert.rejects(() => createAccount(env, "no-es-correo", "password123"));
  });
});

describe("setPassword", () => {
  it("cambia la contraseña y la anterior deja de funcionar", async () => {
    const env = fakeKvEnv();
    await createAccount(env, "a@b.com", "password123");
    await setPassword(env, "a@b.com", "nueva12345");
    assert.equal(await verifyLogin(env, "a@b.com", "password123"), false);
    assert.equal(await verifyLogin(env, "a@b.com", "nueva12345"), true);
  });
});

describe("sesiones de cuenta", () => {
  it("crea, resuelve y destruye una sesión", async () => {
    const env = fakeKvEnv();
    const token = await createAccountSession(env, "Cliente@Correo.com");
    assert.equal(await resolveAccountSession(env, token), "cliente@correo.com");
    await destroyAccountSession(env, token);
    assert.equal(await resolveAccountSession(env, token), null);
  });

  it("token invalido no resuelve nada", async () => {
    const env = fakeKvEnv();
    assert.equal(await resolveAccountSession(env, "no-existe"), null);
  });
});

describe("tokens de reset", () => {
  it("son de un solo uso", async () => {
    const env = fakeKvEnv();
    const token = await createResetToken(env, "a@b.com");
    assert.equal(await consumeResetToken(env, token), "a@b.com");
    assert.equal(await consumeResetToken(env, token), null);
  });
});

describe("listOrdersForAccount", () => {
  it("regresa [] si no hay pedidos", async () => {
    const env = fakeKvEnv();
    assert.deepEqual(await listOrdersForAccount(env, "a@b.com"), []);
  });

  it("regresa lo que haya guardado el webhook", async () => {
    const env = fakeKvEnv();
    await env.PORTAL_KV.put("orders:a@b.com", JSON.stringify([{ sessionId: "cs_1", packageName: "Lanzamiento", slug: null }]));
    const orders = await listOrdersForAccount(env, "a@b.com");
    assert.equal(orders.length, 1);
    assert.equal(orders[0].packageName, "Lanzamiento");
  });
});
