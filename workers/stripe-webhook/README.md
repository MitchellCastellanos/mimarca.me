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
- `PUT /draft/:id` — `{sessionToken,data}` → lo edita (mismo `draftId`,
  conserva `email`/`createdAt`, reinicia TTL). Solo el dueño de la cuenta
  del correo del borrador puede editarlo. Usado por el Dashboard
  (`mi-cuenta/cuenta.html`) mientras el pedido no tiene `slug` — ver
  "Borrador como form" abajo.
- `GET /draft-by-session/:sessionId` — igual, pero buscando por el
  `session_id` de Stripe (lo que trae `gracias.html` en la URL justo
  después de pagar — no conoce el `draftId` directo).
- `POST /upload` — logo/fotos → R2 + aviso al owner.
- `POST /notify/approved` — cliente aprueba diseño.
- `POST /notify/published` / `POST /notify/change-received` — admin
  (`X-Admin-Secret`). UI: `/admin/`.
- `POST /admin/referral/consume` — admin aplica crédito de referido
  `{slug,amountCents,purchaseAmountCents,idempotencyKey,note?}`. Tope 50%
  de la compra, sin saldo negativo, idempotente.
- `POST /referral/validate` — `{code,email}` valida referido antes del
  checkout (existe, no autorreferido, cliente nuevo).
- `GET /card-links/:slug` — links autoeditados del cliente (público, sin
  auth — ya son visibles en la tarjeta en vivo). 404 si nunca los editó
  (el front cae al `links` del JSON estático).
- `PUT /card-links/:slug` — `{token,links}` → el cliente edita sus propios
  links desde `mi-cuenta/index.html`, sin costo ni revisión humana,
  mientras no se pase del cupo de su tier. Ver "Links autoeditados" abajo.
- `POST /account/register` / `POST /account/login` — `{email,password}` →
  `{sessionToken}`. Ver "Cuentas" abajo.
- `POST /account/logout` — `{sessionToken}` → la invalida.
- `POST /account/request-reset` — `{email}` → correo con link de reset
  (siempre `{ok:true}`, no filtra si el correo existe).
- `POST /account/reset-password` — `{token,password}` → nueva contraseña.
- `POST /account/me` — `{sessionToken}` → correo + `orders:<email>` (el
  Dashboard de `mi-cuenta/cuenta.html`). Cada pedido sin `slug` trae su
  `draft` completo para poder editarlo ahí mismo.

## Estado

| Recurso | Uso |
|---------|-----|
| JSON `negocio/_data/<slug>.json` | Datos públicos de la tarjeta (`orderStage`, negocio, etc.) |
| KV `PORTAL_KV` | `secrets:<slug>`, `ref:<CODE>`, `redeem:*`, `rl:access:*`, `draft:<id>`, `session-draft:<sessionId>`, `orders:<email>`, `account:<email>`, `account-session:<token>`, `account-reset:<token>`, `links:<slug>` |
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

### Borrador como "form" (Dashboard, antes de publicar)

Decisión 2026-07-21: en vez de que el borrador sea solo un resumen de
lectura para el equipo, el Dashboard (`mi-cuenta/cuenta.html`) ahora lo
muestra como un formulario editable mientras el pedido no tiene `slug`
todavía (`js/cuenta.js#draftFormHtml`). El cliente puede corregir
`businessName`, `tagline`, `whatsapp`, `instagram`, `maps` en cualquier
momento — el equipo sigue leyendo el mismo `draft:<id>` en KV para
diseñar, así que ya no depende de que el cliente haya llenado bien la
forma una sola vez. El logo no se edita aquí (no hay endpoint de subida
sin `slug` todavía) — solo se muestra como referencia; para cambiarlo el
cliente sigue escribiendo por WhatsApp mientras tanto.

`PUT /draft/:id` exige sesión de cuenta válida (`sessionToken`) y que el
correo de esa sesión sea el mismo dueño del borrador — conserva
`email`/`createdAt`, solo reemplaza `data` y reinicia el TTL de 30 días.

