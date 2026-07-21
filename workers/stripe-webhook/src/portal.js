/**
 * Helpers del portal: secretos en KV, rate-limit y referidos.
 * La tarjeta pública en Pages ya no debe incluir ownerEmail/ownerToken.
 */

const SECRET_FIELDS = ["ownerEmail", "ownerToken", "referralCode"];

export function stripSecrets(data) {
  if (!data || typeof data !== "object") return data;
  const out = { ...data };
  for (const key of SECRET_FIELDS) delete out[key];
  return out;
}

export async function getSecrets(env, slug) {
  if (!env.PORTAL_KV || !slug) return null;
  try {
    return await env.PORTAL_KV.get(`secrets:${slug}`, { type: "json" });
  } catch {
    return null;
  }
}

/** Une JSON público + secretos KV (con fallback a campos legacy en el JSON). */
export async function resolveClient(env, slug, publicData) {
  if (!publicData) return null;
  const secrets = (await getSecrets(env, slug)) || {};
  return {
    ...stripSecrets(publicData),
    ownerEmail: secrets.ownerEmail || publicData.ownerEmail || "",
    ownerToken: secrets.ownerToken || publicData.ownerToken || "",
    referralCode: secrets.referralCode || publicData.referralCode || "",
  };
}

/** Contador genérico por bucket (ip, correo, lo que sea) con ventana fija. */
export async function rateLimitBucket(env, key, limit, windowSeconds) {
  if (!env.PORTAL_KV || !key) return { allowed: true };
  const raw = await env.PORTAL_KV.get(key);
  const count = Number(raw || 0);
  if (count >= limit) return { allowed: false, count };
  await env.PORTAL_KV.put(key, String(count + 1), { expirationTtl: windowSeconds });
  return { allowed: true, count: count + 1 };
}

export async function rateLimitAccess(env, ip, limit = 5, windowSeconds = 3600) {
  if (!ip) return { allowed: true };
  return rateLimitBucket(env, `rl:access:${ip}`, limit, windowSeconds);
}

export async function lookupReferral(env, code) {
  if (!env.PORTAL_KV || !code) return null;
  const normalized = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(normalized)) return null;
  return env.PORTAL_KV.get(`ref:${normalized}`, { type: "json" });
}

export const REFERRAL_DISCOUNT_PERCENT = 10;
export const REFERRAL_REWARD_PERCENT = 10;
export const REFERRAL_REWARD_TTL_MS = 1000 * 60 * 60 * 24 * 365; // 12 meses
export const REFERRAL_CREDIT_MAX_PERCENT = 50;

