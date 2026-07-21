# Pendientes — mini-portal de cliente y slug directo

Contexto: slug público `mimarca.me/<slug>` + mini-portal en `mi-cuenta/`.
Worker: `https://mimarca-stripe-webhook.mimarca.workers.dev`

## Parte 1 — Infra (cerrada 2026-07-20)

1. **Resend**: [x] dominio `mimarca.me` verificado; `FROM_EMAIL` =
   `mimarca <pedidos@mimarca.me>`.
2. **Cloudflare Worker**: [x] secrets, R2 `mimarca-portal-uploads` +
   `uploads.mimarca.me`, deploy.
3. **Stripe**: [x] webhook live `checkout.session.completed`.
4. **`mi-cuenta` meta `mitp-portal-api`**: [x] URL del worker.
5. **Umami**: opcional, sin cambios.
6. **Clientes**: secretos en KV (ver Parte 2); `orderStage` sigue en el JSON.
7. **`.nojekyll`**: [x] Pages sirve `negocio/_data/`.

## Parte 2 — Producto/código

1. **Referidos con tracking real**: [x] (2026-07-20)
   - Código único por cliente en KV (`secrets:<slug>.referralCode` +
     `ref:<CODE>`).
   - Link de share: `mimarca.me/?ref=CODE` (`js/ref-capture.js` lo pega a
     Payment Links como `client_reference_id`).
   - Webhook registra redención en KV y avisa al referidor + owner
     (`emails/referral-reward.html`).
2. **Seguridad del panel**: [x] (2026-07-20)
   - `ownerEmail` / `ownerToken` / `referralCode` salieron del JSON público.
   - Viven en KV `PORTAL_KV` (`secrets:<slug>`).
   - `POST /session` valida el token y devuelve datos sin secretos;
     `mi-cuenta.js` ya no confía en el JSON público para auth.
3. **Rate limiting en `/access`**: [x] (2026-07-20) — máx 5 / hora / IP vía KV
   (`rl:access:<ip>`). Sigue respondiendo `{ok:true}` (no filtra info).
4. **Panel de admin mínimo**: [x] (2026-07-20) — `admin/index.html`
   (secret en sessionStorage; botones published / change-received).
5. **Fase 2 del portal** (autoedición limitada): [ ] diferida a propósito —
   implica mover datos editables a D1/KV y un form validado contra el schema.
   No bloquea el portal actual; abrir cuando haya demanda real de clientes.
6. **Galería con marca equivocada**: [ ] sigue pendiente — se intentó
   cambiar a los SVG placeholder de `images/mi-tarjeta/mockups/*.svg`, pero
   son wireframes genéricos (mucho más feos que los mockups reales), así
   que se revirtió a los `.png` originales. Esos `.png` siguen mostrando
   `gabansolutions.ca/negocio/...` en el pie de foto — hace falta diseño
   nuevo (no es un fix de código), o al menos generar mockups nuevos con
   marca correcta antes de tocar esto de nuevo.
7. **`site.webmanifest`**: [x] (2026-07-20) — rutas `/images/...` + íconos
   192/512/maskable generados desde `apple-touch-icon.png`.

## Parte 3 — Builder real + captura de correo antes de pagar (2026-07-21)

Decisión tomada con Mitchell: no pedir login antes de pagar (fricción en el
peor momento) — solo el correo, como parte del mismo formulario que ya
iban a llenar. La "cuenta" de verdad (ver todas sus tarjetas) queda como
fase aparte, reusando el magic link ya construido pero agregando por
correo. Las solicitudes de cambio se quedan por tarjeta específica, no a
nivel cuenta (confirmado).

Lo que sí se construyó ahora:

1. **Builder con datos reales**: [x] — el mockup de `index.html` ya usa el
   mismo motor (`js/negocio.js` + `negocio.css`, en iframe aislado) con
   WhatsApp/Instagram/Maps/logo reales, no una tarjeta de mentiras.
2. **Captura de correo + borrador antes de pagar**: [x] — al dar clic en
   "Pedir mi tarjeta a la medida", `js/mi-tarjeta.js` pide el correo y
   guarda el borrador (`POST /draft`, KV con TTL 30 días).
3. **`client_reference_id` combinado**: [x] — `js/ref-capture.js` mete
   referido + draftId juntos (`r.<CODE>_d.<draftId>`); `parseClientReferenceId`
   en `portal.js` los separa y sigue leyendo links viejos sin prefijo.
4. **Webhook enriquecido**: [x] — la alerta al owner ya trae el negocio y
   links del borrador (filas nuevas en `payment-alert.html`); se guarda
   `session_id → draftId` para que `gracias.html` encuentre su borrador
   sin depender del correo.
5. **Recap en `gracias.html`**: [x] — caja "ya tenemos esto" arriba del
   formulario de Tally, vía `GET /draft-by-session/:sessionId`.
6. **Semilla de cuenta multi-negocio**: [x] pero **sin UI todavía** — cada
   pago deja una entrada en KV `orders:<email>`. Falta: el dashboard que
   liste todas las tarjetas de un correo (fase aparte, abrir cuando haya
   demanda de clientes con más de un negocio).

**Pendiente manual para que esto funcione en producción:**
- Agregar el meta `mitp-portal-api` (ya con la URL real del worker, la
  misma que ya está en `mi-cuenta/index.html`) en `index.html` y
  `gracias.html` — hoy ambos tienen el placeholder `REPLACE-PORTAL_API_BASE_URL`.
  Mientras sigan así, el checkout funciona exactamente igual que antes,
  nomás sin guardar el borrador ni mostrar el recap.
- No requiere ningún recurso nuevo de Cloudflare — reusa el mismo
  `PORTAL_KV` que ya existe.

Detalle técnico completo: `workers/stripe-webhook/README.md` (sección
"Borrador antes de pagar") y `SELF-SERVE-ORDERS.md` (sección 8).

### Operación: alta de cliente (secretos)

```bash
cd workers/stripe-webhook
# secrets:<slug>
npx wrangler kv key put "secrets:SLUG" --remote --path=secrets.json
# ref:CODIGO  →  {"slug":"SLUG"}
npx wrangler kv key put "ref:CODIGO" --remote --path=ref.json
```

`secrets.json` ejemplo:
`{"ownerEmail":"cliente@correo.com","ownerToken":"token-unico","referralCode":"ABC12XY"}`

Detalle técnico: `workers/stripe-webhook/README.md`.
