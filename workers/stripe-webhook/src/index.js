/**
 * Worker de backend para Mi Tarjeta Pro (mimarca.me).
 *
 * El sitio sigue 100% estático en GitHub Pages; este Worker es el único
 * backend y atiende varias rutas por pathname:
 *
 *   POST /                    Webhook de Stripe (checkout.session.completed)
 *   POST /access              Magic link: {slug, email} -> reenvía el link de mi-cuenta
 *   POST /session             Valida slug+token (secretos en KV) y devuelve datos públicos
 *   POST /draft                Guarda el borrador del builder (antes de pagar)
 *   GET  /draft/:id             Lo lee (gracias.html lo usa para el recap)
 *   PUT  /draft/:id             {sessionToken,data} -> lo edita (Dashboard, antes de publicar)
 *   POST /upload               Logo/fotos del cliente -> R2 + aviso al owner
 *   POST /notify/approved      Cliente aprueba su diseño en revisión -> aviso al owner
 *   POST /notify/published     (admin) avisa al cliente que ya está publicada
 *   POST /notify/change-received (admin) confirma que se recibió su solicitud de cambios
 *
 *   GET  /card-links/:slug      Links autoeditados del cliente (público, sin auth)
 *   PUT  /card-links/:slug      {token,links} -> el cliente edita sus links dentro de su
 *                               cupo de tier (sin costo, sin revisión humana) — ver portal.js
 *   GET  /card-services/:slug   Servicios/precios autoeditados (público)
 *   PUT  /card-services/:slug   {token,services} -> el cliente edita precios (premium / handmade)
 *
 *   POST /account/register        {email,password} -> crea cuenta + sesión
 *   POST /account/login           {email,password} -> sesión
 *   POST /account/logout          {sessionToken} -> la invalida
 *   POST /account/request-reset   {email} -> correo con link de reset (siempre {ok:true})
 *   POST /account/reset-password  {token,password} -> nueva contraseña
 *   POST /account/me              {sessionToken} -> correo + lista de pedidos (Dashboard),
 *                                  cada pedido sin `slug` trae su borrador ({draft}) para
 *                                  poder editarlo antes de publicar.
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
import passwordResetTemplate from "../../../emails/password-reset.html";
import {
  buildTemplateVars,
  buildAccessLinkVars,
  buildCardPublishedVars,
  buildChangeRequestVars,
  buildAssetUploadedVars,
  buildApprovedAlertVars,
  buildDraftSummaryFields,
  buildPasswordResetVars,
  renderTemplate,
} from "./render.js";
import {
  stripSecrets,
  resolveClient,
  getSecrets,
  rateLimitAccess,
  rateLimitBucket,
  recordReferralRedemption,
  parseClientReferenceId,
  saveDraft,
  getDraft,
  updateDraft,
  linkSessionToDraft,
  getDraftBySession,
  recordPendingOrder,
  resolveLinksQuota,
  validateLinks,
  getLinks,
  setLinks,
  resolveServicesQuota,
  validateServices,
  getServices,
  setServices,
} from "./portal.js";
import {
  normalizeEmail,
  isValidEmail,
  createAccount,
  verifyLogin,
  setPassword,
  createAccountSession,
  resolveAccountSession,
  destroyAccountSession,
  createResetToken,
  consumeResetToken,
  getAccount,
  listOrdersForAccount,
} from "./account.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // GET /draft/:id y /draft-by-session/:id son de solo lectura
    // (gracias.html las consulta directo, sin ningun POST de por medio).
    if (request.method === "GET" && url.pathname.startsWith("/draft/")) {
      try {
        return await handleGetDraft(env, url.pathname.slice("/draft/".length));
      } catch (err) {
        console.error(err);
        return jsonResponse({ error: "internal error" }, 500);
      }
    }
    if (request.method === "GET" && url.pathname.startsWith("/draft-by-session/")) {
      try {
        return await handleGetDraftBySession(env, url.pathname.slice("/draft-by-session/".length));
      } catch (err) {
        console.error(err);
        return jsonResponse({ error: "internal error" }, 500);
      }
    }
    if (request.method === "GET" && url.pathname.startsWith("/card-links/")) {
      try {
        return await handleGetCardLinks(env, url.pathname.slice("/card-links/".length));
      } catch (err) {
        console.error(err);
        return jsonResponse({ error: "internal error" }, 500);
      }
    }
    if (request.method === "GET" && url.pathname.startsWith("/card-services/")) {
      try {
        return await handleGetCardServices(env, url.pathname.slice("/card-services/".length));
      } catch (err) {
        console.error(err);
        return jsonResponse({ error: "internal error" }, 500);
      }
    }

    // PUT: ediciones autoservicio autenticadas (token por tarjeta o sesión de cuenta).
    if (request.method === "PUT" && url.pathname.startsWith("/card-links/")) {
      try {
        return await handlePutCardLinks(request, env, url.pathname.slice("/card-links/".length));
      } catch (err) {
        console.error(err);
        return jsonResponse({ error: "internal error" }, 500);
      }
    }
    if (request.method === "PUT" && url.pathname.startsWith("/card-services/")) {
      try {
        return await handlePutCardServices(request, env, url.pathname.slice("/card-services/".length));
      } catch (err) {
        console.error(err);
        return jsonResponse({ error: "internal error" }, 500);
      }
    }
    if (request.method === "PUT" && url.pathname.startsWith("/draft/")) {
      try {
        return await handlePutDraft(request, env, url.pathname.slice("/draft/".length));
      } catch (err) {
        console.error(err);
        return jsonResponse({ error: "internal error" }, 500);
      }
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
      if (url.pathname === "/draft") {
        return await handleSaveDraft(request, env);
      }
      if (url.pathname === "/account/register") {
        return await handleAccountRegister(request, env);
      }
      if (url.pathname === "/account/login") {
        return await handleAccountLogin(request, env);
      }
      if (url.pathname === "/account/logout") {
        return await handleAccountLogout(request, env);
      }
      if (url.pathname === "/account/request-reset") {
        return await handleAccountRequestReset(request, env);
      }
      if (url.pathname === "/account/reset-password") {
        return await handleAccountResetPassword(request, env);
      }
      if (url.pathname === "/account/me") {
        return await handleAccountMe(request, env);
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

/**
 * Autoriza el panel de una tarjeta con:
 *   - ownerToken (magic link legacy / ?token=), o
 *   - sessionToken de cuenta (Dashboard → Ver panel, sin token en la URL)
 *
 * La sesión de cuenta vale si el correo es el ownerEmail del slug o si
 * tiene ese slug en orders:<email>.
 */