function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, 1)}***@${domain}`;
}

/** Normaliza una fila de reward (incluye registros viejos sin expiresAt/rewardAmount). */
export function normalizeRewardRow(row, now = Date.now()) {
  const createdAt = Number(row?.createdAt || row?.at || 0);
  const amountPaid = Number(row?.amountPaid || 0);
  const rewardAmount = row?.rewardAmount != null
    ? Number(row.rewardAmount)
    : Math.round(amountPaid * REFERRAL_REWARD_PERCENT / 100);
  const expiresAt = Number(row?.expiresAt || (createdAt ? createdAt + REFERRAL_REWARD_TTL_MS : 0));
  const expired = Boolean(expiresAt && expiresAt <= now);
  const buyerName = String(row?.buyerName || "").trim();
  return {
    at: createdAt || Number(row?.at || 0),
    createdAt,
    expiresAt,
    buyerName: buyerName || undefined,
    buyerEmailMasked: maskEmail(row?.buyerEmail),
    amountPaid,
    rewardAmount,
    discountAmount: Number(row?.discountAmount || 0),
    currency: String(row?.currency || "mxn").toLowerCase(),
    status: expired ? "expired" : (row?.status || "confirmed"),
    expired,
    sessionId: row?.sessionId || null,
  };
}

export function displayReferralName(row) {
  if (row?.buyerName) return row.buyerName;
  if (row?.buyerEmailMasked) return row.buyerEmailMasked;
  return "Nuevo cliente";
}

/** Saldo disponible = rewards activos − consumos. Nunca negativo. */
export async function getReferralCreditBalance(env, slug, now = Date.now()) {
  const rows = env.PORTAL_KV
    ? ((await env.PORTAL_KV.get(`redeems:${slug}`, { type: "json" })) || [])
    : [];
  const earned = rows
    .map((row) => normalizeRewardRow(row, now))
    .filter((row) => !row.expired)
    .reduce((sum, row) => sum + row.rewardAmount, 0);
  const consumptions = env.PORTAL_KV
    ? ((await env.PORTAL_KV.get(`credit-consumptions:${slug}`, { type: "json" })) || [])
    : [];
  const consumed = consumptions.reduce((sum, row) => sum + Number(row.amountCents || 0), 0);
  return Math.max(0, earned - consumed);
}

/** Resumen privado para el panel del referidor. Montos en la unidad mínima de la moneda. */
export async function getReferralSummary(env, slug, now = Date.now()) {
  const rows = env.PORTAL_KV
    ? ((await env.PORTAL_KV.get(`redeems:${slug}`, { type: "json" })) || [])
    : [];
  const referrals = rows.map((row) => {
    const normalized = normalizeRewardRow(row, now);
    return {
      at: normalized.at,
      createdAt: normalized.createdAt,
      expiresAt: normalized.expiresAt,
      // Nombre si existe; si no, email enmascarado. Nunca el email completo.
      buyerName: displayReferralName(normalized),
      buyerEmailMasked: normalized.buyerEmailMasked,
      amountPaid: normalized.amountPaid,
      rewardAmount: normalized.rewardAmount,
      currency: normalized.currency,
      status: normalized.status,
    };
  });
  const active = referrals.filter((row) => row.status !== "expired");
  const balance = await getReferralCreditBalance(env, slug, now);
  return {
    count: referrals.length,
    activeCount: active.length,
    rewardAmount: balance,
    currency: referrals[0]?.currency || "mxn",
    referrals: referrals.slice(-20).reverse(),
    rewardPercent: REFERRAL_REWARD_PERCENT,
    creditMaxPercent: REFERRAL_CREDIT_MAX_PERCENT,
    expiresInMonths: 12,
  };
}

/**
 * Consume crédito de referido (solo backend/admin). Idempotente.
 * - Nunca deja saldo negativo.
 * - Máximo REFERRAL_CREDIT_MAX_PERCENT del valor de la compra.
 * - Registra auditoría en KV.
 */
export async function consumeReferralCredit(env, {
  slug,
  amountCents,
  purchaseAmountCents,
  idempotencyKey,
  note = "",
  now = Date.now(),
} = {}) {
  if (!env.PORTAL_KV || !slug) throw new Error("missing slug");
  const amount = Math.floor(Number(amountCents));
  const purchase = Math.floor(Number(purchaseAmountCents));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amountCents inválido");
  if (!Number.isFinite(purchase) || purchase <= 0) throw new Error("purchaseAmountCents inválido");

  const key = String(idempotencyKey || "").trim();
  if (!key || key.length > 120) throw new Error("idempotencyKey requerido");

  const existingKey = `credit-consume:${key}`;
  const existing = await env.PORTAL_KV.get(existingKey, { type: "json" });
  if (existing) return { already: true, ...existing };

  const maxFromPurchase = Math.floor(purchase * REFERRAL_CREDIT_MAX_PERCENT / 100);
  if (amount > maxFromPurchase) {
    throw new Error(`el crédito no puede cubrir más del ${REFERRAL_CREDIT_MAX_PERCENT}% de la compra`);
  }

  const balance = await getReferralCreditBalance(env, slug, now);
  if (amount > balance) throw new Error("saldo insuficiente");

  const record = {
    slug,
    amountCents: amount,
    purchaseAmountCents: purchase,
    idempotencyKey: key,
    note: String(note || "").slice(0, 200),
    balanceBefore: balance,
    balanceAfter: balance - amount,
    at: now,
  };
  await env.PORTAL_KV.put(existingKey, JSON.stringify(record));

  const listKey = `credit-consumptions:${slug}`;
  const prev = (await env.PORTAL_KV.get(listKey, { type: "json" })) || [];
  prev.push(record);
  await env.PORTAL_KV.put(listKey, JSON.stringify(prev.slice(-200)));

  return record;
}

/**
 * client_reference_id combina el código de referido y el draftId del
 * borrador (ver js/ref-capture.js): "r.<CODE>_d.<draftId>", cualquiera de
 * los dos puede faltar. Los links viejos (de antes de que existiera el
 * draft) mandan el código "pelón", sin prefijo — se detecta por regex y se
 * sigue leyendo como referido para no romper links ya compartidos.
 */
export function parseClientReferenceId(raw) {
  const value = String(raw || "").trim();
  const out = { ref: null, draftId: null };
  if (!value) return out;

  if (value.includes("r.") || value.includes("d.")) {
    value.split("_").forEach((part) => {
      if (part.startsWith("r.")) out.ref = part.slice(2);
      else if (part.startsWith("d.")) out.draftId = part.slice(2);
    });
    return out;
  }

  if (/^[A-Z0-9]{4,16}$/i.test(value)) out.ref = value;
  return out;
}

async function sendReferralEmails(env, record, ref, sendEmailFn, renderFn) {
  if (!sendEmailFn) return false;
  const secrets = await getSecrets(env, ref.slug);
  const buyerLabel = record.buyerName || "Un nuevo cliente";

  if (secrets?.ownerEmail && renderFn) {
    await sendEmailFn({
      to: secrets.ownerEmail,
      subject: "¡Alguien usó tu link de referido! 🎁",
      html: renderFn({
        business_name: ref.slug,
        buyer_name: buyerLabel,
        referral_code: record.code,
        reward_amount: new Intl.NumberFormat("es-MX", {
          style: "currency",
          currency: record.currency.toUpperCase(),
        }).format(record.rewardAmount / 100),
        support_email: env.SUPPORT_EMAIL || "contacto@mimarca.me",
      }),
    });
  }

  if (env.OWNER_ALERT_EMAIL) {
    await sendEmailFn({
      to: env.OWNER_ALERT_EMAIL,
      subject: `🎁 Referido ${record.code} → ${ref.slug} (compró ${buyerLabel})`,
      html: `<p>Código <strong>${record.code}</strong> del cliente <strong>${ref.slug}</strong>.</p>
             <p>Comprador: ${buyerLabel} &lt;${maskEmail(record.buyerEmail) || "—"}&gt;</p>
             <p>Session: ${record.sessionId}</p>
             <p>Reward: ${(record.rewardAmount / 100).toFixed(2)} ${record.currency.toUpperCase()} (crédito interno, vence en 12 meses).</p>`,
    });
  }
  return true;
}

/**
 * Registra una redención idempotente por session.id y avisa al referidor.
 * El KV se escribe antes de los correos (best-effort). Si el correo falla,
 * un reintento de Stripe puede completar el envío sin duplicar el reward.
 */
export async function recordReferralRedemption(env, session, sendEmailFn, renderFn) {
  const { ref: parsedRef } = parseClientReferenceId(session.client_reference_id);
  const code = String(parsedRef || "").trim().toUpperCase();
  if (!code || !env.PORTAL_KV) return null;

  // Solo sesiones pagadas: evita acreditar si el checkout no se completó.
  const paymentStatus = String(session.payment_status || "").toLowerCase();
  if (paymentStatus && paymentStatus !== "paid") return null;

  // Solo genera reward si Stripe confirmó un descuento real. Esto evita
  // acreditar referencias manipulando client_reference_id a mano o si el
  // promotion code se removió en Checkout.
  const discountAmount = Number(session.total_details?.amount_discount || 0);
  if (discountAmount <= 0) return null;

  const ref = await lookupReferral(env, code);
  if (!ref?.slug) return null;

  const redeemKey = `redeem:${session.id}`;
  const existing = await env.PORTAL_KV.get(redeemKey, { type: "json" });
  if (existing) {
    if (!existing.emailSent) {
      try {
        await sendReferralEmails(env, existing, ref, sendEmailFn, renderFn);
        await env.PORTAL_KV.put(redeemKey, JSON.stringify({ ...existing, emailSent: true }));
      } catch (err) {
        console.error("referral email retry failed:", err);
      }
    }
    return { already: true, code, slug: ref.slug, record: existing };
  }

  const now = Date.now();
  const buyerEmail = session.customer_details?.email || "";
  const buyerName = session.customer_details?.name || "";
  const amountPaid = Number(session.amount_total || 0);
  const record = {
    code,
    referrerSlug: ref.slug,
    buyerEmail,
    buyerName,
    amountPaid,
    discountAmount,
    rewardAmount: Math.round(amountPaid * REFERRAL_REWARD_PERCENT / 100),
    currency: String(session.currency || "mxn").toLowerCase(),
    sessionId: session.id,
    at: now,
    createdAt: now,
    expiresAt: now + REFERRAL_REWARD_TTL_MS,
    emailSent: false,
  };
  await env.PORTAL_KV.put(redeemKey, JSON.stringify(record));

  const listKey = `redeems:${ref.slug}`;
  const prev = (await env.PORTAL_KV.get(listKey, { type: "json" })) || [];
  prev.push({
    sessionId: session.id,
    code,
    buyerEmail,
    buyerName,
    amountPaid: record.amountPaid,
    discountAmount: record.discountAmount,
    rewardAmount: record.rewardAmount,
    currency: record.currency,
    status: "confirmed",
    at: record.at,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  });
  await env.PORTAL_KV.put(listKey, JSON.stringify(prev.slice(-100)));

  try {
    await sendReferralEmails(env, record, ref, sendEmailFn, renderFn);
    record.emailSent = true;
    await env.PORTAL_KV.put(redeemKey, JSON.stringify(record));
  } catch (err) {
    console.error("referral email failed (reward kept):", err);
  }

  return record;
}

// ============================================================
// Borrador del builder (antes de pagar) — ver js/mi-tarjeta.js
// ============================================================

const DRAFT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dias
const MAX_DRAFT_BYTES = 500 * 1024; // logo en dataURL es lo que más pesa

/** Guarda {email, data} en KV con TTL y regresa el draftId generado. */
export async function saveDraft(env, email, data) {
  if (!env.PORTAL_KV) return null;
  const record = JSON.stringify({ email, data, createdAt: Date.now() });
  if (record.length > MAX_DRAFT_BYTES) {
    throw new Error("draft too large");
  }
  const draftId = crypto.randomUUID();
  await env.PORTAL_KV.put(`draft:${draftId}`, record, {
    expirationTtl: DRAFT_TTL_SECONDS,
  });
  return draftId;
}

/** Lee un borrador guardado. null si no existe/expiró. */
export async function getDraft(env, draftId) {
  if (!env.PORTAL_KV || !draftId) return null;
  return env.PORTAL_KV.get(`draft:${draftId}`, { type: "json" });
}

/**
 * Edita un borrador ya existente conservando su `email`/`createdAt` (el
 * Dashboard lo usa como "form" mientras el pedido sigue sin `slug" — ver
 * mi-cuenta/cuenta.html). Reinicia el TTL de 30 días. null si no existe.
 */
