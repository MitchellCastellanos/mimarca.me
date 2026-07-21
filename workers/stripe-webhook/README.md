# Worker de backend — Mi Tarjeta Pro

Cloudflare Worker que le da backend al sitio estático.

## Rutas

- `POST /` — webhook Stripe (`checkout.session.completed`) → correos de
  pedido + tracking de referidos y de borrador si viene `client_reference_id`.
- `POST /access` — magic link `{slug,email}` (rate-limit 5/h/IP). Secretos en KV.
- `POST /session` — `{slug,token}` → datos públicos + `referralCode` (sin
  `ownerToken`/`ownerEmail`).
- `POST /draft` — `{email,data}` → guarda el borrador del builder (antes de
  pagar) en KV con TTL de 30 días, regresa `{draftId}`. Ver "Borrador" abajo.
- `GET /draft/:id` — lee un borrador por su id.
- `GET /draft-by-session/:sessionId` — igual, pero buscando por el
  `session_id` de Stripe (lo que trae `gracias.html` en la URL justo
  después de pagar — no conoce el `draftId` directo).
- `POST /upload` — logo/fotos → R2 + aviso al owner.
- `POST /notify/approved` — cliente aprueba diseño.
- `POST /notify/published` / `POST /notify/change-received` — admin
  (`X-Admin-Secret`). UI: `/admin/`.
- `POST /account/register` / `POST /account/login` — `{email,password}` →
  `{sessionToken}`. Ver "Cuentas" abajo.
- `POST /account/logout` — `{sessionToken}` → la invalida.
- `POST /account/request-reset` — `{email}` → correo con link de reset
  (siempre `{ok:true}`, no filtra si el correo existe).
- `POST /account/reset-password` — `{token,password}` → nueva contraseña.
- `POST /account/me` — `{sessionToken}` → correo + `orders:<email>` (el
  Dashboard de `mi-cuenta/cuenta.html`).

## Estado

| Recurso | Uso |
|---------|-----|
| JSON `negocio/_data/<slug>.json` | Datos públicos de la tarjeta (`orderStage`, negocio, etc.) |
| KV `PORTAL_KV` | `secrets:<slug>`, `ref:<CODE>`, `redeem:*`, `rl:access:*`, `draft:<id>`, `session-draft:<sessionId>`, `orders:<email>`, `account:<email>`, `account-session:<token>`, `account-reset:<token>` |
| R2 `PORTAL_UPLOADS` | Archivos de `/upload` → `https://uploads.mimarca.me/...` |

## Cuentas (correo + contraseña) — `mi-cuenta/cuenta.html`

Aparte del acceso sin password por tarjeta (`mi-cuenta/index.html`, con el
`ownerToken` de cada slug — eso no cambió), esto es una cuenta de verdad
para ver el Dashboard de pedidos de un mismo correo (`src/account.js`):

- Password con **PBKDF2-SHA256** (100,000 iteraciones, salt aleatorio por
  cuenta) vía Web Crypto — nativo en el runtime de Workers, sin
  dependencias (bcrypt/scrypt no corren ahí sin WASM).
- Sesión = token opaco en KV (`account-session:<token>`, 60 días), no
  cookie — el sitio (`mimarca.me`) y el Worker (`*.workers.dev`) son
  dominios distintos, así que el cliente lo guarda en `localStorage` y lo
  manda como cualquier otro token (igual que `ownerToken`).
- Reset: `account-reset:<token>` en KV, 1 hora, un solo uso.
- `/account/login` y `/account/request-reset` tienen rate-limit (10/h y
  5/h por IP) reusando `rateLimitBucket` de `portal.js`.
- El Dashboard lee `orders:<email>` (la misma lista que siembra el webhook
  desde la Fase A del borrador) — si está vacía, `mi-cuenta/cuenta.html`
  muestra el estado vacío con el botón "+ Comprar mi primera tarjeta".

**Limitación conocida**: un reset de contraseña no invalida las sesiones
ya emitidas (no se llevan registradas por cuenta, solo por token) — si un
token de sesión ya se filtró, sigue funcionando después de un reset. Para
el volumen actual es un riesgo aceptable; si esto crece, vale la pena
llevar una lista de sesiones por cuenta para poder revocarlas todas.

## Borrador antes de pagar (builder → checkout → gracias.html)

El "borrador" NO es el mockup (theme, foto de cover, tarjeta renderizada
en el iframe) — eso es puro gancho visual y se descarta en cuanto hace la
orden. Lo único que se guarda es lo que llenó en la forma
(`buildIntakeData()` en `js/mi-tarjeta.js`): `businessName`, `tagline`,
`category`, `whatsapp`, `instagram`, `maps`, `logoDataUrl`, `slugPreference`.