### Links autoeditados (mi-cuenta, después de publicar)

Decisión 2026-07-21 (ver `PENDIENTES.md`): en vez de que cualquier cambio
a links cueste $25 MXN, el cliente los edita él mismo desde
`mi-cuenta/index.html` ("Tus links") sin costo y sin revisión humana,
mientras no se pase del cupo de su paquete:

| Paquete | Links incluidos |
|---|---|
| Lanzamiento | 3 |
| Personalizado | 6 |
| Premium | 12 |

- El cupo vive en `LINKS_QUOTA_BY_PACKAGE` (`src/portal.js`), resuelto por
  `secrets:<slug>.package` (nuevo campo — ver "Alta de cliente" abajo). Si
  un cliente viejo no tiene `package` guardado, el cupo cae al de
  Personalizado o a lo que ya tenga (lo que sea mayor), para no quitarle
  links que ya tenía.
- Si el cliente ya usó todo su cupo y quiere más, el panel le muestra un
  mensaje para subir de paquete (WhatsApp) — **no** hay pago a la carta
  por link individual (decisión explícita: los links dejan de ser un
  "cambio" cobrable, el upsell es de paquete completo).
- Los links editados se guardan en KV (`links:<slug>`), **no** tocan el
  JSON estático (`negocio/_data/<slug>.json`) — el sitio sigue siendo
  100% estático. `js/negocio.js` en la tarjeta pública hace un `GET
  /card-links/:slug` en paralelo al fetch del JSON y, si existe override,
  lo usa en vez de los links del JSON. Si el Worker está caído o nunca se
  editaron, se ven los del JSON tal cual — no hay downtime nuevo.
- No manda correo al owner (a propósito: el punto es que sea 100%
  self-serve, sin trabajo humano de por medio para cambios dentro del
  cupo).

### Tarjetas hechas a mano (piloto: `/rcr-barbershop/`)

Páginas artesanales (no generadas por `js/negocio.js`) que igual dan
acceso a `mi-cuenta`. No se convierten al motor JSON.

**RCR (kit premium)** usa `data.default.json` + `data-store.js`: carga el
contenido local y mezcla overrides del Worker (`GET /card-links/:slug`,
`GET /card-services/:slug`) sobre los slots del diseño (CTA, Instagram,
Facebook, web, Maps, menú de precios). Sin override, la tarjeta se ve
exactamente como el kit. JSON sombra en `negocio/_data/<slug>.json` solo
alimenta `/session` (panel).

**Otras artesanales simples** pueden seguir el patrón de
`js/wire-card.js` (`data-mitp-links` + `<template data-mitp-link-template>`).

### Precios autoeditados (`/card-services/:slug`)

Misma idea que links, para menús de servicios (piloto premium / handmade):

| Paquete | Cupo de servicios |
|---------|-------------------|
| Lanzamiento | 0 (sin editor) |
| Personalizado | 8 |
| Premium | 20 |

- `GET /card-services/:slug` — público; 404 si nunca editó
- `PUT /card-services/:slug` — `{token,services}` autenticado
- KV: `services:<slug>` → `{services, updatedAt}`
- Panel: bloque "Tus precios" en `mi-cuenta` cuando el cupo > 0 y la
  tarjeta es handmade / premium / ya trae servicios

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
# secrets.json → {"ownerEmail":"...","ownerToken":"...","referralCode":"ABC12XY","package":"personalizado"}
npx wrangler kv key put "secrets:SLUG" --remote --path=secrets.json
# ref.json → {"slug":"SLUG"}
npx wrangler kv key put "ref:ABC12XY" --remote --path=ref.json
```

`package` es nuevo (`lanzamiento` | `personalizado` | `premium`) — define
el cupo de links autoeditables en `mi-cuenta` (ver "Links autoeditados"
arriba). Sin este campo, el cliente cae al cupo de Personalizado por
default.

Namespace id (ver `wrangler.toml`): `5936a9510e2d4b4e88c7bd6ba720763d`.

### Referidos

1. El cliente comparte `https://mimarca.me/?ref=CODIGO` desde mi-cuenta.
2. El formulario muestra el código prellenado, llama `POST /referral/validate`
   y confirma que existe, no es autorreferido y el correo no tiene compras previas.
