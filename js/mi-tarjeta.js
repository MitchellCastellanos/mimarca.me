// ============================================================
// MI TARJETA PRO · Interactive builder
// - Toma datos reales del negocio (links, WhatsApp, etc.)
// - Renderiza la vista previa con el MISMO motor y CSS que usan las
//   tarjetas reales (js/negocio.js + negocio/negocio.css), aislado en un
//   iframe srcdoc — no es una plantilla de mentiras, es tu tarjeta con
//   tu info, sin publicar nada todavía.
// - Dynamic QR via api.qrserver.com
// - Watermarked draft result + post-result CTA (propuesta personalizada)
// ============================================================

(function () {
  const $ = (id) => document.getElementById(id);

  const elSlug      = $("mtSlug");
  const elName      = $("mtName");
  const elTagline   = $("mtTagline");
  const elCategory  = $("mtCategory");
  const elWa        = $("mtWa");
  const elInstagram = $("mtInstagram");
  const elMaps      = $("mtMaps");
  const elLogo      = $("mtLogo");
  const elGenerate  = $("mtGenerate");

  const elPhoneEmpty   = $("mtPhoneEmpty");
  const elPhoneLoading = $("mtPhoneLoading");
  const elPhoneResult  = $("mtPhoneResult");
  const elLoadingTitle = $("mtLoadingTitle");
  const elLoadingSub   = $("mtLoadingSub");

  const elResultFrame   = $("mtResultFrame");
  const elResultSlug    = $("mtResultSlug");
  const elResultQR      = $("mtResultQR");
  const elResultQRLayer = $("mtResultQRLayer");
  const elResultCTA     = $("mtResultCTA");
  const elEmail         = $("mtEmail");
  const elProceedBtn    = $("mtProceedBtn");
  const elProceedNote   = $("mtProceedNote");

  if (!elGenerate) return; // not on this page

  function portalApiBase() {
    const meta = document.querySelector('meta[name="mitp-portal-api"]');
    const url = meta && meta.getAttribute('content') && meta.getAttribute('content').trim();
    if (!url || url.indexOf('REPLACE') !== -1) return null;
    return url.replace(/\/$/, '');
  }

  // ----- slug normalization -----
  function slugify(value) {
    return (value || "")
      .toString()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 40);
  }

  // auto-fill slug from name if user hasn't customized
  let slugUserEdited = false;
  elSlug.addEventListener("input", () => {
    slugUserEdited = true;
    elSlug.value = slugify(elSlug.value);
  });
  elName.addEventListener("input", () => {
    if (!slugUserEdited) {
      elSlug.value = slugify(elName.value);
    }
  });

  // ----- logo upload preview -----
  let logoDataURL = null;
  elLogo.addEventListener("change", () => {
    const file = elLogo.files && elLogo.files[0];
    if (!file) { logoDataURL = null; return; }
    if (file.size > 5 * 1024 * 1024) {
      alert("El logo es muy pesado (máx 5MB). Sube una versión más ligera.");
      elLogo.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => { logoDataURL = e.target.result; };
    reader.readAsDataURL(file);
  });

  // ----- categoría -> uno de los temas reales de negocio.css -----
  const THEME_BY_CATEGORY = {
    belleza: "pastel-pink",
    comida: "kraft-taqueria",
    profesional: "navy-corporate",
    universal: "universal-gold",
  };

  // ----- loading copy rotation -----
  const loadingSteps = [
    { t: "Leyendo tus datos...", s: "Nombre, links y logo" },
    { t: "Armando tu tarjeta...", s: "Con el motor real de Mi Tarjeta Pro" },
    { t: "Ajustando tipografía...", s: "Eligiendo combinaciones premium" },
    { t: "Casi listo...", s: "Pasándolo al equipo humano de mimarca" }
  ];

  function runLoadingSequence(onDone) {
    elPhoneEmpty.classList.add("d-none");
    elPhoneResult.classList.add("d-none");
    elPhoneLoading.classList.remove("d-none");
    elResultCTA.classList.add("d-none");

    let i = 0;
    elLoadingTitle.textContent = loadingSteps[0].t;
    elLoadingSub.textContent   = loadingSteps[0].s;

    const interval = setInterval(() => {
      i++;
      if (i >= loadingSteps.length) {
        clearInterval(interval);
        setTimeout(onDone, 500);
        return;
      }
      elLoadingTitle.textContent = loadingSteps[i].t;
      elLoadingSub.textContent   = loadingSteps[i].s;
    }, 800);
  }

  function qrServerUrl(target, px, margin) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${px}x${px}&margin=${margin}&ecc=H&color=111111&bgcolor=FFFFFF&data=${encodeURIComponent(target)}`;
  }

  // ----- arma el mismo objeto de datos que usa una tarjeta real -----
  function buildCardData() {
    const slug = elSlug.value || slugify(elName.value) || "mi-negocio";
    const name = elName.value.trim() || "Tu Negocio";
    const tagline = elTagline.value.trim() || "Tu frase corta aquí";
    const cat = elCategory.value;
    const theme = THEME_BY_CATEGORY[cat] || THEME_BY_CATEGORY.universal;

    const links = [];
    const igRaw = elInstagram.value.trim();
    if (igRaw) {
      const handle = igRaw.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/$/, "");
      const url = /^https?:\/\//i.test(igRaw) ? igRaw : `https://instagram.com/${handle}`;
      links.push({ label: "Instagram", subtitle: handle ? `@${handle}` : "", icon: "instagram", style: "ig", url, popular: true });
    }
    const mapsRaw = elMaps.value.trim();
    if (mapsRaw) {
      links.push({ label: "Ubicación", subtitle: "Cómo llegar", icon: "geo-alt-fill", style: "map", url: mapsRaw });
    }

    let primaryCta;
    const waDigits = elWa.value.replace(/[^0-9]/g, "");
    if (waDigits) {
      primaryCta = { label: "WhatsApp", subtitle: "Escríbenos directo", icon: "whatsapp", url: `https://wa.me/${waDigits}` };
    }

    return {
      slug,
      theme,
      language: "es-MX",
      business: { name, tagline, logoUrl: logoDataURL || "" },
      ...(primaryCta ? { primaryCta } : {}),
      links,
      brandCardCopy: "Diseñada a la medida por mimarca.",
      copyright: `© ${new Date().getFullYear()} ${name}`,
    };
  }

  // ----- documento que corre dentro del iframe: mismo motor, mismo CSS -----
  function buildPreviewDocument(data) {
    const json = JSON.stringify(data).replace(/</g, "\\u003c");
    return `<!doctype html>
<html lang="es-MX">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
<link rel="stylesheet" href="/negocio/negocio.css">
</head>
<body data-theme="${data.theme}">
<div id="bizApp"></div>
<script>window.MTP_PREVIEW_DATA = ${json};</script>
<script src="/js/negocio.js"></script>
</body>
</html>`;
  }

  // ----- render result -----
  function renderResult() {
    const data = buildCardData();

    elResultSlug.textContent = data.slug;
    elResultFrame.srcdoc = buildPreviewDocument(data);

    // QR con logo centrado (ECC H + capa; logo = mismo preview que arriba)
    const qrTarget = `https://mimarca.me/?demo=${encodeURIComponent(data.slug)}`;
    elResultQR.src = qrServerUrl(qrTarget, 480, 4);
    if (elResultQRLayer) {
      elResultQRLayer.src = logoDataURL || "";
      elResultQRLayer.style.display = logoDataURL ? "block" : "none";
    }

    elPhoneLoading.classList.add("d-none");
    elPhoneResult.classList.remove("d-none");
    elResultCTA.classList.remove("d-none");

    // smooth scroll to CTA on mobile
    if (window.innerWidth < 992) {
      elResultCTA.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // ----- generate button -----
  elGenerate.addEventListener("click", (e) => {
    e.preventDefault();

    // basic validation
    if (!elName.value.trim()) {
      elName.focus();
      elName.classList.add("is-invalid");
      setTimeout(() => elName.classList.remove("is-invalid"), 1200);
      return;
    }
    if (!elSlug.value.trim()) {
      elSlug.value = slugify(elName.value);
    }

    runLoadingSequence(renderResult);
  });

  // ----- nice-to-have: enter key submits -----
  [elName, elTagline, elSlug, elWa, elInstagram, elMaps].forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); elGenerate.click(); }
    });
  });

  // ----- "Pedir mi tarjeta a la medida": guarda el borrador y avanza a #precios -----
  if (elProceedBtn) {
    elProceedBtn.addEventListener("click", async () => {
      const email = (elEmail.value || "").trim();
      if (!email || !elEmail.checkValidity()) {
        elEmail.classList.add("is-invalid");
        elEmail.focus();
        setTimeout(() => elEmail.classList.remove("is-invalid"), 1500);
        return;
      }

      elProceedBtn.disabled = true;
      const origLabel = elProceedBtn.innerHTML;
      elProceedBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Guardando…';

      const apiBase = portalApiBase();
      if (apiBase) {
        try {
          const res = await fetch(`${apiBase}/draft`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, data: buildCardData() }),
          });
          if (res.ok) {
            const { draftId } = await res.json();
            if (draftId) {
              try {
                sessionStorage.setItem("mitp_draft_id", draftId);
                sessionStorage.setItem("mitp_draft_email", email);
              } catch { /* sessionStorage no disponible, seguimos igual */ }
            }
          }
        } catch {
          // si falla el guardado no bloqueamos al cliente — sigue a pagar igual,
          // solo no llegará prellenado a gracias.html.
        }
        // aplica los nuevos parámetros (client_reference_id/prefilled_email) a
        // los links de Stripe antes de que el cliente les dé clic.
        if (typeof window.MTP_applyCheckoutParams === "function") {
          window.MTP_applyCheckoutParams();
        }
      }

      elProceedBtn.disabled = false;
      elProceedBtn.innerHTML = origLabel;
      if (elProceedNote && !apiBase) {
        elProceedNote.textContent = "";
      }
      document.getElementById("precios")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
})();
