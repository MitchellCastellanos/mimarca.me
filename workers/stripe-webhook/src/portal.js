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

export async function rateLimitAccess(env, ip, limit = 5, windowSeconds = 3600) {
  if (!env.PORTAL_KV || !ip) return { allowed: true };
  const key = `rl:access:${ip}`;
  const raw = await env.PORTAL_KV.get(key);
  const count = Number(raw || 0);
  if (count >= limit) return { allowed: false, count };
  await env.PORTAL_KV.put(key, String(count + 1), { expirationTtl: windowSeconds });
  return { allowed: true, count: count + 1 };
}

export async function lookupReferral(env, code) {
  if (!env.PORTAL_KV || !code) return null;
  const normalized = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(normalized)) return null;
  return env.PORTAL_KV.get(`ref:${normalized}`, { type: "json" });
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

/**
 * Registra una redención idempotente por session.id y avisa al referidor.
 * No lanza: el caller envuelve en catch.
 */
export async function recordReferralRedemption(env, session, sendEmailFn, renderFn) {
  const { ref: parsedRef } = parseClientReferenceId(session.client_reference_id);
  const code = String(parsedRef || "").trim().toUpperCase();
  if (!code || !env.PORTAL_KV) return null;

  const ref = await lookupReferral(env, code);
  if (!ref?.slug) return null;

  const redeemKey = `redeem:${session.id}`;
  if (await env.PORTAL_KV.get(redeemKey)) return { already: true, code, slug: ref.slug };

  const buyerEmail = session.customer_details?.email || "";
  const buyerName = session.customer_details?.name || "";
  const record = {
    code,
    referrerSlug: ref.slug,
    buyerEmail,
    buyerName,
    sessionId: session.id,
    at: Date.now(),
  };
  await env.PORTAL_KV.put(redeemKey, JSON.stringify(record));

  const listKey = `redeems:${ref.slug}`;
  const prev = (await env.PORTAL_KV.get(listKey, { type: "json" })) || [];
  prev.push({ sessionId: session.id, code, buyerEmail, at: record.at });
  await env.PORTAL_KV.put(listKey, JSON.stringify(prev.slice(-100)));

  const secrets = await getSecrets(env, ref.slug);
  if (secrets?.ownerEmail && sendEmailFn && renderFn) {
    await sendEmailFn({
      to: secrets.ownerEmail,
      subject: "¡Alguien usó tu link de referido! 🎁",
      html: renderFn({
        business_name: ref.slug,
        buyer_name: buyerName || "Un nuevo cliente",
        referral_code: code,
        support_email: env.SUPPORT_EMAIL || "contacto@mimarca.me",
      }),
    });
  }

  if (env.OWNER_ALERT_EMAIL && sendEmailFn) {
    await sendEmailFn({
      to: env.OWNER_ALERT_EMAIL,
      subject: `🎁 Referido ${code} → ${ref.slug} (compró ${buyerName || buyerEmail || "alguien"})`,
      html: `<p>Código <strong>${code}</strong> del cliente <strong>${ref.slug}</strong>.</p>
             <p>Comprador: ${buyerName || "—"} &lt;${buyerEmail || "—"}&gt;</p>
             <p>Session: ${session.id}</p>
             <p>Premio sugerido: un cambio gratis en su próxima orden.</p>`,
    });
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