3. Al abrir Stripe se manda el código único en `client_reference_id` para la
   atribución y `prefilled_promo_code=NUEVO10` para aplicar 10%.
4. El webhook registra la redención **antes** de mandar correos, suma 10% del
   monto pagado como crédito del referidor (con `createdAt`/`expiresAt` a 12
   meses) y manda `emails/referral-reward.html` (best-effort).
5. El panel muestra nombre del comprador o email enmascarado — nunca el correo
   completo. El saldo excluye rewards vencidos y descuenta consumos admin.

Configuración necesaria en Stripe (una sola vez): crear el cupón de 10% y
el promotion code `NUEVO10`, restringido a primera compra, y habilitar códigos
promocionales en los tres Payment Links. El valor puede cambiarse con
`REFERRAL_PROMO_CODE` en `wrangler.toml`. Para que la restricción de primera
compra sea efectiva, los Payment Links deben crear Customer (`customer_creation=always`).

Script live (requiere API key con write): `scripts/setup-referral-stripe.ps1`.

Live (configurado 2026-07-21):
- coupon `Va48cJtA` — 10% once, "Referido nuevo cliente 10%"
- promotion code `promo_1TvjogJGvovZxLExUszuclDT` (`NUEVO10`, first_time_transaction)

Payment Links (live; URLs/precios sin cambio):

| Paquete | Payment Link ID | URL | Promos | Customer |
|---------|-----------------|-----|--------|----------|
| Lanzamiento | `plink_1Tu1a7JGvovZxLExK7euXbnT` | `https://buy.stripe.com/eVqcN67HF1xkdP7gQjgjC00` | on | always |
| Personalizado | `plink_1Tu1a9JGvovZxLExUuRthJ1d` | `https://buy.stripe.com/4gM28s6DB0tgh1j1VpgjC01` | on | always |
| Premium | `plink_1Tu1aBJGvovZxLExDx1juPyz` | `https://buy.stripe.com/5kQcN64vt5NA7qJ7fJgjC02` | on | always |

Test mode (ya creado):
- coupon `DSnjUVps`
- promotion code `promo_1TvjJfJGvovZxLExCV6Hmswf` (`NUEVO10`, first_time_transaction)
- Payment Link de prueba `plink_1TvjakJGvovZxLEx5LZ8ircG`
  (`https://buy.stripe.com/test_eVqcN67HF1xkdP7gQjgjC00`, promos + customer always)

Webhook live: `we_1TvQyKJGvovZxLExGWvojE7I` → `https://mimarca-stripe-webhook.mimarca.workers.dev` (`checkout.session.completed`).

Política: el crédito vence en 12 meses, no es canjeable por efectivo y cubre
como máximo 50% de una compra futura (`POST /admin/referral/consume`). KV
mantiene hasta 100 redenciones por cliente y el panel muestra las 20 más recientes.
Registros viejos sin `rewardAmount`/`expiresAt` se normalizan al leer.

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

# Links autoeditados (requiere secrets:test-client con package + ownerToken)
curl https://mimarca-stripe-webhook.mimarca.workers.dev/card-links/test-client
curl -X PUT https://mimarca-stripe-webhook.mimarca.workers.dev/card-links/test-client \
  -H 'content-type: application/json' \
  -d '{"token":"test-client-ci-placeholder","links":[{"label":"Instagram","url":"https://instagram.com/x"}]}'
```

Vars/secrets: ver `.env.example` y `wrangler.toml`.
