/**
 * Logica pura de armado y render de los correos (sin dependencias del
 * runtime de Workers) para poder probarla con `node --test`.
 */

export const PACKAGE_NAMES = {
  lanzamiento: "Lanzamiento",
  personalizado: "Personalizado",
  premium: "Premium",
  cambios: "Cambios post-entrega",
};

export function buildTemplateVars(session, livemode, env) {
  const details = session.customer_details || {};
  const packageSlug = (session.metadata && session.metadata.package) || "";
  const packageName =
    (session.metadata && session.metadata.package_name) ||
    PACKAGE_NAMES[packageSlug] ||
    "Mi Tarjeta Pro";

  const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
  const currency = (session.currency || "mxn").toUpperCase();

  const orderDate = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  }).format(new Date((session.created ?? Date.now() / 1000) * 1000));

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || "";
  const dashboardBase = livemode
    ? "https://dashboard.stripe.com/payments/"
    : "https://dashboard.stripe.com/test/payments/";

  const onboardingUrl = new URL("https://mimarca.me/gracias.html");
  if (packageSlug) onboardingUrl.searchParams.set("package", packageSlug);
  onboardingUrl.searchParams.set("session_id", session.id);

  return {
    customer_name: details.name || "",
    customer_email: details.email || "",
    customer_phone: details.phone || "\u2014",
    package_name: packageName,
    amount,
    currency,
    session_id: session.id,
    order_date: orderDate,
    onboarding_url: onboardingUrl.toString(),
    support_email: env.SUPPORT_EMAIL || "contacto@mimarca.me",
    stripe_dashboard_url: paymentIntentId
      ? dashboardBase + paymentIntentId
      : "https://dashboard.stripe.com/payments",
  };
}

/**
 * Vars para emails/access-link.html. `data` es el JSON ya obtenido de
 * negocio/_data/<slug>.json (fetch lo hace el caller en index.js).
 */
export function buildAccessLinkVars(data, env) {
  const accessUrl = new URL("https://mimarca.me/mi-cuenta/");
  accessUrl.searchParams.set("n", data.slug);
  accessUrl.searchParams.set("token", data.ownerToken);
  return {
    business_name: data.business?.name || data.slug,
    access_url: accessUrl.toString(),
    support_email: env.SUPPORT_EMAIL || "contacto@mimarca.me",
  };
}

/** Vars para emails/card-published.html. */
export function buildCardPublishedVars(data, env) {
  return {
    business_name: data.business?.name || data.slug,
    public_url: `https://mimarca.me/${data.slug}/`,
    mi_cuenta_url: `https://mimarca.me/mi-cuenta/?n=${encodeURIComponent(data.slug)}&token=${encodeURIComponent(data.ownerToken || "")}`,
    support_email: env.SUPPORT_EMAIL || "contacto@mimarca.me",
  };
}

/** Vars para emails/change-request-received.html. */
export function buildChangeRequestVars(data, env, when = new Date()) {
  return {
    business_name: data.business?.name || data.slug,
    order_date: new Intl.DateTimeFormat("es-MX", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "America/Mexico_City",
    }).format(when),
    support_email: env.SUPPORT_EMAIL || "contacto@mimarca.me",
  };
}

/** Vars para emails/asset-uploaded.html (al owner). */
export function buildAssetUploadedVars(data, assetUrl, when = new Date()) {
  return {
    slug: data.slug,
    business_name: data.business?.name || data.slug,
    asset_url: assetUrl,
    uploaded_at: new Intl.DateTimeFormat("es-MX", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "America/Mexico_City",
    }).format(when),
  };
}

/**
 * Vars de los datos que el cliente llenó en la forma del builder (no el
 * mockup — eso es puro gancho visual y se descarta) para las filas
 * opcionales de emails/payment-alert.html. `draftRecord` es lo que regresa
 * portal.js#getDraft ({ email, data, createdAt }), con `data` en la forma
 * plana que arma buildIntakeData() en js/mi-tarjeta.js — o null/undefined
 * si el pago no traía draftId, en cuyo caso todo queda en "—".
 */
export function buildDraftSummaryFields(draftRecord) {
  const data = draftRecord?.data;
  if (!data) {
    return { draft_business_name: "—", draft_links_summary: "—" };
  }

  const parts = [];
  if (data.whatsapp) parts.push(`WhatsApp: ${data.whatsapp}`);
  if (data.instagram) parts.push(`Instagram: ${data.instagram}`);
  if (data.maps) parts.push(`Maps: ${data.maps}`);
  if (data.logoDataUrl) parts.push("Logo: recibido ✓");

  return {
    draft_business_name: data.businessName || "—",
    draft_links_summary: parts.length ? parts.join("  ·  ") : "—",
  };
}

/** Vars para emails/design-approved-alert.html (al owner). */
export function buildApprovedAlertVars(data) {
  return {
    slug: data.slug,
    business_name: data.business?.name || data.slug,
    mi_cuenta_url: `https://mimarca.me/mi-cuenta/?n=${encodeURIComponent(data.slug)}&token=${encodeURIComponent(data.ownerToken || "")}`,
  };
}

export function renderTemplate(template, vars) {
  return template.replace(/\{\{\s*([\w]+)\s*\}\}/g, (match, name) =>
    name in vars ? escapeHtml(String(vars[name])) : match
  );
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
