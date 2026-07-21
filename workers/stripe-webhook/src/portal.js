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
 * Registra una redención idempotente por session.id y avisa al referidor.
 * No lanza: el caller envuelve en catch.
 */
export async function recordReferralRedemption(env, session, sendEmailFn, renderFn) {
  const code = String(session.client_reference_id || "").trim().toUpperCase();
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