1. En `index.html`, con un correo válido, se guarda ese borrador
   (`POST /draft`) en dos momentos — al dar clic en "Pedir mi tarjeta a la
   medida" (CTA post-mockup), **y también** al dar clic directo en un
   botón de paquete en `#precios` (por si se saltó el CTA de arriba).
   `js/mi-tarjeta.js` guarda el `draftId` + correo en `sessionStorage`.
2. `js/ref-capture.js` (ahora también hace esto, no solo referidos) mete
   ese `draftId` en `client_reference_id` de los links de Stripe —
   combinado con el código de referido si también hay uno, como
   `r.<CODE>_d.<draftId>` (`parseClientReferenceId` en `portal.js` separa
   los dos, y sigue leyendo bien los links viejos sin el prefijo) — y el
   correo en `prefilled_email`.
3. El webhook, al recibir el pago, busca el borrador, lo mete en la fila
   "borrador" de la alerta al owner (`emails/payment-alert.html`), agrega
   `?draft=` a `onboarding_url` (el link del correo de confirmación al
   cliente), y guarda el mapeo `session_id → draftId` para que
   `gracias.html` lo encuentre aunque el cliente no espere el correo.
4. `gracias.html` llama `GET /draft-by-session/:sessionId` y muestra una
   cajita "ya tenemos esto" arriba del formulario de Tally.
5. También queda una entrada en `orders:<email>` (KV) por cada pago — es
   la semilla de la futura cuenta multi-negocio, todavía sin UI. Cuando el
   equipo publique la tarjeta y cree su `secrets:<slug>`, conviene ir a
   editar esa entrada a mano para dejar el `slug` correspondiente (campo
   `slug: null` por ahora) — no es obligatorio, solo ayuda a no perder el
   historial cuando se construya el dashboard.

Sin `PORTAL_KV` o sin el meta `mitp-portal-api` configurado en `index.html`
/ `gracias.html`, todo esto se salta solo — el checkout sigue funcionando
exactamente igual que antes, nomás sin el borrador ni el recap.

## Deploy

```bash
cd workers/stripe-webhook
npm install
npx wrangler login
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ADMIN_SECRET
npx wrangler r2 bucket create mimarca-portal-uploads   # si no existe
npx wrangler deploy
```

URL actual: `https://mimarca-stripe-webhook.mimarca.workers.dev`

### Alta de cliente (KV)

```bash
# secrets.json → {"ownerEmail":"...","ownerToken":"...","referralCode":"ABC12XY"}
npx wrangler kv key put "secrets:SLUG" --remote --path=secrets.json
# ref.json → {"slug":"SLUG"}
npx wrangler kv key put "ref:ABC12XY" --remote --path=ref.json
```

Namespace id (ver `wrangler.toml`): `5936a9510e2d4b4e88c7bd6ba720763d`.

### Referidos

1. El cliente comparte `https://mimarca.me/?ref=CODIGO` desde mi-cuenta.
2. `js/ref-capture.js` guarda el código y lo añade a los Payment Links como
   `client_reference_id`.
3. El webhook registra la redención y manda `emails/referral-reward.html`.

## Pruebas

```bash
node --test
npx wrangler deploy

curl -X POST https://mimarca-stripe-webhook.mimarca.workers.dev/session \
  -H 'content-type: application/json' \
  -d '{"slug":"test-client","token":"test-client-ci-placeholder"}'

curl -X POST https://mimarca-stripe-webhook.mimarca.workers.dev/access \
  -H 'content-type: application/json' \
  -d '{"slug":"test-client","email":"test-client-ci@mimarca.me"}'

# Borrador
curl -X POST https://mimarca-stripe-webhook.mimarca.workers.dev/draft \
  -H 'content-type: application/json' \
  -d '{"email":"prueba@mimarca.me","data":{"business":{"name":"Prueba"}}}'
# -> {"ok":true,"draftId":"..."}
curl https://mimarca-stripe-webhook.mimarca.workers.dev/draft/<draftId-de-arriba>

# Cuentas
curl -X POST https://mimarca-stripe-webhook.mimarca.workers.dev/account/register \
  -H 'content-type: application/json' \
  -d '{"email":"prueba@mimarca.me","password":"algo-largo-123"}'
# -> {"ok":true,"sessionToken":"..."}
curl -X POST https://mimarca-stripe-webhook.mimarca.workers.dev/account/me \
  -H 'content-type: application/json' \
  -d '{"sessionToken":"<el-de-arriba>"}'
```

Vars/secrets: ver `.env.example` y `wrangler.toml`.
