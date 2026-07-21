/**
 * Worker de backend para Mi Tarjeta Pro (mimarca.me).
 *
 * El sitio sigue 100% estático en GitHub Pages; este Worker es el único
 * backend y atiende varias rutas por pathname:
 *
 *   POST /                    Webhook de Stripe (checkout.session.completed)
 *   POST /access              Magic link: {slug, email} -> reenvía el link de mi-cuenta
 *   POST /session             Valida slug+token (secretos en KV) y devuelve datos públicos
 *   POST /upload               Logo/fotos del cliente -> R2 + aviso al owner
 *   POST /notify/approved      Cliente aprueba su diseño en revisión -> aviso al owner
 *   POST /notify/published     (admin) avisa al cliente que ya está publicada
 *   POST /notify/change-received (admin) confirma que se recibió su solicitud de cambios
 *
 * Secretos (ownerEmail, ownerToken, referralCode) viven en Cloudflare KV
 * (PORTAL_KV). El JSON público en Pages ya no debe incluirlos.
 */

import orderConfirmationTemplate from "../../../emails/order-confirmation.html";
import paymentAlertTemplate from "../../../emails/payment-alert.html";
import accessLinkTemplate from "../../../emails/access-link.html";
import cardPublishedTemplate from "../../../emails/card-published.html";
import changeRequestReceivedTemplate from "../../../emails/change-request-received.html";
import assetUploadedTemplate from "../../../emails/asset-uploaded.html";
import designApprovedAlertTemplate from "../../../emails/design-approved-alert.html";
import referralRewardTemplate from "../../../emails/referral-reward.html";
import {
  buildTemplateVars,
  buildAccessLinkVars,
  buildCardPublishedVars,
  buildChangeRequestVars,
  buildAssetUploadedVars,
  buildApprovedAlertVars,
  renderTemplate,
} from "./render.js";
import {
  stripSecrets,
  resolveClient,
  rateLimitAccess,
  recordReferralRedemption,
} from "./portal.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
    }

    try {
      if (url.pathname === "/" || url.pathname === "") {
        return await handleStripeWebhook(request, env);
      }
      if (url.pathname === "/access") {
        return await handleAccessRequest(request, env);
      }
      if (url.pathname === "/session") {
        return await handleSession(request, env);
      }
      if (url.pathname === "/upload") {
        return await handleUpload(request, env);
      }
      if (url.pathname === "/notify/approved") {
        return await handleApproved(request, env);
      }
      if (url.pathname === "/notify/published") {
        return await handleAdminNotify(request, env, "published");
      }
      if (url.pathname === "/notify/change-received") {
        return await handleAdminNotify(request, env, "change-received");
      }
    } catch (err) {
      console.error(err);
      return jsonResponse({ error: "internal error" }, 500);
    }

    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  },
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

const SLUG_RE = /^[a-z0-9-]+$/;

async function loadClient(env, slug) {
  if (!SLUG_RE.test(slug)) return null;
  const r = await fetch(`https://mimarca.me/negocio/_data/${slug}.json`, {
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!r.ok) return null;
  let raw;
  try {
    raw = await r.json();
  } catch {
    return null;
  }
  return resolveClient(env, slug, raw);
}

// ============================================================
// POST / — Stripe webhook (Payment Links / checkout sin cambios de flujo)
// ============================================================
async function handleStripeWebhook(request, env) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  const valid = await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return new Response("Invalid signature", { status: 400, headers: CORS_HEADERS });
  }

  const event = JSON.parse(payload);
  if (event.type !== "checkout.session.completed") {
    return jsonResponse({ received: true, ignored: event.type });
  }

  const session = event.data.object;
  const vars = buildTemplateVars(session, event.livemode, env);

  const results = await Promise.allSettled([
    vars.customer_email
      ? sendEmail(env, {
          to: vars.customer_email,
          subject: "¡Recibimos tu pago! Tu Mi Tarjeta Pro está en camino 🎉",
          html: renderTemplate(orderConfirmationTemplate, vars),
        })
      : Promise.reject(new Error("Checkout session has no customer email")),
    sendEmail(env, {
      to: env.OWNER_ALERT_EMAIL,
      subject: `💰 Nuevo pago — ${vars.package_name} ($${vars.amount} ${vars.currency}) — ${vars.customer_name}`,
      html: renderTemplate(paymentAlertTemplate, vars),
    }),
  ]);

  const failures = results.filter((r) => r.status === "rejected").map((r) => String(r.reason));
  if (failures.length > 0) {
    console.error("Email delivery failed:", failures);
    return jsonResponse({ received: true, errors: failures }, 500);
  }

  // Referidos: best-effort, no tumba el webhook si falla.
  await recordReferralRedemption(
    env,
    session,
    (opts) => sendEmail(env, opts),
    (v) => renderTemplate(referralRewardTemplate, v)
  ).catch((err) => console.error("referral tracking failed:", err));

  return jsonResponse({ received: true });
}

