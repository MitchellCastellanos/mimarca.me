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
6. **Galería con marca equivocada**: [x] (2026-07-20) — `index.html` usa los
   SVG de `images/mi-tarjeta/mockups/*.svg` (pie `mimarca.me` / “Diseñado por
   mimarca”). Los PNG con GABAN quedan en el repo por si se quieren como
   referencia, pero ya no se muestran.
7. **`site.webmanifest`**: [x] (2026-07-20) — rutas `/images/...` + íconos
   192/512/maskable generados desde `apple-touch-icon.png`.

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
