# Webhook de Stripe — Mi Tarjeta Pro

Cloudflare Worker que recibe `checkout.session.completed` de Stripe, valida la
firma, y manda los dos correos de marca del repo (`emails/order-confirmation.html`
al cliente y `emails/payment-alert.html` al owner) vía [Resend](https://resend.com).

El sitio principal sigue siendo 100% estático en GitHub Pages; este Worker es
el único backend y vive aparte, en Cloudflare.

## Deploy

```bash
cd workers/stripe-webhook
npm install
npx wrangler login                 # primera vez
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler deploy
```

El deploy imprime la URL pública, p. ej.
`https://mimarca-stripe-webhook.<subdominio>.workers.dev`.

Luego, en el [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks):
crear un endpoint apuntando a esa URL, suscrito solo al evento
`checkout.session.completed`, y copiar su signing secret (`whsec_...`) al
secret `STRIPE_WEBHOOK_SECRET` del Worker.

En Resend: verificar el dominio `mimarca.me` para poder mandar desde
`pedidos@mimarca.me` (o ajustar `FROM_EMAIL` en `wrangler.toml`).

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

## Variables de entorno

Ver `.env.example`. Resumen: `STRIPE_WEBHOOK_SECRET` y `RESEND_API_KEY` son
secretos (`wrangler secret put`); `OWNER_ALERT_EMAIL`, `FROM_EMAIL` y
`SUPPORT_EMAIL` son vars públicas en `wrangler.toml`.
