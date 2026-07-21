// ============================================================
// MI TARJETA PRO · Interactive mockup builder
// - Slug normalization
// - Logo preview
// - Loading "AI looking for best design" experience
// - Live mockup preview (phone frame)
// - Dynamic QR via api.qrserver.com
// - Watermarked demo result + post-result CTA
// ============================================================

(function () {
  const $ = (id) => document.getElementById(id);

  const elSlug      = $("mtSlug");
  const elName      = $("mtName");
  const elTagline   = $("mtTagline");
  const elCategory  = $("mtCategory");
  const elLogo      = $("mtLogo");
  const elGenerate  = $("mtGenerate");

  const elPhoneEmpty   = $("mtPhoneEmpty");
  const elPhoneLoading = $("mtPhoneLoading");
  const elPhoneResult  = $("mtPhoneResult");
  const elLoadingTitle = $("mtLoadingTitle");
  const elLoadingSub   = $("mtLoadingSub");

  const elResultCard    = $("mtResultCard");
  const elResultLogo    = $("mtResultLogo");
  const elResultName    = $("mtResultName");
  const elResultTagline = $("mtResultTagline");
  const elResultSlug    = $("mtResultSlug");
  const elResultQR      = $("mtResultQR");
  const elResultQRLayer = $("mtResultQRLayer");
  const elResultCTA     = $("mtResultCTA");

  if (!elGenerate) return; // not on this page

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

  // ----- category palette presets -----
  const palettes = {
    belleza: {
      bg: "linear-gradient(160deg, #0a0a0a 0%, #181410 100%)",
      text: "#f3f1ea",
      accent: "#d4b86a",
      btn: "linear-gradient(180deg,#f0d98a,#d4b86a,#b8973f)",
      font: "'Cormorant Garamond', serif"
    },
    comida: {
      bg: "linear-gradient(160deg, #2a140a 0%, #4a1f0e 100%)",
      text: "#fff2e1",
      accent: "#ffb347",
      btn: "linear-gradient(180deg,#ffd27a,#ffa133,#cc7a14)",
      font: "'Inter', sans-serif"
    },
    profesional: {
      bg: "linear-gradient(160deg, #0a1a2a 0%, #14243a 100%)",
      text: "#eef3fa",
      accent: "#6ab0ff",
      btn: "linear-gradient(180deg,#a8cdff,#6ab0ff,#3e85d4)",
      font: "'Inter', sans-serif"
    },
    universal: {
      bg: "linear-gradient(160deg, #111 0%, #1d1d1d 100%)",
      text: "#f3f3f3",
      accent: "#c9a227",
      btn: "linear-gradient(180deg,#e8c95e,#c9a227,#8d7016)",
      font: "'Inter', sans-serif"
    }
  };

  function applyPalette(cat) {
    const p = palettes[cat] || palettes.universal;
    elResultCard.style.background = p.bg;
    elResultCard.style.color = p.text;
    elResultCard.style.fontFamily = p.font;
    elResultCard.style.borderColor = p.accent + "44";
    elResultCard.style.setProperty("--mt-accent", p.accent);
    elResultCard.style.setProperty("--mt-btn-bg", p.btn);
    elResultCard.style.setProperty("--mt-text", p.text);
  }

  // ----- structural layout per category (hero composition) -----
  const LAYOUT_CLASSES = ["layout-food", "layout-corporate", "layout-belleza", "layout-universal"];
  const layoutByCat = {
    comida: "layout-food",
    profesional: "layout-corporate",
    belleza: "layout-belleza",
    universal: "layout-universal"
  };

  function applyLayout(cat) {
    elResultCard.classList.remove(...LAYOUT_CLASSES);
    elResultCard.classList.add(layoutByCat[cat] || "layout-universal");
  }

  // ----- dummy button copy per category -----
  const ctaCopy = {
    belleza: [
      { icon: "bi-card-list", text: "Lista de Servicios" },
      { icon: "bi-calendar2-check", text: "Reservar Cita" },
      { icon: "bi-gift", text: "Promociones" },
      { icon: "bi-whatsapp", text: "Escríbenos" }
    ],
    comida: [
      { icon: "bi-card-list", text: "Ver Menú" },
      { icon: "bi-bag-check", text: "Hacer Pedido" },
      { icon: "bi-calendar2-check", text: "Reservar Mesa" },
      { icon: "bi-whatsapp", text: "Escríbenos" }
    ],
    profesional: [
      { icon: "bi-calendar2-check", text: "Agendar Asesoría" },
      { icon: "bi-briefcase", text: "Áreas de Práctica" },
      { icon: "bi-file-earmark-arrow-down", text: "Descargar CV" },
      { icon: "bi-whatsapp", text: "Escríbenos" }
    ],
    universal: [
      { icon: "bi-whatsapp", text: "WhatsApp" },
      { icon: "bi-instagram", text: "Instagram" },
      { icon: "bi-geo-alt", text: "Cómo llegar" },
      { icon: "bi-star", text: "Deja tu reseña" }
    ]
  };

  function applyCtaCopy(cat) {
    const items = ctaCopy[cat] || ctaCopy.universal;
    items.forEach((item, i) => {
      const icon = $(`mtBtn${i + 1}Icon`);
      const text = $(`mtBtn${i + 1}Text`);
      if (icon) icon.className = `bi ${item.icon}`;
      if (text) text.textContent = item.text;
    });
  }

  // ----- loading copy rotation -----
  const loadingSteps = [
    { t: "Analizando tu logo...", s: "Detectando colores dominantes" },
    { t: "Buscando el mejor diseño...", s: "Probando plantillas para tu giro" },
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

  // ----- render result -----
  function renderResult() {
    const slug = elSlug.value || slugify(elName.value) || "mi-negocio";
    const name = elName.value.trim() || "Tu Negocio";
    const tagline = elTagline.value.trim() || "Tu frase corta aquí";
    const cat = elCategory.value;

    applyPalette(cat);
    applyLayout(cat);
    applyCtaCopy(cat);

    elResultName.textContent    = name;
    elResultTagline.textContent = tagline;
    elResultSlug.textContent    = slug;

    if (logoDataURL) {
      elResultLogo.src = logoDataURL;
      elResultLogo.style.display = "block";
    } else {
      // initials fallback
      const initials = name.split(/\s+/).map(w => w[0]).join("").slice(0,2).toUpperCase() || "MN";
      elResultLogo.src = "data:image/svg+xml;utf8," + encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>
          <rect width='100' height='100' rx='50' fill='#1a1a1a' stroke='#d4b86a' stroke-width='2'/>
          <text x='50' y='62' text-anchor='middle' font-family='Cormorant Garamond, serif'
                font-size='42' font-weight='700' fill='#d4b86a'>${initials}</text>
        </svg>`);
      elResultLogo.style.display = "block";
    }

    // QR con logo centrado (ECC H + capa; logo = mismo preview que arriba)
    const qrTarget = `https://mimarca.me/?demo=${encodeURIComponent(slug)}`;
    elResultQR.src = qrServerUrl(qrTarget, 480, 4);
    if (elResultQRLayer) {
      elResultQRLayer.src = elResultLogo.src;
      elResultQRLayer.style.display = elResultLogo.style.display === "none" ? "none" : "block";
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
  [elName, elTagline, elSlug].forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); elGenerate.click(); }
    });
  });
})();