async function authorizeCardAccess(env, slug, { token, sessionToken } = {}) {
  const data = await loadClient(env, slug);
  if (!data) return null;

  const ownerToken = String(token || "").trim();
  if (ownerToken && data.ownerToken && data.ownerToken === ownerToken) {
    return data;
  }

  const sess = String(sessionToken || "").trim();
  if (!sess) return null;

  const email = await resolveAccountSession(env, sess);
  if (!email) return null;

  const ownerEmail = normalizeEmail(data.ownerEmail || "");
  if (ownerEmail && ownerEmail === email) return data;

  const orders = await listOrdersForAccount(env, email);
  if (Array.isArray(orders) && orders.some((o) => o && o.slug === slug)) {
    return data;
  }
  return null;
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

  // Borrador del builder (si el cliente pasó por ahí antes de pagar): se
  // agrega a onboarding_url para que gracias.html muestre el recap, y se
  // usa para llenar las filas "borrador" de la alerta al owner.
  const { draftId } = parseClientReferenceId(session.client_reference_id);
  const draftRecord = draftId ? await getDraft(env, draftId).catch(() => null) : null;
  if (draftRecord) {
    try {
      const u = new URL(vars.onboarding_url);
      u.searchParams.set("draft", draftId);
      vars.onboarding_url = u.toString();
    } catch {
      // onboarding_url siempre es una URL valida armada arriba; por si acaso.
    }
    // El redirect que arma Stripe justo despues de pagar solo trae
    // session_id (se configura una vez en el Dashboard) — este mapeo deja
    // que gracias.html encuentre el borrador con eso, sin esperar el correo.
    await linkSessionToDraft(env, session.id, draftId).catch((err) =>
      console.error("linkSessionToDraft failed:", err)
    );
  }
  Object.assign(vars, buildDraftSummaryFields(draftRecord));

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

  // Semilla de la futura cuenta multi-negocio — best-effort.
  await recordPendingOrder(env, {
    email: vars.customer_email || draftRecord?.email || "",
    draftId: draftId || null,
    sessionId: session.id,
    packageName: vars.package_name,
  }).catch((err) => console.error("recordPendingOrder failed:", err));

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
// POST /session — valida ownerToken O sesión de cuenta y devuelve datos
// ============================================================
async function handleSession(request, env) {
  const body = await safeJson(request);
  const slug = String(body?.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const token = String(body?.token || "").trim();
  const sessionToken = String(body?.sessionToken || "").trim();
  if (!slug || (!token && !sessionToken)) return jsonResponse({ error: "unauthorized" }, 403);

  const data = await authorizeCardAccess(env, slug, { token, sessionToken });
  if (!data) return jsonResponse({ error: "unauthorized" }, 403);

  const secrets = (await getSecrets(env, slug)) || {};
  const linksOverride = await getLinks(env, slug);
  const links = linksOverride?.links || data.links || [];
  const servicesOverride = await getServices(env, slug);
  const services = servicesOverride?.services || data.services || [];
  const servicesQuota = resolveServicesQuota(secrets.package, services.length);

  return jsonResponse({
    ok: true,
    data: {
      ...stripSecrets(data),
      links,
      services,
      referralCode: data.referralCode || "",
      orderStage: data.orderStage || "",
      package: secrets.package || "",
      linksQuota: resolveLinksQuota(secrets.package, links.length),
      servicesQuota,
      canEditServices: servicesQuota > 0 && (data.theme === "handmade" || services.length > 0 || secrets.package === "premium"),
    },
  });
}

// ============================================================
// GET  /card-links/:slug — links autoeditados (público, sin auth: ya son
// visibles en la tarjeta pública, no hay nada que proteger)
// PUT  /card-links/:slug — {token,links} el cliente edita sus propios
// links dentro de su cupo de tier. Sin revisión humana ni costo — pasarse
// del cupo empuja a subir de paquete, no cobra por link (decisión
// 2026-07-21, ver PENDIENTES.md).
// ============================================================
async function handleGetCardLinks(env, slugParam) {
  const slug = String(slugParam || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!slug || !env.PORTAL_KV) return jsonResponse({ error: "not found" }, 404);
  const record = await getLinks(env, slug);
  if (!record) return jsonResponse({ error: "not found" }, 404);
  return jsonResponse({ ok: true, links: record.links });
}

async function handlePutCardLinks(request, env, slugParam) {
  const slug = String(slugParam || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const body = await safeJson(request);
  const token = String(body?.token || "").trim();
  const sessionToken = String(body?.sessionToken || "").trim();
  if (!slug || (!token && !sessionToken)) return jsonResponse({ error: "missing fields" }, 400);

  const data = await authorizeCardAccess(env, slug, { token, sessionToken });
  if (!data) return jsonResponse({ error: "unauthorized" }, 403);
  if (data.orderStage !== "published") {
    return jsonResponse({ error: "tu tarjeta todavía no está publicada" }, 409);
  }

  const secrets = (await getSecrets(env, slug)) || {};
  const currentCount = Array.isArray(data.links) ? data.links.length : 0;
  const quota = resolveLinksQuota(secrets.package, currentCount);

  let links;
  try {
    links = validateLinks(body?.links, quota);
  } catch (err) {
    return jsonResponse({ error: err.message, quota }, 422);
  }

  await setLinks(env, slug, links);
  return jsonResponse({ ok: true, links, quota });
}

// ============================================================
// GET  /card-services/:slug — precios autoeditados (público)
// PUT  /card-services/:slug — {token,services} el cliente edita
// su menú de precios (premium / handmade). Misma idea que links.
// ============================================================
async function handleGetCardServices(env, slugParam) {
  const slug = String(slugParam || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!slug || !env.PORTAL_KV) return jsonResponse({ error: "not found" }, 404);
  const record = await getServices(env, slug);
  if (!record) return jsonResponse({ error: "not found" }, 404);
  return jsonResponse({ ok: true, services: record.services });
}

async function handlePutCardServices(request, env, slugParam) {
  const slug = String(slugParam || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const body = await safeJson(request);
  const token = String(body?.token || "").trim();
  const sessionToken = String(body?.sessionToken || "").trim();
  if (!slug || (!token && !sessionToken)) return jsonResponse({ error: "missing fields" }, 400);

  const data = await authorizeCardAccess(env, slug, { token, sessionToken });
  if (!data) return jsonResponse({ error: "unauthorized" }, 403);
  if (data.orderStage !== "published") {
    return jsonResponse({ error: "tu tarjeta todavía no está publicada" }, 409);
  }

  const secrets = (await getSecrets(env, slug)) || {};
  const currentCount = Array.isArray(data.services) ? data.services.length : 0;
  const quota = resolveServicesQuota(secrets.package, currentCount);
  if (quota <= 0) {
    return jsonResponse({ error: "tu paquete no incluye edición de precios", quota }, 403);
  }

  let services;
  try {
    services = validateServices(body?.services, quota);
  } catch (err) {
    return jsonResponse({ error: err.message, quota }, 422);
  }

  await setServices(env, slug, services);
  return jsonResponse({ ok: true, services, quota });
}

// ============================================================
// POST /draft — guarda el borrador del builder (antes de pagar)
// GET  /draft/:id — lo lee (gracias.html lo usa para el recap)
// ============================================================
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handleSaveDraft(request, env) {
  const body = await safeJson(request);
  const email = String(body?.email || "").trim().toLowerCase();
  const data = body?.data;

  if (!email || !EMAIL_RE.test(email) || !data || typeof data !== "object") {
    return jsonResponse({ error: "missing fields" }, 400);
  }
  if (!env.PORTAL_KV) {
    return jsonResponse({ error: "drafts not configured" }, 503);
  }

  try {
    const draftId = await saveDraft(env, email, data);
    return jsonResponse({ ok: true, draftId });
  } catch (err) {
    console.error("saveDraft failed:", err);
    return jsonResponse({ error: "could not save draft" }, 413);
  }
}

async function handleGetDraft(env, draftId) {
  if (!draftId || !env.PORTAL_KV) return jsonResponse({ error: "not found" }, 404);
  const draft = await getDraft(env, draftId);
  if (!draft) return jsonResponse({ error: "not found" }, 404);
  return jsonResponse({ ok: true, email: draft.email, data: draft.data });
}

async function handleGetDraftBySession(env, sessionId) {
  if (!sessionId || !env.PORTAL_KV) return jsonResponse({ error: "not found" }, 404);
  const found = await getDraftBySession(env, sessionId);
  if (!found) return jsonResponse({ error: "not found" }, 404);
  return jsonResponse({ ok: true, draftId: found.draftId, email: found.email, data: found.data });
}

// ============================================================
// PUT /draft/:id — el cliente edita su borrador desde el Dashboard
// (mi-cuenta/cuenta.html) mientras su pedido sigue sin `slug` — esto es
// lo que ve el equipo como "form" de intake, y lo que eventualmente
// alimenta la tarjeta en vivo al publicarla.
// ============================================================
async function handlePutDraft(request, env, draftId) {
  const body = await safeJson(request);
  const sessionToken = String(body?.sessionToken || "").trim();
  const data = body?.data;
  if (!draftId || !sessionToken || !data || typeof data !== "object") {
    return jsonResponse({ error: "missing fields" }, 400);
  }
  if (!env.PORTAL_KV) return jsonResponse({ error: "drafts not configured" }, 503);

  const email = await resolveAccountSession(env, sessionToken);
  if (!email) return jsonResponse({ error: "unauthorized" }, 403);

  const existing = await getDraft(env, draftId);
  if (!existing || normalizeEmail(existing.email) !== email) {
    return jsonResponse({ error: "unauthorized" }, 403);
  }

  try {
    const updated = await updateDraft(env, draftId, data);
    if (!updated) return jsonResponse({ error: "not found" }, 404);
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("updateDraft failed:", err);
    return jsonResponse({ error: "could not save draft" }, 413);
  }
}

// ============================================================
// Cuentas — mi-cuenta/cuenta.html (Dashboard, aparte del token por
// tarjeta que ya existe en /session). Ver src/account.js.
// ============================================================

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function handleAccountRegister(request, env) {
  const body = await safeJson(request);
  const email = normalizeEmail(body?.email);
  const password = String(body?.password || "");

  if (!env.PORTAL_KV) return jsonResponse({ error: "cuentas no configuradas todavía" }, 503);

  try {
    const { created } = await createAccount(env, email, password);
    if (!created) {
      return jsonResponse({ error: "ya existe una cuenta con ese correo — inicia sesión" }, 409);
    }
  } catch (err) {
    const msg = err.message === "weak password"
      ? "la contraseña debe tener al menos 8 caracteres"
      : "correo inválido";
    return jsonResponse({ error: msg }, 400);
  }

  const sessionToken = await createAccountSession(env, email);
  return jsonResponse({ ok: true, sessionToken });
}

async function handleAccountLogin(request, env) {
  const body = await safeJson(request);
  const email = normalizeEmail(body?.email);
  const password = String(body?.password || "");
  if (!email || !password) return jsonResponse({ error: "faltan datos" }, 400);
  if (!env.PORTAL_KV) return jsonResponse({ error: "cuentas no configuradas todavía" }, 503);

  const rl = await rateLimitBucket(env, `rl:login:${clientIp(request)}`, 10, 3600);
  if (!rl.allowed) return jsonResponse({ error: "demasiados intentos — espera un rato" }, 429);

  const ok = await verifyLogin(env, email, password);
  if (!ok) return jsonResponse({ error: "correo o contraseña incorrectos" }, 401);

  const sessionToken = await createAccountSession(env, email);
  return jsonResponse({ ok: true, sessionToken });
}

async function handleAccountLogout(request, env) {
  const body = await safeJson(request);
  await destroyAccountSession(env, String(body?.sessionToken || ""));
  return jsonResponse({ ok: true });
}

async function handleAccountRequestReset(request, env) {
  const body = await safeJson(request);
  const email = normalizeEmail(body?.email);
  const GENERIC_OK = jsonResponse({ ok: true });

  if (!email || !isValidEmail(email) || !env.PORTAL_KV) return GENERIC_OK;

  const rl = await rateLimitBucket(env, `rl:reset:${clientIp(request)}`, 5, 3600);
  if (!rl.allowed) return GENERIC_OK;

  const account = await getAccount(env, email);
  if (!account) return GENERIC_OK;

  const token = await createResetToken(env, email);
  await sendEmail(env, {
    to: email,
    subject: "Restablece tu contraseña — Mi Tarjeta Pro",
    html: renderTemplate(passwordResetTemplate, buildPasswordResetVars(token, env)),
  }).catch((err) => console.error("password-reset email failed:", err));

  return GENERIC_OK;
}

async function handleAccountResetPassword(request, env) {
  const body = await safeJson(request);
  const token = String(body?.token || "");
  const newPassword = String(body?.password || "");
  if (!token || !newPassword) return jsonResponse({ error: "faltan datos" }, 400);
  if (!env.PORTAL_KV) return jsonResponse({ error: "cuentas no configuradas todavía" }, 503);

  const email = await consumeResetToken(env, token);
  if (!email) return jsonResponse({ error: "link inválido o vencido — pide uno nuevo" }, 400);

  try {
    await setPassword(env, email, newPassword);
  } catch {
    return jsonResponse({ error: "la contraseña debe tener al menos 8 caracteres" }, 400);
  }

  return jsonResponse({ ok: true });
}

async function handleAccountMe(request, env) {
  const body = await safeJson(request);
  const email = await resolveAccountSession(env, String(body?.sessionToken || ""));
  if (!email) return jsonResponse({ error: "unauthorized" }, 403);

  const orders = await listOrdersForAccount(env, email);
  // Mientras un pedido no tenga `slug` (aún no publicado), su borrador es
  // lo único editable — lo adjuntamos para que el Dashboard lo muestre
  // como form. Una vez publicado, el borrador ya no importa (el editor de
  // links y las subidas de logo/fotos toman el relevo).
  const enrichedOrders = await Promise.all(
    orders.map(async (order) => {
      if (order.slug || !order.draftId) return order;
      const draft = await getDraft(env, order.draftId).catch(() => null);
      return draft ? { ...order, draft: { draftId: order.draftId, data: draft.data } } : order;
    })
  );

  return jsonResponse({ ok: true, email, orders: enrichedOrders });
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
  const sessionToken = String(form.get("sessionToken") || "").trim();
  const file = form.get("file");

  if (!slug || (!token && !sessionToken) || !(file instanceof File)) {
    return jsonResponse({ error: "missing fields" }, 400);
  }
  if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
    return jsonResponse({ error: "unsupported file type" }, 415);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonResponse({ error: "file too large" }, 413);
  }

  const data = await authorizeCardAccess(env, slug, { token, sessionToken });
  if (!data) return jsonResponse({ error: "unauthorized" }, 403);

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
  const sessionToken = String(body?.sessionToken || "").trim();
  if (!slug || (!token && !sessionToken)) return jsonResponse({ error: "missing fields" }, 400);

  const data = await authorizeCardAccess(env, slug, { token, sessionToken });
  if (!data) return jsonResponse({ error: "unauthorized" }, 403);

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

  // CC opcional (ej. copiar a pedidos@mimarca.me en un envío puntual).
  const ccRaw = String(body?.cc || "").trim().toLowerCase();
  const cc = ccRaw && EMAIL_RE.test(ccRaw) ? ccRaw : "";

  const data = await loadClient(env, slug);
  if (!data || !data.ownerEmail) return jsonResponse({ error: "client not found" }, 404);

  const template = action === "published" ? cardPublishedTemplate : changeRequestReceivedTemplate;
  const vars = action === "published" ? buildCardPublishedVars(data, env) : buildChangeRequestVars(data, env);
  const subject = action === "published"
    ? "¡Tu tarjeta digital ya está en vivo! 🎉"
    : "Recibimos tu solicitud de cambios";

  await sendEmail(env, { to: data.ownerEmail, subject, html: renderTemplate(template, vars), cc });

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

async function sendEmail(env, { to, subject, html, cc }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL || "mimarca <pedidos@mimarca.me>",
      to: [to],
      ...(cc ? { cc: [cc] } : {}),
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