// ============================================================
// POST /access — magic link (sin password) + rate limit por IP
// ============================================================
async function handleAccessRequest(request, env) {
  const body = await safeJson(request);
  const slug = String(body?.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const email = String(body?.email || "").trim().toLowerCase();

  const GENERIC_OK = jsonResponse({ ok: true });

  if (!slug || !email) return GENERIC_OK;

  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const rl = await rateLimitAccess(env, ip);
  if (!rl.allowed) return GENERIC_OK;

  const data = await loadClient(env, slug);
  if (!data || !data.ownerEmail || !data.ownerToken) return GENERIC_OK;
  if (String(data.ownerEmail).trim().toLowerCase() !== email) return GENERIC_OK;

  const vars = buildAccessLinkVars(data, env);
  await sendEmail(env, {
    to: data.ownerEmail,
    subject: "Tu acceso a Mi Tarjeta Pro",
    html: renderTemplate(accessLinkTemplate, vars),
  }).catch((err) => console.error("access email failed:", err));

  return GENERIC_OK;
}

// ============================================================
// POST /session — valida token y devuelve datos públicos (+ referralCode)
// ============================================================
async function handleSession(request, env) {
  const body = await safeJson(request);
  const slug = String(body?.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const token = String(body?.token || "").trim();
  if (!slug || !token) return jsonResponse({ error: "unauthorized" }, 403);

  const data = await loadClient(env, slug);
  if (!data || !data.ownerToken || data.ownerToken !== token) {
    return jsonResponse({ error: "unauthorized" }, 403);
  }

  return jsonResponse({
    ok: true,
    data: {
      ...stripSecrets(data),
      referralCode: data.referralCode || "",
      orderStage: data.orderStage || "",
    },
  });
}

// ============================================================
// POST /upload — logo/fotos del cliente (R2) + aviso al owner
// ============================================================
const ALLOWED_UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

async function handleUpload(request, env) {
  const form = await request.formData().catch(() => null);
  if (!form) return jsonResponse({ error: "invalid form" }, 400);

  const slug = String(form.get("slug") || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const token = String(form.get("token") || "").trim();
  const file = form.get("file");

  if (!slug || !token || !(file instanceof File)) {
    return jsonResponse({ error: "missing fields" }, 400);
  }
  if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
    return jsonResponse({ error: "unsupported file type" }, 415);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonResponse({ error: "file too large" }, 413);
  }

  const data = await loadClient(env, slug);
  if (!data || !data.ownerToken || data.ownerToken !== token) {
    return jsonResponse({ error: "unauthorized" }, 403);
  }

  if (!env.PORTAL_UPLOADS || !env.R2_PUBLIC_BASE_URL) {
    return jsonResponse({ error: "uploads not configured" }, 503);
  }

  const safeName = (file.name || "archivo").replace(/[^a-zA-Z0-9.-]/g, "-").slice(-80);
  const key = `uploads/${slug}/${Date.now()}-${safeName}`;
  await env.PORTAL_UPLOADS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  const assetUrl = `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;

  const vars = buildAssetUploadedVars(data, assetUrl);
  await sendEmail(env, {
    to: env.OWNER_ALERT_EMAIL,
    subject: `📎 ${data.slug} subió un archivo — aplícalo a su tarjeta`,
    html: renderTemplate(assetUploadedTemplate, vars),
  }).catch((err) => console.error("asset-uploaded email failed:", err));

  return jsonResponse({ ok: true, url: assetUrl });
}

// ============================================================
// POST /notify/approved — el cliente aprueba su diseño en revisión
// ============================================================
async function handleApproved(request, env) {
  const body = await safeJson(request);
  const slug = String(body?.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const token = String(body?.token || "").trim();
  if (!slug || !token) return jsonResponse({ error: "missing fields" }, 400);

  const data = await loadClient(env, slug);
  if (!data || !data.ownerToken || data.ownerToken !== token) {
    return jsonResponse({ error: "unauthorized" }, 403);
  }

  const vars = buildApprovedAlertVars(data);
  await sendEmail(env, {
    to: env.OWNER_ALERT_EMAIL,
    subject: `✅ ${data.slug} aprobó su diseño — publicálo`,
    html: renderTemplate(designApprovedAlertTemplate, vars),
  }).catch((err) => console.error("approved-alert email failed:", err));

  return jsonResponse({ ok: true });
}

// ============================================================
// POST /notify/published, /notify/change-received — admin
// ============================================================
async function handleAdminNotify(request, env, action) {
  const secret = request.headers.get("X-Admin-Secret") || "";
  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
    return jsonResponse({ error: "unauthorized" }, 403);
  }

  const body = await safeJson(request);
  const slug = String(body?.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!slug) return jsonResponse({ error: "missing slug" }, 400);

  const data = await loadClient(env, slug);
  if (!data || !data.ownerEmail) return jsonResponse({ error: "client not found" }, 404);

  const template = action === "published" ? cardPublishedTemplate : changeRequestReceivedTemplate;
  const vars = action === "published" ? buildCardPublishedVars(data, env) : buildChangeRequestVars(data, env);
  const subject = action === "published"
    ? "¡Tu tarjeta digital ya está en vivo! 🎉"
    : "Recibimos tu solicitud de cambios";

  await sendEmail(env, { to: data.ownerEmail, subject, html: renderTemplate(template, vars) });

  return jsonResponse({ ok: true });
}

// ============================================================
// helpers compartidos
// ============================================================
async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function verifyStripeSignature(payload, header, secret, toleranceSeconds = 300) {
  if (!header || !secret) return false;

  const parts = Object.create(null);
  for (const item of header.split(",")) {
    const [key, value] = item.split("=", 2);
    if (key === "v1") (parts.v1 ??= []).push(value);
    else parts[key.trim()] = value;
  }
  const timestamp = Number(parts.t);
  const signatures = parts.v1 || [];
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${parts.t}.${payload}`)
  );
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sendEmail(env, { to, subject, html }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL || "mimarca <pedidos@mimarca.me>",
      to: [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend ${response.status} for ${to}: ${body}`);
  }
  return response.json();
}
