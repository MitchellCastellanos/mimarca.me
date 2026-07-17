/**
 * Webhook de Stripe para Mi Tarjeta Pro (mimarca.me).
 *
 * Recibe `checkout.session.completed`, valida la firma con
 * STRIPE_WEBHOOK_SECRET y dispara los dos correos de marca:
 *   - emails/order-confirmation.html -> al cliente
 *   - emails/payment-alert.html      -> al owner (OWNER_ALERT_EMAIL)
 * El envio se hace via Resend (RESEND_API_KEY).
 */

import orderConfirmationTemplate from "../../../emails/order-confirmation.html";
import paymentAlertTemplate from "../../../emails/payment-alert.html";
import { buildTemplateVars, renderTemplate } from "./render.js";

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const payload = await request.text();
    const signature = request.headers.get("stripe-signature");

    const valid = await verifyStripeSignature(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
    if (!valid) {
      return new Response("Invalid signature", { status: 400 });
    }

    const event = JSON.parse(payload);
    if (event.type !== "checkout.session.completed") {
      // Reconocemos el evento para que Stripe no lo reintente.
      return new Response(JSON.stringify({ received: true, ignored: event.type }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const session = event.data.object;
    const vars = buildTemplateVars(session, event.livemode, env);

    const results = await Promise.allSettled([
      vars.customer_email
        ? sendEmail(env, {
            to: vars.customer_email,
            subject: "\u00a1Recibimos tu pago! Tu Mi Tarjeta Pro est\u00e1 en camino \ud83c\udf89",
            html: renderTemplate(orderConfirmationTemplate, vars),
          })
        : Promise.reject(new Error("Checkout session has no customer email")),
      sendEmail(env, {
        to: env.OWNER_ALERT_EMAIL,
        subject: `\ud83d\udcb0 Nuevo pago \u2014 ${vars.package_name} ($${vars.amount} ${vars.currency}) \u2014 ${vars.customer_name}`,
        html: renderTemplate(paymentAlertTemplate, vars),
      }),
    ]);

    const failures = results
      .filter((r) => r.status === "rejected")
      .map((r) => String(r.reason));
    if (failures.length > 0) {
      console.error("Email delivery failed:", failures);
      // 500 para que Stripe reintente el webhook.
      return new Response(JSON.stringify({ received: true, errors: failures }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
};

/**
 * Valida la cabecera `stripe-signature` (esquema v1: HMAC-SHA256 de
 * "<timestamp>.<payload>" con el signing secret del endpoint).
 */
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