export async function updateDraft(env, draftId, data) {
  if (!env.PORTAL_KV || !draftId || !data || typeof data !== "object") return null;
  const prev = await getDraft(env, draftId);
  if (!prev) return null;

  const record = JSON.stringify({ email: prev.email, data, createdAt: prev.createdAt, updatedAt: Date.now() });
  if (record.length > MAX_DRAFT_BYTES) throw new Error("draft too large");

  await env.PORTAL_KV.put(`draft:${draftId}`, record, { expirationTtl: DRAFT_TTL_SECONDS });
  return { email: prev.email, data, createdAt: prev.createdAt };
}

/**
 * El redirect que Stripe manda al navegador justo después de pagar solo
 * trae `session_id` (se configura una sola vez en el Dashboard, no se le
 * puede pegar un `draft=` dinámico por sesión) — así que el webhook deja
 * este mapeo para que gracias.html pueda encontrar su borrador con lo
 * único que sí tiene a la mano.
 */
export async function linkSessionToDraft(env, sessionId, draftId) {
  if (!env.PORTAL_KV || !sessionId || !draftId) return;
  await env.PORTAL_KV.put(`session-draft:${sessionId}`, draftId, {
    expirationTtl: DRAFT_TTL_SECONDS,
  });
}

/** { draftId, email, data } a partir del session_id que trae la URL de gracias.html. */
export async function getDraftBySession(env, sessionId) {
  if (!env.PORTAL_KV || !sessionId) return null;
  const draftId = await env.PORTAL_KV.get(`session-draft:${sessionId}`);
  if (!draftId) return null;
  const draft = await getDraft(env, draftId);
  if (!draft) return null;
  return { draftId, ...draft };
}

