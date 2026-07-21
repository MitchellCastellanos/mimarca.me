import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildTemplateVars,
  buildAccessLinkVars,
  buildCardPublishedVars,
  buildChangeRequestVars,
  buildAssetUploadedVars,
  buildApprovedAlertVars,
  buildDraftSummaryFields,
  renderTemplate,
} from "../src/render.js";

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
  Object.assign(vars, buildDraftSummaryFields(null));
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

const fakeClient = {
  slug: "lulu",
  business: { name: "RCR" },
  ownerToken: "lulu-x7a9k2",
  ownerEmail: "rcr.barbershop.demo@mimarca.me",
};

test("buildAccessLinkVars arma el link de mi-cuenta con slug y token", () => {
  const vars = buildAccessLinkVars(fakeClient, {});
  assert.equal(vars.business_name, "RCR");
  assert.equal(vars.access_url, "https://mimarca.me/mi-cuenta/?n=lulu&token=lulu-x7a9k2");
  assert.equal(vars.support_email, "contacto@mimarca.me");
});

test("buildCardPublishedVars usa el slug como fallback de nombre", () => {
  const vars = buildCardPublishedVars({ slug: "sin-nombre", ownerToken: "t1" }, {});
  assert.equal(vars.business_name, "sin-nombre");
  assert.equal(vars.public_url, "https://mimarca.me/sin-nombre/");
  assert.match(vars.mi_cuenta_url, /token=t1$/);
});

test("buildChangeRequestVars formatea la fecha en es-MX", () => {
  const vars = buildChangeRequestVars(fakeClient, {}, new Date("2026-07-20T18:00:00Z"));
  assert.equal(vars.business_name, "RCR");
  assert.ok(vars.order_date.length > 0);
});

test("buildAssetUploadedVars incluye el slug y la url del archivo", () => {
  const vars = buildAssetUploadedVars(fakeClient, "https://uploads.mimarca.me/uploads/lulu/1-logo.png", new Date());
  assert.equal(vars.slug, "lulu");
  assert.equal(vars.asset_url, "https://uploads.mimarca.me/uploads/lulu/1-logo.png");
});

test("buildApprovedAlertVars arma el link de mi-cuenta del cliente", () => {
  const vars = buildApprovedAlertVars(fakeClient);
  assert.equal(vars.slug, "lulu");
  assert.match(vars.mi_cuenta_url, /n=lulu&token=lulu-x7a9k2$/);
});

test("las plantillas nuevas quedan sin ningun {{placeholder}}", async () => {
  const cases = [
    ["../../../emails/access-link.html", buildAccessLinkVars(fakeClient, {})],
    ["../../../emails/card-published.html", buildCardPublishedVars(fakeClient, {})],
    ["../../../emails/change-request-received.html", buildChangeRequestVars(fakeClient, {})],
    ["../../../emails/asset-uploaded.html", buildAssetUploadedVars(fakeClient, "https://uploads.mimarca.me/x.png")],
    ["../../../emails/design-approved-alert.html", buildApprovedAlertVars(fakeClient)],
  ];
  for (const [file, vars] of cases) {
    const template = await readFile(new URL(file, import.meta.url), "utf8");
    const rendered = renderTemplate(template, vars);
    const body = rendered.slice(rendered.indexOf("<!doctype"));
    assert.doesNotMatch(body, /\{\{[\w]+\}\}/, `placeholders sin reemplazar en ${file}`);
  }
});

test("buildDraftSummaryFields sin borrador cae en guiones", () => {
  assert.deepEqual(buildDraftSummaryFields(null), {
    draft_business_name: "—",
    draft_links_summary: "—",
  });
});

test("buildDraftSummaryFields arma el resumen de links del borrador", () => {
  const fields = buildDraftSummaryFields({
    email: "cliente@correo.com",
    data: {
      businessName: "Taquería La Bendita",
      whatsapp: "https://wa.me/5215555555555",
      instagram: "https://instagram.com/labendita",
    },
  });
  assert.equal(fields.draft_business_name, "Taquería La Bendita");
  assert.match(fields.draft_links_summary, /WhatsApp: https:\/\/wa\.me\/5215555555555/);
  assert.match(fields.draft_links_summary, /Instagram: https:\/\/instagram\.com\/labendita/);
});
