'use strict';
// START: hændelser (pen, finger, knapper, tastatur) og opstart. Indlæses sidst.

hentIndstillinger();
if (!gemteFarver.length) gemteFarver = STANDARD_FARVER.slice();
function registrerTryk(e) {
  if (e.pointerType === 'pen' && e.pressure > hoejesteTryk + 0.005) {
    hoejesteTryk = e.pressure;
    trykMaaling.textContent = 'Højeste tryk målt: ' + Math.round(hoejesteTryk * 100) + ' %';
  }
}

laerred.addEventListener('pointerdown', e => {
  e.preventDefault();
  registrerTryk(e);
  laerred.setPointerCapture(e.pointerId);

  if (e.pointerType === 'mouse' && e.button !== 0) {
    hoejreTraek = { id: e.pointerId, x: e.clientX, y: e.clientY };
    return;
  }
  // Håndfladeafvisning: mens en stylus er nede, ignoreres fingre
  for (const q of pegere.values()) {
    if (q.type === 'pen' && e.pointerType === 'touch') return;
  }
  pegere.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

  if (pegere.size === 1) {
    // Stylussens viskelæder-ende/knap virker som præcist viskelæder i dette ene træk
    const penViskelaeder = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32));
    const v = penViskelaeder ? 'visk' : vaerktoej;
    if (erViskeVaerktoej(vaerktoej)) { musX = e.clientX; musY = e.clientY; }
    if (v === 'pipette') {
      samlFarveOp(e.clientX, e.clientY);
      vaelgVaerktoej(sidstePensel);
    } else if (v === 'slet') {
      sletAktiv = true;
      sletItems = [];
      sletStregVed(e.clientX, e.clientY);
    } else {
      startStreg(e.clientX, e.clientY, e.pointerType === 'pen' ? (e.pressure || 0) : null, v);
      if (tegnerNu) { tegnerNu._t = e.timeStamp || 0; }
    }
  } else if (pegere.size === 2) {
    afbrydStreg();
    afslutSlet();
    bevaegelse = toFingre();
  }
});

laerred.addEventListener('pointermove', e => {
  registrerTryk(e);
  if (erViskeVaerktoej(vaerktoej)) { musX = e.clientX; musY = e.clientY; snavs = true; }

  if (hoejreTraek && hoejreTraek.id === e.pointerId) {
    panSkaerm(e.clientX - hoejreTraek.x, e.clientY - hoejreTraek.y);
    hoejreTraek.x = e.clientX;
    hoejreTraek.y = e.clientY;
    return;
  }
  const p = pegere.get(e.pointerId);
  if (!p) return;

  if (pegere.size === 1 && tegnerNu) {
    const haendelser = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const h of (haendelser.length ? haendelser : [e])) {
      const [wx, wy] = tilVerden(h.clientX, h.clientY);
      tilfoejPunkt(tegnerNu, wx, wy, trykTilPunkt(tegnerNu, h));
    }
    snavs = true;
  } else if (pegere.size === 1 && sletAktiv) {
    sletStregVed(e.clientX, e.clientY);
  }
  p.x = e.clientX;
  p.y = e.clientY;

  if (pegere.size === 2 && bevaegelse) {
    const nu = toFingre();
    panSkaerm(nu.cx - bevaegelse.cx, nu.cy - bevaegelse.cy);
    zoomOmkring(nu.cx, nu.cy, kamera.zoom * (nu.d / bevaegelse.d));
    bevaegelse = nu;
  }
});

function slip(e) {
  if (hoejreTraek && hoejreTraek.id === e.pointerId) {
    hoejreTraek = null;
    return;
  }
  if (!pegere.has(e.pointerId)) return;
  pegere.delete(e.pointerId);
  if (pegere.size < 2) bevaegelse = null;
  if (pegere.size === 0) { afslutStreg(); afslutSlet(); }
}
laerred.addEventListener('pointerup', slip);
laerred.addEventListener('pointercancel', e => {
  if (pegere.size === 1) afbrydStreg();
  slip(e);
});

laerred.addEventListener('pointerleave', () => {
  if (erViskeVaerktoej(vaerktoej)) { musX = -1; snavs = true; }
});

laerred.addEventListener('wheel', e => {
  e.preventDefault();
  const faktor = Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * 0.0015)));
  zoomOmkring(e.clientX, e.clientY, kamera.zoom * faktor);
}, { passive: false });

laerred.addEventListener('contextmenu', e => e.preventDefault());

// ---------- knapper og tastatur ----------

nulstilKnap.addEventListener('click', () => {
  afbrydStreg();
  afslutSlet();
  kamera.node = start;
  kamera.x = 0; kamera.y = 0; kamera.zoom = 1;
  snavs = true;
});
for (const b of vaerktoejKnapper) b.addEventListener('click', () => vaelgVaerktoej(b.dataset.v));
knapFortryd.addEventListener('click', fortryd);
knapGentag.addEventListener('click', gentag);
menuKnap.addEventListener('click', () => {
  menuAaben = !menuAaben;
  gemIndstillinger();
  opdaterKnapper();
});
trykGlider.addEventListener('input', () => {
  trykFuld = Math.min(1, Math.max(0.05, Number(trykGlider.value) / 100));
  gemIndstillinger();
  opdaterKnapper();
});
stoerrelseGlider.addEventListener('input', () => {
  const [mn, mx] = GRAENSER[vaerktoej];
  saetStoerrelse(mn * Math.pow(mx / mn, Number(stoerrelseGlider.value) / 100));
});

