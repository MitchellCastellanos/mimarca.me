import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildTemplateVars, renderTemplate } from "../src/render.js";

const fakeSession = {
  id: "cs_test_a1B2c3D4",
  amount_total: 19900,
  currency: "mxn",
  created: 1784251725,
  payment_intent: "pi_3Tu0test",
  customer_details: {
    name: "Lulu Ramirez",
    email: "lulu@example.com",
    phone: "+5215512345678",
  },
  metadata: { package: "lanzamiento", package_name: "Lanzamiento" },
};

test("buildTemplateVars llena todos los campos", () => {
  const vars = buildTemplateVars(fakeSession, false, {});
  assert.equal(vars.customer_name, "Lulu Ramirez");
  assert.equal(vars.customer_email, "lulu@example.com");
  assert.equal(vars.package_name, "Lanzamiento");
  assert.equal(vars.amount, "199.00");
  assert.equal(vars.currency, "MXN");
  assert.equal(vars.session_id, "cs_test_a1B2c3D4");
  assert.equal(
    vars.stripe_dashboard_url,
    "https://dashboard.stripe.com/test/payments/pi_3Tu0test"
  );
  assert.ok(vars.onboarding_url.includes("package=lanzamiento"));
  assert.ok(vars.onboarding_url.includes("session_id=cs_test_a1B2c3D4"));
});

test("las dos plantillas reales quedan sin ningun {{placeholder}}", async () => {
  const vars = buildTemplateVars(fakeSession, true, {
    SUPPORT_EMAIL: "contacto@mimarca.me",
  });
  for (const file of [
    "../../../emails/order-confirmation.html",
    "../../../emails/payment-alert.html",
  ]) {
    const template = await readFile(new URL(file, import.meta.url), "utf8");
    const rendered = renderTemplate(template, vars);
    // El comentario de documentacion al inicio menciona {{mustache}} y
    // {{package}}: solo validamos el body real del correo.
    const body = rendered.slice(rendered.indexOf("<!doctype"));
    assert.doesNotMatch(body, /\{\{[\w]+\}\}/, `placeholders sin reemplazar en ${file}`);
  }
});

test("sesion sin nombre ni telefono usa fallbacks", () => {
  const vars = buildTemplateVars(
    { id: "cs_x", amount_total: 2500, currency: "mxn", metadata: { package: "cambios" } },
    false,
    {}
  );
  assert.equal(vars.customer_name, "");
  assert.equal(vars.customer_phone, "\u2014");
  assert.equal(vars.package_name, "Cambios post-entrega");
  assert.equal(vars.amount, "25.00");
});
