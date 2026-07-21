/**
 * Prepara los links de checkout de Stripe (buy.stripe.com) con:
 *
 * - client_reference_id: combina el código de referido (?ref=, ver
 *   negocio/_data/*.json / mi-cuenta) y el draftId del borrador que guarda
 *   el builder (js/mi-tarjeta.js) antes de pagar, codificados juntos como
 *   "r.<CODE>_d.<draftId>" (cualquiera de los dos puede faltar). El webhook
 *   los separa con parseClientReferenceId en
 *   workers/stripe-webhook/src/portal.js — links viejos con un código de
 *   referido "pelón" (sin prefijo) se siguen leyendo bien ahí.
 * - prefilled_email: el correo que dejó en el builder, si lo hay.
 *
 * Expone window.MTP_applyCheckoutParams() para que mi-tarjeta.js la vuelva
 * a llamar justo después de guardar un borrador nuevo (los links de
 * #precios ya están en el DOM desde el load inicial de la página).
 */
(function () {
  function readRef() {
    const params = new URLSearchParams(window.location.search);
    const incoming = (params.get("ref") || "").trim().toUpperCase();
    if (incoming && /^[A-Z0-9]{4,16}$/.test(incoming)) {
      try { sessionStorage.setItem("mitp_ref", incoming); } catch (_) { /* ignore */ }
    }
    try {
      return sessionStorage.getItem("mitp_ref") || "";
    } catch (_) {
      return "";
    }
  }

  function readDraft() {
    try {
      return {
        id: sessionStorage.getItem("mitp_draft_id") || "",
        email: sessionStorage.getItem("mitp_draft_email") || "",
      };
    } catch (_) {
      return { id: "", email: "" };
    }
  }

  function buildClientReferenceId(ref, draftId) {
    const parts = [];
    if (ref) parts.push(`r.${ref}`);
    if (draftId) parts.push(`d.${draftId}`);
    return parts.join("_");
  }

  function applyCheckoutParams() {
    const ref = readRef();
    const draft = readDraft();
    const combined = buildClientReferenceId(ref, draft.id);
    if (!combined && !draft.email) return;

    document.querySelectorAll("a[href*='buy.stripe.com']").forEach((a) => {
      try {
        const u = new URL(a.getAttribute("href"), window.location.origin);
        if (combined) u.searchParams.set("client_reference_id", combined);
        if (draft.email && !u.searchParams.get("prefilled_email")) {
          u.searchParams.set("prefilled_email", draft.email);
        }
        a.setAttribute("href", u.toString());
      } catch (_) { /* ignore */ }
    });
  }

  window.MTP_applyCheckoutParams = applyCheckoutParams;
  applyCheckoutParams();
})();