trykKnap.addEventListener('click', () => {
  trykTil = !trykTil;
  gemIndstillinger();
  opdaterKnapper();
});
styrkeGlider.addEventListener('input', () => {
  fastStyrke = Math.min(1, Math.max(0.05, Number(styrkeGlider.value) / 100));
  gemIndstillinger();
  opdaterKnapper();
});
brugHoejesteKnap.addEventListener('click', () => {
  if (hoejesteTryk <= 0) return;
  trykFuld = Math.min(1, Math.max(0.05, hoejesteTryk * 0.9));
  gemIndstillinger();
  opdaterKnapper();
});
nulstilMaalingKnap.addEventListener('click', () => {
  hoejesteTryk = 0;
  trykMaaling.textContent = 'Tegn med stylus for at måle dit tryk';
});
fliseKnap.addEventListener('click', () => {
  brugFliser = !brugFliser;
  tomAlleFliser();
  baseGyldig = false;
  forrigeKamera = null;
  gemIndstillinger();
  opdaterKnapper();
  snavs = true;
});
blandKnap.addEventListener('click', () => {
  blandFarver = !blandFarver;
  gemIndstillinger();
  opdaterKnapper();
});
farveKnap.addEventListener('click', () => {
  farvePanelAaben = !farvePanelAaben;
  opdaterFarveUI();
});
lysstyrkeGlider.addEventListener('input', () => saetLysstyrke(Number(lysstyrkeGlider.value) / 100));
gemFarveKnap.addEventListener('click', () => {
  if (!gemteFarver.includes(farve)) {
    gemteFarver.push(farve);
    if (gemteFarver.length > MAX_GEMTE) gemteFarver.shift();
    gemIndstillinger();
  }
  opdaterFarveUI();
});
fjernFarveKnap.addEventListener('click', () => {
  gemteFarver = gemteFarver.filter(h => h !== farve);
  gemIndstillinger();
  opdaterFarveUI();
});
function hjulPeger(e) {
  const r = farvehjul.getBoundingClientRect();
  const W = farvehjul.width, k = W / r.width, R = W / 2 - 3;
  const dx = (e.clientX - r.left) * k - W / 2, dy = (e.clientY - r.top) * k - W / 2;
  saetFraHjul((Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1, Math.min(Math.hypot(dx, dy), R) / R);
}
farvehjul.addEventListener('pointerdown', e => {
  e.preventDefault();
  farvehjul.setPointerCapture(e.pointerId);
  hjulTrukket = true;
  hjulPeger(e);
});
farvehjul.addEventListener('pointermove', e => { if (hjulTrukket) hjulPeger(e); });
farvehjul.addEventListener('pointerup', () => { hjulTrukket = false; });
farvehjul.addEventListener('pointercancel', () => { hjulTrukket = false; });

window.addEventListener('keydown', e => {
  if (galleriAaben) return;   // genveje virker kun i selve tegneren
  if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'text') return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) gentag(); else fortryd();
  } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
    e.preventDefault();
    gentag();
  } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (k === 'd') {
      visFejlsoeg = !visFejlsoeg;
      fejlsoeg.style.display = visFejlsoeg ? 'block' : 'none';
      snavs = true;
    } else if (k === 'e') {
      vaelgVaerktoej('visk');
    } else if (k === 'p') {
      vaelgVaerktoej('spids');
    } else if (k === 'i') {
      vaelgVaerktoej('pipette');
    } else if (k === 'b') {
      blandFarver = !blandFarver;
      gemIndstillinger();
      opdaterKnapper();
    } else if (k === '[') {
      saetStoerrelse(STOERRELSE[vaerktoej] / 1.25);
    } else if (k === ']') {
      saetStoerrelse(STOERRELSE[vaerktoej] * 1.25);
    }
  }
});

nytLaerredKnap.addEventListener('click', nytLaerred);
importKnap.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', () => {
  const fil = importInput.files && importInput.files[0];
  importInput.value = '';
  importerFil(fil);
});
knapGalleri.addEventListener('click', tilGalleri);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') gemNu(true);
});
window.addEventListener('pagehide', () => { gemNu(false); });
// ---------- installation og opdatering ----------
const installKnap = document.getElementById('installKnap');
const opdateringEl = document.getElementById('opdatering');
const opdateringKnap = document.getElementById('opdateringKnap');
let installHaendelse = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installHaendelse = e;
  installKnap.classList.remove('skjult');
});
window.addEventListener('appinstalled', () => {
  installHaendelse = null;
  installKnap.classList.add('skjult');
});
installKnap.addEventListener('click', () => {
  if (!installHaendelse) return;
  installHaendelse.prompt();
  installHaendelse = null;
  installKnap.classList.add('skjult');
});
opdateringKnap.addEventListener('click', async () => {
  try { if (aktivtId) await tilGalleri(); } catch (e) { /* genindlæs alligevel */ }
  location.reload();
});

// Service worker (kun over https eller localhost): gør appen brugbar uden internet
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof location !== 'undefined' &&
    (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  const havdeStyring = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => { /* appen virker også uden */ });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (havdeStyring) opdateringEl.classList.remove('skjult');   // en ny version har overtaget
  });
}

window.addEventListener('resize', skaler);
skaler();
saetFarve(farve);
opdaterKnapper();
requestAnimationFrame(loop);
startApp();
