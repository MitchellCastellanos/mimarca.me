/**
 * Persiste ?ref= de referidos y lo pasa a los Payment Links de Stripe
 * como client_reference_id (el webhook lo registra en KV).
 */
(function () {
  const params = new URLSearchParams(window.location.search);
  const incoming = (params.get("ref") || "").trim().toUpperCase();
  if (incoming && /^[A-Z0-9]{4,16}$/.test(incoming)) {
    try {
      sessionStorage.setItem("mitp_ref", incoming);
    } catch (_) { /* ignore */ }
  }

  let ref = "";
  try {
    ref = sessionStorage.getItem("mitp_ref") || "";
  } catch (_) {
    ref = "";
  }
  if (!ref) return;

  document.querySelectorAll("a[href*='buy.stripe.com']").forEach((a) => {
    try {
      const u = new URL(a.getAttribute("href"), window.location.origin);
      if (!u.searchParams.get("client_reference_id")) {
        u.searchParams.set("client_reference_id", ref);
        a.setAttribute("href", u.toString());
      }
    } catch (_) { /* ignore */ }
  });
})();
