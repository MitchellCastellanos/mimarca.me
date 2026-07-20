# Worker de backend — Mi Tarjeta Pro

Cloudflare Worker que le da backend al sitio estático. Atiende dos familias de
rutas por pathname (mismo Worker, mismo deploy):

- `POST /` — webhook de Stripe: recibe `checkout.session.completed`, valida la
  firma, y manda `emails/order-confirmation.html` al cliente y
  `emails/payment-alert.html` al owner vía [Resend](https://resend.com).
- Rutas del **portal de cliente** (`mi-cuenta/`), todas también por Resend:
  - `POST /access` — magic link. `{slug, email}` → si coincide con
    `ownerEmail` en `negocio/_data/<slug>.json`, reenvía el link de
    `mi-cuenta` (`emails/access-link.html`). Responde `{ok:true}` siempre,
    exista o no la combinación, para no filtrar qué correos están registrados.
  - `POST /upload` — logo/fotos del cliente. `multipart/form-data` con
    `slug`, `token` (su `ownerToken`) y `file`. Sube a R2 y avisa al owner
    (`emails/asset-uploaded.html`) para que lo aplique a mano — el cliente
    nunca edita el JSON directamente.
  - `POST /notify/approved` — el cliente aprueba su diseño en revisión desde
    `mi-cuenta` (auth con `slug`+`token`). Avisa al owner
    (`emails/design-approved-alert.html`).
  - `POST /notify/published` / `POST /notify/change-received` — el equipo las
    dispara a mano (curl/Postman) con el header `X-Admin-Secret` para avisarle
    al cliente que ya está publicada o que ya se recibió su solicitud de
    cambios. No hay panel de admin todavía.

El sitio principal sigue siendo 100% estático en GitHub Pages; este Worker es
el único backend y vive aparte, en Cloudflare. Las rutas del portal leen
`negocio/_data/<slug>.json` directo del sitio en vivo (es público) en vez de
tener su propia base de datos — el único estado propio del Worker es el
bucket R2 de `/upload`.

## Deploy

```bash
cd workers/stripe-webhook
npm install
npx wrangler login                 # primera vez
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ADMIN_SECRET       # para /notify/published y /notify/change-received
npx wrangler r2 bucket create mimarca-portal-uploads   # para /upload (logo/fotos)
npx wrangler deploy
```

El deploy imprime la URL pública, p. ej.
`https://mimarca-stripe-webhook.<subdominio>.workers.dev`. Esa es la URL que
va en:
- Stripe Dashboard → el endpoint del webhook (ver abajo), apuntando a la raíz.
- `mi-cuenta/index.html` → meta `mitp-portal-api` (reemplazar el placeholder
  `REPLACE-PORTAL_API_BASE_URL`), para que `js/mi-cuenta.js` sepa a dónde
  pegarle con `/access`, `/upload` y `/notify/approved`.

Luego, en el [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks):
crear un endpoint apuntando a esa URL (raíz, sin path extra), suscrito solo al
evento `checkout.session.completed`, y copiar su signing secret (`whsec_...`)
al secret `STRIPE_WEBHOOK_SECRET` del Worker.

En Resend: verificar el dominio `mimarca.me` para poder mandar desde
`pedidos@mimarca.me` (o ajustar `FROM_EMAIL` en `wrangler.toml`).

### R2 (logos/fotos de clientes)

1. `npx wrangler r2 bucket create mimarca-portal-uploads` (o el nombre que
   pusiste en `wrangler.toml`).
2. Habilita acceso público al bucket (o cuélgale un dominio propio, p. ej.
   `uploads.mimarca.me`) desde el dashboard de Cloudflare → R2 → el bucket →
   Settings.
3. Pon esa URL pública en `R2_PUBLIC_BASE_URL` (`wrangler.toml` o
   `.dev.vars` en local).

Mientras esto no esté configurado, `/upload` responde `503` y el botón de
subir logo/fotos en `mi-cuenta` cae automáticamente al fallback de WhatsApp
— no rompe nada, solo no está disponible todavía.

### Por cliente nuevo

Cuando el equipo publica una tarjeta nueva en `negocio/_data/<slug>.json`,
además de `ownerToken` hay que llenar `ownerEmail` (el correo del cliente) y
`orderStage` (arranca en `"designing"` o `"review"`, y se cambia a
`"published"` cuando sale en vivo) — sin esto, el magic link (`/access`) y el
stepper de estatus en `mi-cuenta` no funcionan para ese cliente.

## Desarrollo y pruebas locales

```bash
# Terminal 1 — el worker local (lee secretos de .dev.vars, ver .env.example)
npx wrangler dev

# Terminal 2 — reenviar eventos de Stripe al worker local
stripe listen --forward-to localhost:8787
# copia el whsec_... que imprime a .dev.vars como STRIPE_WEBHOOK_SECRET

# Terminal 3 — disparar un evento de prueba
stripe trigger checkout.session.completed
```

También puedes pagar de verdad en modo test: abre el Payment Link de prueba
(los links `buy.stripe.com/test_...` de `index.html`) y paga con la tarjeta
`4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC.

Para probar las rutas del portal en local (con el worker corriendo en
`localhost:8787`):

```bash
# Magic link
curl -X POST localhost:8787/access -H 'content-type: application/json' \
  -d '{"slug":"test-client","email":"test-client-ci@mimarca.me"}'

# Aviso de tarjeta publicada (requiere ADMIN_SECRET en .dev.vars)
curl -X POST localhost:8787/notify/published -H 'content-type: application/json' \
  -H 'X-Admin-Secret: tu-admin-secret' -d '{"slug":"test-client"}'
```

## Variables de entorno

Ver `.env.example`. Resumen: `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY` y
`ADMIN_SECRET` son secretos (`wrangler secret put`); `OWNER_ALERT_EMAIL`,
`FROM_EMAIL`, `SUPPORT_EMAIL` y `R2_PUBLIC_BASE_URL` son vars públicas en
`wrangler.toml`. El binding `PORTAL_UPLOADS` (R2) se declara en
`wrangler.toml` — ver sección R2 arriba.
