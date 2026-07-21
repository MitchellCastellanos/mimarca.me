# Configura cupón NUEVO10 + promotion code + Payment Links (live).
# Requiere una API key con permisos de escritura (sk_live_... o RAK con
# Coupons/Promotion Codes/Payment Links write). La RAK del Stripe CLI
# actual solo tiene lectura en live.
#
# Uso:
#   $env:STRIPE_API_KEY = "sk_live_..."   # o rk_live_ con write
#   .\scripts\setup-referral-stripe.ps1
#
# No imprime secretos. Idempotente: reutiliza cupón/promo si ya existen.

$ErrorActionPreference = "Stop"
if (-not $env:STRIPE_API_KEY) {
  Write-Error "Define STRIPE_API_KEY con una clave live que pueda escribir Coupons y Payment Links."
}

$apiKey = $env:STRIPE_API_KEY
function Stripe([string[]]$Args) {
  & stripe @Args --api-key $apiKey --live
}

$paymentLinks = @(
  @{ id = "plink_1Tu1a7JGvovZxLExK7euXbnT"; name = "Lanzamiento" },
  @{ id = "plink_1Tu1a9JGvovZxLExUuRthJ1d"; name = "Personalizado" },
  @{ id = "plink_1Tu1aBJGvovZxLExDx1juPyz"; name = "Premium" }
)

Write-Host "Buscando cupón / promotion code NUEVO10..."
$promoJson = Stripe @("promotion_codes","list","--code=NUEVO10","--limit=1") | Out-String
$promo = $promoJson | ConvertFrom-Json
$promoId = $null
$couponId = $null

if ($promo.data -and $promo.data.Count -gt 0) {
  $promoId = $promo.data[0].id
  $couponId = $promo.data[0].promotion.coupon
  Write-Host "Reusando promotion code $promoId (coupon $couponId)"
} else {
  $couponJson = Stripe @(
    "coupons","create",
    "--percent-off=10",
    "--duration=once",
    "--name=Referido nuevo cliente 10%"
  ) | Out-String
  $coupon = $couponJson | ConvertFrom-Json
  $couponId = $coupon.id
  Write-Host "Cupón creado: $couponId"

  $createdPromoJson = Stripe @(
    "promotion_codes","create",
    "--code=NUEVO10",
    "--promotion.type=coupon",
    "--promotion.coupon=$couponId",
    "--restrictions.first-time-transaction=true",
    "-c"
  ) | Out-String
  $createdPromo = $createdPromoJson | ConvertFrom-Json
  $promoId = $createdPromo.id
  Write-Host "Promotion code creado: $promoId"
}

foreach ($link in $paymentLinks) {
  Write-Host "Actualizando $($link.name) ($($link.id))..."
  Stripe @(
    "payment_links","update",$link.id,
    "--allow-promotion-codes=true",
    "-d","customer_creation=always"
  ) | Out-Null
  Write-Host "  OK allow_promotion_codes=true, customer_creation=always"
}

Write-Host ""
Write-Host "Listo."
Write-Host "coupon_id=$couponId"
Write-Host "promotion_code_id=$promoId"
Write-Host "promotion_code=NUEVO10"
Write-Host "payment_links=Lanzamiento,Personalizado,Premium"
