/**
 * Cuentas de cliente (email + password) — capa aparte del token por
 * tarjeta (secrets:<slug>) que ya existe en portal.js. Una cuenta es el
 * "login de verdad" que agrupa los pedidos de un mismo correo (ver
 * orders:<email>, ya sembrado por el webhook desde la Fase A) para el
 * Dashboard de mi-cuenta/cuenta.html.
 *
 * Hash con PBKDF2-SHA256 (nativo en Web Crypto, sin dependencias — bcrypt
 * no corre en el runtime de Workers sin WASM). Las sesiones son un token
 * opaco en KV, no cookies — el sitio es estático en otro origin que el
 * Worker, así que el cliente lo manda como cualquier otro token (ver
 * ownerToken) en vez de depender de Set-Cookie entre dominios.
 */

const PBKDF2_ITERATIONS = 100000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSaltHex() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

async function derivePasswordHash(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(saltHex), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return toHex(bits);
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidEmail(email) {
  return EMAIL_RE.test(normalizeEmail(email));
}

export function isValidPassword(password) {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

export async function getAccount(env, email) {
  if (!env.PORTAL_KV) return null;
  return env.PORTAL_KV.get(`account:${normalizeEmail(email)}`, { type: "json" });
}

/** { created: false } si ya existía una cuenta con ese correo (no se toca). */
export async function createAccount(env, email, password) {
  if (!env.PORTAL_KV) throw new Error("accounts not configured");
  if (!isValidEmail(email)) throw new Error("invalid email");
  if (!isValidPassword(password)) throw new Error("weak password");

  const normalized = normalizeEmail(email);
  if (await getAccount(env, normalized)) return { created: false };

  const passwordSalt = randomSaltHex();
  const passwordHash = await derivePasswordHash(password, passwordSalt);
  await env.PORTAL_KV.put(
    `account:${normalized}`,
    JSON.stringify({ passwordHash, passwordSalt, createdAt: Date.now() })
  );
  return { created: true };
}

export async function verifyLogin(env, email, password) {
  const account = await getAccount(env, email);
  if (!account) return false;
  const hash = await derivePasswordHash(password, account.passwordSalt);
  return timingSafeEqualHex(hash, account.passwordHash);
}

/**
 * No invalida sesiones existentes (limitación conocida — ver README):
 * suficiente para el volumen actual, pero un token robado sobrevive a un
 * reset de password.
 */
export async function setPassword(env, email, newPassword) {
  if (!env.PORTAL_KV) throw new Error("accounts not configured");
  if (!isValidPassword(newPassword)) throw new Error("weak password");

  const normalized = normalizeEmail(email);
  const passwordSalt = randomSaltHex();
  const passwordHash = await derivePasswordHash(newPassword, passwordSalt);
  const prev = await getAccount(env, normalized);
  await env.PORTAL_KV.put(
    `account:${normalized}`,
    JSON.stringify({
      passwordHash,
      passwordSalt,
      createdAt: prev?.createdAt || Date.now(),
      updatedAt: Date.now(),
    })
  );
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 dias

export async function createAccountSession(env, email) {
  const token = crypto.randomUUID();
  await env.PORTAL_KV.put(`account-session:${token}`, normalizeEmail(email), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

/** Correo dueño de la sesión, o null si el token no existe/expiró. */
export async function resolveAccountSession(env, token) {
  if (!env.PORTAL_KV || !token) return null;
  return env.PORTAL_KV.get(`account-session:${token}`);
}

export async function destroyAccountSession(env, token) {
  if (!env.PORTAL_KV || !token) return;
  await env.PORTAL_KV.delete(`account-session:${token}`);
}

const RESET_TTL_SECONDS = 60 * 60; // 1 hora, un solo uso

export async function createResetToken(env, email) {
  const token = crypto.randomUUID();
  await env.PORTAL_KV.put(`account-reset:${token}`, normalizeEmail(email), {
    expirationTtl: RESET_TTL_SECONDS,
  });
  return token;
}

/** Consume el token (un solo uso): regresa el correo, o null si ya se usó/venció. */
export async function consumeResetToken(env, token) {
  if (!env.PORTAL_KV || !token) return null;
  const email = await env.PORTAL_KV.get(`account-reset:${token}`);
  if (!email) return null;
  await env.PORTAL_KV.delete(`account-reset:${token}`);
  return email;
}

export async function listOrdersForAccount(env, email) {
  if (!env.PORTAL_KV) return [];
  const orders = await env.PORTAL_KV.get(`orders:${normalizeEmail(email)}`, { type: "json" });
  return orders || [];
}
