// ============================================================
// Mi Tarjeta Pro · cableado de tarjetas HECHAS A MANO
//
// Para páginas artesanales (ej. /rcr-barbershop/) que NO usan el motor
// JSON (js/negocio.js) pero sí quieren que el cliente pueda editar sus
// links desde mi-cuenta ("Tus links"). La página declara:
//
//   <meta name="mitp-portal-api" content="https://...workers.dev">
//   <meta name="mitp-slug" content="rcr-barbershop">
//   <main data-mitp-links> ...links hardcodeados (fallback)... </main>
//   <template data-mitp-link-template>
//     <a class="link-btn" target="_blank" rel="noopener">
//       <span data-mitp="icon">...</span>
//       <span data-mitp="label"></span>
//       ...
//     </a>
//   </template>
//   <script src="../js/wire-card.js" defer></script>
//
// Este script pide GET /card-links/<slug> al Worker. Solo si el cliente
// ya editó sus links (existe override en KV), reemplaza el contenido de
// [data-mitp-links] clonando el <template> — que vive en la propia
// página, con SU markup y SU CSS, así el diseño artesanal no se pierde.
// Si el Worker está caído, no hay override, o falta cualquier pieza,
// no toca nada: se queda el HTML tal cual se diseñó.
//
// Icono y clase de color se infieren del dominio de la URL (el cliente
// solo captura nombre + URL en el panel). Una página puede redefinir el
// mapa con window.MITP_ICON_MAP antes de cargar este script (los `cls`
// deben existir en su propio CSS; `icon` es una clase de Font Awesome).
// ============================================================

(function () {
  var apiMeta = document.querySelector('meta[name="mitp-portal-api"]');
  var slugMeta = document.querySelector('meta[name="mitp-slug"]');
  var container = document.querySelector('[data-mitp-links]');
  var template = document.querySelector('template[data-mitp-link-template]');
  if (!apiMeta || !slugMeta || !container || !template || !template.content) return;

  var apiBase = (apiMeta.getAttribute('content') || '').trim().replace(/\/$/, '');
  var slug = (slugMeta.getAttribute('content') || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!apiBase || apiBase.indexOf('REPLACE') !== -1 || !slug) return;

  // Estilos ya conocidos por su `style` guardado (el que trae el JSON
  // sombra desde el inicio) — así un link que el cliente nunca tocó
  // conserva su clase/color exactos aunque la URL coincida con otro tipo
  // (ej. "Agendar Cita" también es wa.me, pero no debe verse como
  // WhatsApp). Solo se infiere por URL cuando el link es nuevo (sin
  // `style`, ej. agregado desde "Tus links").
  var STYLE_BY_NAME = window.MITP_STYLE_MAP || {
    whatsapp: { cls: 'whatsapp', icon: 'fab fa-whatsapp' },
    instagram: { cls: 'instagram', icon: 'fab fa-instagram' },
    facebook: { cls: 'facebook', icon: 'fab fa-facebook-f' },
    appointment: { cls: 'appointment', icon: 'fas fa-calendar-check' },
    website: { cls: 'website', icon: 'fas fa-globe' },
    location: { cls: 'location', icon: 'fas fa-map-marker-alt' },
  };

  var ICON_MAP = window.MITP_ICON_MAP || [
    { re: /wa\.me|whatsapp/i, cls: 'whatsapp', icon: 'fab fa-whatsapp' },
    { re: /instagram\.com/i, cls: 'instagram', icon: 'fab fa-instagram' },
    { re: /facebook\.com|fb\.com|fb\.me/i, cls: 'facebook', icon: 'fab fa-facebook-f' },
    { re: /tiktok\.com/i, cls: 'website', icon: 'fab fa-tiktok' },
    { re: /maps\.google|goo\.gl\/maps|maps\.app/i, cls: 'location', icon: 'fas fa-map-marker-alt' },
    { re: /tel:/i, cls: 'website', icon: 'fas fa-phone' },
    { re: /mailto:/i, cls: 'website', icon: 'fas fa-envelope' },
  ];
  var DEFAULT_STYLE = { cls: 'website', icon: 'fas fa-globe' };

  function styleFor(link) {
    var known = STYLE_BY_NAME[String(link.style || '').trim().toLowerCase()];
    if (known) return known;
    var url = String(link.url || '');
    for (var i = 0; i < ICON_MAP.length; i++) {
      if (ICON_MAP[i].re.test(url)) return ICON_MAP[i];
    }
    return DEFAULT_STYLE;
  }

  function renderLinks(links) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (!link || !link.url || !link.label) continue;

      var node = template.content.firstElementChild.cloneNode(true);
      var root = node.matches('a') ? node : node.querySelector('a');
      if (!root) continue;

      var style = styleFor(link);
      root.href = link.url;
      root.classList.add(style.cls);

      var labelEl = node.querySelector('[data-mitp="label"]');
      if (labelEl) labelEl.textContent = link.label;

      var iconEl = node.querySelector('[data-mitp="icon"]');
      if (iconEl) {
        var icon = document.createElement('i');
        icon.className = style.icon;
        iconEl.textContent = '';
        iconEl.appendChild(icon);
      }

      var subtitleEl = node.querySelector('[data-mitp="subtitle"]');
      if (subtitleEl) {
        if (link.subtitle) subtitleEl.textContent = link.subtitle;
        else subtitleEl.remove();
      }

      frag.appendChild(node);
    }

    if (!frag.childNodes.length) return; // nunca dejar la sección vacía
    container.innerHTML = '';
    container.appendChild(frag);
  }

  fetch(apiBase + '/card-links/' + encodeURIComponent(slug), { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (body) {
      if (body && Array.isArray(body.links) && body.links.length) renderLinks(body.links);
    })
    .catch(function () { /* sin red o sin override: se queda el HTML artesanal */ });
})();
