(() => {
  const cards = [{slug:"rcr-barbershop",name:"RCR Barber Shop",category:"Barbería",city:"Querétaro",tagline:"Corte, barba y estilo para caballeros.",features:["Agenda","Servicios","Galería"],url:"./rcr-barbershop/"}];
  const frame = document.querySelector("#mtLiveFrame");
  if (!frame || !cards.length) return;
  const shuffled = [...cards].sort(() => Math.random() - 0.5);
  let current = 0;
  let touchStartX = 0;
  const els = {phone:document.querySelector(".mt-live-phone"),name:document.querySelector("#mtLiveName"),meta:document.querySelector("#mtLiveMeta"),tagline:document.querySelector("#mtLiveTagline"),features:document.querySelector("#mtLiveFeatures"),count:document.querySelector("#mtLiveCount"),link:document.querySelector("#mtLiveLink"),screenLink:document.querySelector("#mtLiveScreenLink"),prev:document.querySelector("#mtLivePrev"),next:document.querySelector("#mtLiveNext"),random:document.querySelector("#mtLiveRandom"),stage:document.querySelector("#mtLiveStage")};
  const render = (index) => {
    current = (index + shuffled.length) % shuffled.length;
    const card = shuffled[current];
    els.phone.classList.add("is-changing");
    window.setTimeout(() => {
      frame.src=card.url; frame.title=`Vista previa de la tarjeta de ${card.name}`; els.name.textContent=card.name; els.meta.textContent=`${card.category} · ${card.city}`; els.tagline.textContent=card.tagline;
      els.count.textContent=`${String(current+1).padStart(2,"0")} / ${String(shuffled.length).padStart(2,"0")}`;
      els.features.replaceChildren(...card.features.map((feature) => { const badge=document.createElement("span"); badge.className="badge rounded-pill text-bg-light"; badge.textContent=feature; return badge; }));
      [els.link,els.screenLink].forEach((link) => { link.href=card.url; }); els.screenLink.setAttribute("aria-label",`Abrir la tarjeta de ${card.name}`); els.phone.classList.remove("is-changing");
    },180);
  };
  const goNext=() => render(current+1); const goPrev=() => render(current-1);
  els.next.addEventListener("click",goNext); els.prev.addEventListener("click",goPrev);
  els.random.addEventListener("click",() => {
    if (shuffled.length<2) { els.phone.animate([{transform:"rotate(2deg)"},{transform:"rotate(-3deg)"},{transform:"rotate(2deg)"}],{duration:420,easing:"ease-out"}); return; }
    let next=current; while(next===current) next=Math.floor(Math.random()*shuffled.length); render(next);
  });
  els.stage.addEventListener("touchstart",(event) => { touchStartX=event.changedTouches[0].clientX; },{passive:true});
  els.stage.addEventListener("touchend",(event) => { const distance=event.changedTouches[0].clientX-touchStartX; if(Math.abs(distance)>55) distance<0?goNext():goPrev(); },{passive:true});
  if(shuffled.length===1) { els.prev.hidden=true; els.next.hidden=true; els.random.hidden=true; document.querySelector(".mt-live-swipe").hidden=true; }
})();
