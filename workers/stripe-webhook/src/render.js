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
