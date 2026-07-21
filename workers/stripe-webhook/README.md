# Worker de backend — Mi Tarjeta Pro

Cloudflare Worker que le da backend al sitio estático.

## Rutas

- `POST /` — webhook Stripe (`checkout.session.completed`) → correos de
  pedido + tracking de referidos si viene `client_reference_id`.
- `POST /access` — magic link `{slug,email}` (rate-limit 5/h/IP). Secretos en KV.
- `POST /session` — `{slug,token}` → datos públicos + `referralCode` (sin
  `ownerToken`/`ownerEmail`).
- `POST /upload` — logo/fotos → R2 + aviso al owner.
- `POST /notify/approved` — cliente aprueba diseño.
- `POST /notify/published` / `POST /notify/change-received` — admin
  (`X-Admin-Secret`). UI: `/admin/`.

## Estado

| Recurso | Uso |
|---------|-----|
| JSON `negocio/_data/<slug>.json` | Datos públicos de la tarjeta (`orderStage`, negocio, etc.) |
| KV `PORTAL_KV` | `secrets:<slug>`, `ref:<CODE>`, `redeem:*`, `rl:access:*` |
| R2 `PORTAL_UPLOADS` | Archivos de `/upload` → `https://uploads.mimarca.me/...` |

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
```

Vars/secrets: ver `.env.example` y `wrangler.toml`.
