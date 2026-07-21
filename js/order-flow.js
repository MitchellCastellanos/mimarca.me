(function () {
  const $ = (id) => document.getElementById(id);
  if (!$("order-config")) return;

  const tiers = {
    lanzamiento: { name: "Lanzamiento", price: "$199 MXN", links: 3, checkout: "https://buy.stripe.com/eVqcN67HF1xkdP7gQjgjC00" },
    personalizado: { name: "Personalizado", price: "$249 MXN", links: 6, checkout: "https://buy.stripe.com/4gM28s6DB0tgh1j1VpgjC01" },
    premium: { name: "Premium", price: "$299 MXN", links: 12, checkout: "https://buy.stripe.com/5kQcN64vt5NA7qJ7fJgjC02" },
  };
  const order = ["lanzamiento", "personalizado", "premium"];
  let manualTier = null;
  let selectedTier = "lanzamiento";

  const checked = (root) => Array.from(document.querySelectorAll(`${root} input:checked`)).map((el) => el.value);
  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));

  function apiBase() {
    return (document.querySelector('meta[name="mitp-portal-api"]')?.content || "").replace(/\/$/, "");
  }

  function minimumTier() {
    const count = checked("#orderLinks").length;
    let index = count > 6 ? 2 : count > 3 ? 1 : 0;
    document.querySelectorAll("#orderFeatures input:checked").forEach((input) => {
      index = Math.max(index, order.indexOf(input.dataset.minTier || "lanzamiento"));
    });
    return order[index];
  }

  function update() {
    const requiredIndex = order.indexOf(minimumTier());
    const manualIndex = manualTier ? order.indexOf(manualTier) : -1;
    selectedTier = order[Math.max(requiredIndex, manualIndex)];
    const tier = tiers[selectedTier];
    const count = checked("#orderLinks").length;
    $("orderTierName").textContent = tier.name;
    $("orderTierPrice").textContent = tier.price;
    $("orderTierReason").textContent = `${count} de ${tier.links} links incluidos.`;
    $("orderLinksProgress").style.width = `${Math.min(100, count / tier.links * 100)}%`;
    const next = order[order.indexOf(selectedTier) + 1];
    const hint = $("orderUpgradeHint");
    if (next) {
      hint.classList.remove("d-none");
      hint.innerHTML = `<strong>${tiers[next].name}</strong> incluye hasta ${tiers[next].links} links${next === "premium" ? " y funciones visuales avanzadas" : " y archivos fuente"}. <button type="button" id="orderUpgradeBtn" class="btn btn-link btn-sm p-0 ms-1">Subir de paquete</button>`;
      $("orderUpgradeBtn").onclick = () => { manualTier = next; update(); };
    } else {
      hint.classList.add("d-none");
    }
    $("orderSummary").classList.add("d-none");
  }

  function syncMockup() {
    if (!$("orderBusinessName").value) $("orderBusinessName").value = $("mtName")?.value.trim() || "";
    if (!$("orderEmail").value) $("orderEmail").value = $("mtEmail")?.value.trim() || "";
    const values = new Set();
    if ($("mtWa")?.value.trim()) values.add("WhatsApp");
    if ($("mtInstagram")?.value.trim()) values.add("Instagram");
    if ($("mtMaps")?.value.trim()) values.add("Google Maps");
    document.querySelectorAll("#orderLinks input").forEach((input) => { if (values.has(input.value)) input.checked = true; });
    update();
  }

  function readLogo() {
    const file = $("mtLogo")?.files?.[0];
    if (!file) return Promise.resolve("");
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  }

  function draftData(logoDataUrl) {
    const wa = ($("mtWa")?.value || "").replace(/[^0-9]/g, "");
    return {
      businessName: $("orderBusinessName").value.trim(),
      tagline: $("mtTagline")?.value.trim() || "",
      category: $("mtCategory")?.value || "",
      whatsapp: wa ? `https://wa.me/${wa}` : "",
      instagram: $("mtInstagram")?.value.trim() || "",
      maps: $("mtMaps")?.value.trim() || "",
      slugPreference: $("mtSlug")?.value.trim() || "",
      logoDataUrl: logoDataUrl || "",
      orderOfficial: true,
      selectedPackage: selectedTier,
      selectedPackageName: tiers[selectedTier].name,
      requestedLinks: checked("#orderLinks"),
      requestedFeatures: checked("#orderFeatures"),
      linksCount: checked("#orderLinks").length,
    };
  }

  async function saveDraft() {
    const logoDataUrl = await readLogo();
    const response = await fetch(`${apiBase()}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: $("orderEmail").value.trim(), data: draftData(logoDataUrl) }),
    });
    if (!response.ok) throw new Error("draft");
    const result = await response.json();
    sessionStorage.setItem("mitp_draft_id", result.draftId);
    sessionStorage.setItem("mitp_draft_email", $("orderEmail").value.trim());
    window.MTP_applyCheckoutParams?.();
    return result.draftId;
  }

  document.querySelectorAll("#orderLinks input, #orderFeatures input").forEach((input) => input.addEventListener("change", update));

  $("orderReviewBtn").onclick = () => {
    syncMockup();
    const name = $("orderBusinessName");
    const email = $("orderEmail");
    if (!name.value.trim() || !email.value.trim() || !email.checkValidity()) {
      $("orderFormNote").className = "small mt-2 text-center text-danger";
      $("orderFormNote").textContent = "Escribe el nombre de tu negocio y un correo válido.";
      (!name.value.trim() ? name : email).focus();
      return;
    }
    $("orderFormNote").textContent = "";
    const links = checked("#orderLinks");
    const features = checked("#orderFeatures");
    $("orderSummaryBody").innerHTML = `
      <div class="col-md-4"><div class="mt-summary-item"><span>Negocio</span><strong>${escapeHtml(name.value.trim())}</strong></div></div>
      <div class="col-md-4"><div class="mt-summary-item"><span>Paquete</span><strong>${tiers[selectedTier].name} · ${tiers[selectedTier].price}</strong></div></div>
      <div class="col-md-4"><div class="mt-summary-item"><span>Links (${links.length})</span><strong>${escapeHtml(links.join(", ") || "Por definir")}</strong></div></div>
      <div class="col-12"><div class="mt-summary-item"><span>Funciones</span><strong>${escapeHtml(features.join(", ") || "Diseño estándar del paquete")}</strong></div></div>`;
    $("orderSummary").classList.remove("d-none");
    $("orderSummary").scrollIntoView({ behavior: "smooth", block: "center" });
  };

  $("orderEditBtn").onclick = () => { $("orderSummary").classList.add("d-none"); $("orderBusinessName").focus(); };

  $("orderPayBtn").onclick = async (event) => {
    event.preventDefault();
    const button = $("orderPayBtn");
    button.classList.add("disabled");
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Guardando pedido…';
    try {
      const draftId = await saveDraft();
      const ref = sessionStorage.getItem("mitp_ref") || "";
      const checkout = new URL(tiers[selectedTier].checkout);
      checkout.searchParams.set("client_reference_id", [ref && `r.${ref}`, `d.${draftId}`].filter(Boolean).join("_"));
      checkout.searchParams.set("prefilled_email", $("orderEmail").value.trim());
      window.open(checkout.toString(), "_blank", "noopener");
    } catch (_) {
      $("orderFormNote").className = "small mt-2 text-center text-danger";
      $("orderFormNote").textContent = "No pudimos guardar el pedido. Intenta otra vez; todavía no se hizo ningún cobro.";
    } finally {
      button.classList.remove("disabled");
      button.innerHTML = 'Confirmar y pagar en Stripe <i class="bi bi-lock ms-1"></i>';
    }
  };

  document.querySelectorAll("#precios a[data-order-package]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      manualTier = link.dataset.orderPackage;
      syncMockup();
      $("order-config").scrollIntoView({ behavior: "smooth", block: "start" });
    }, true);
  });

  update();
})();