/**
 * Semilla de la futura cuenta multi-negocio: una lista (por correo) de
 * pedidos ya pagados, sin UI todavía — el equipo la usa a mano para saber
 * qué borrador corresponde a qué pago mientras no exista el dashboard.
 */
export async function recordPendingOrder(env, { email, draftId, sessionId, packageName }) {
  if (!env.PORTAL_KV || !email) return;
  const key = `orders:${email.trim().toLowerCase()}`;
  const prev = (await env.PORTAL_KV.get(key, { type: "json" })) || [];
  prev.push({ draftId: draftId || null, sessionId, packageName, at: Date.now(), slug: null });
  await env.PORTAL_KV.put(key, JSON.stringify(prev.slice(-50)));
}

// ============================================================
// Links del cliente (autoedición, mi-cuenta/index.html) — ver
// js/mi-cuenta.js "Tus links". Cuánto puede editar depende de su tier:
// cambiar/reordenar/quitar dentro de su cupo es gratis y sin revisión
// humana; pasarse del cupo empuja a subir de tier, no cobra por link.
// ============================================================

/** Links incluidos por paquete. Decisión 2026-07-21 (ver PENDIENTES.md). */
export const LINKS_QUOTA_BY_PACKAGE = {
  lanzamiento: 3,
  personalizado: 6,
  premium: 12,
};

const DEFAULT_LINKS_QUOTA = LINKS_QUOTA_BY_PACKAGE.personalizado;

function normalizePackageKey(packageName) {
  return String(packageName || "").trim().toLowerCase();
}

/**
 * Cupo de links para un paquete. Si el paquete no se reconoce (cliente
 * viejo sin `package` en sus secretos), no le quitamos links que ya tenía:
 * el cupo es el mayor entre el default y lo que ya tiene puesto.
 */
export function resolveLinksQuota(packageName, currentCount = 0) {
  const known = LINKS_QUOTA_BY_PACKAGE[normalizePackageKey(packageName)];
  if (known != null) return known;
  return Math.max(DEFAULT_LINKS_QUOTA, currentCount);
}

const LINK_URL_RE = /^(https?:\/\/|tel:|mailto:|wa\.me\/)/i;

/**
 * Valida la forma del array de links que manda el cliente desde
 * mi-cuenta. Lanza Error con un mensaje corto y seguro de mostrar tal
 * cual (nunca datos crudos del cliente) si algo no cuadra.
 */
export function validateLinks(links, quota) {
  if (!Array.isArray(links)) throw new Error("formato inválido");
  if (links.length > quota) throw new Error(`tu paquete incluye ${quota} links — quita alguno o sube de paquete`);

  return links.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`link #${i + 1} inválido`);
    const label = String(raw.label || "").trim().slice(0, 60);
    const url = String(raw.url || "").trim().slice(0, 500);
    if (!label) throw new Error(`al link #${i + 1} le falta un nombre`);
    if (!url || !LINK_URL_RE.test(url)) throw new Error(`el link de "${label}" no es una URL válida`);
    return {
      label,
      url,
      subtitle: String(raw.subtitle || "").trim().slice(0, 80),
      icon: String(raw.icon || "link-45deg").trim().slice(0, 40),
      style: String(raw.style || "").trim().slice(0, 20),
    };
  });
}

/** Links guardados por el cliente (override sobre el JSON público). null si nunca editó. */
export async function getLinks(env, slug) {
  if (!env.PORTAL_KV || !slug) return null;
  return env.PORTAL_KV.get(`links:${slug}`, { type: "json" });
}

export async function setLinks(env, slug, links) {
  if (!env.PORTAL_KV || !slug) return;
  await env.PORTAL_KV.put(`links:${slug}`, JSON.stringify({ links, updatedAt: Date.now() }));
}

// ============================================================
// Servicios / precios (autoedición, mi-cuenta "Tus precios") —
// pensado para tarjetas premium / hechas a mano (piloto RCR).
// ============================================================

/** Cupo de servicios por paquete. Premium es la vitrina (menú amplio). */
export const SERVICES_QUOTA_BY_PACKAGE = {
  lanzamiento: 0,
  personalizado: 8,
  premium: 20,
};

const DEFAULT_SERVICES_QUOTA = SERVICES_QUOTA_BY_PACKAGE.personalizado;

export function resolveServicesQuota(packageName, currentCount = 0) {
  const known = SERVICES_QUOTA_BY_PACKAGE[normalizePackageKey(packageName)];
  if (known != null) return known;
  return Math.max(DEFAULT_SERVICES_QUOTA, currentCount);
}

/**
 * Valida el array de servicios/precios. Acepta price numérico o string
 * tipo "$150" / "150". Lanza Error con mensaje seguro para el panel.
 */
export function validateServices(services, quota) {
  if (!Array.isArray(services)) throw new Error("formato inválido");
  if (quota <= 0) throw new Error("tu paquete no incluye edición de precios");
  if (services.length > quota) {
    throw new Error(`tu paquete incluye hasta ${quota} servicios — quita alguno o sube de paquete`);
  }

  return services.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`servicio #${i + 1} inválido`);
    const name = String(raw.name || "").trim().slice(0, 80);
    if (!name) throw new Error(`al servicio #${i + 1} le falta un nombre`);

    let price = raw.price;
    if (typeof price === "string") {
      const cleaned = price.replace(/[^0-9.]/g, "");
      price = cleaned === "" ? null : Number(cleaned);
    }
    if (price != null && (typeof price !== "number" || Number.isNaN(price) || price < 0 || price > 999999)) {
      throw new Error(`el precio de "${name}" no es válido`);
    }

    const description = String(raw.description || raw.desc || "").trim().slice(0, 200);
    const note = String(raw.note || "").trim().slice(0, 120);
    const id = String(raw.id || `svc-${i + 1}`).trim().slice(0, 60).replace(/[^a-zA-Z0-9_-]/g, "") || `svc-${i + 1}`;
    const order = Number.isFinite(Number(raw.order)) ? Number(raw.order) : i;
    const active = raw.active === false ? false : true;

    return { id, name, description, price: price == null ? null : price, note, order, active };
  });
}

export async function getServices(env, slug) {
  if (!env.PORTAL_KV || !slug) return null;
  return env.PORTAL_KV.get(`services:${slug}`, { type: "json" });
}

export async function setServices(env, slug, services) {
  if (!env.PORTAL_KV || !slug) return;
  await env.PORTAL_KV.put(`services:${slug}`, JSON.stringify({ services, updatedAt: Date.now() }));
}

