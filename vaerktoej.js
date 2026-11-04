'use strict';
// VÆRKTØJ: valg af pensel/størrelse, historik (fortryd/gentag), "slet streg", og oprettelse af streger.

// ---------- værktøj og størrelse ----------

function erViskeVaerktoej(v) { return v === 'visk' || v === 'slet'; }

function formaterPx(v) { return (v < 10 ? v.toFixed(1) : String(Math.round(v))) + ' px'; }

function opdaterKnapper() {
  knapFortryd.disabled = fortrydStak.length === 0;
  knapGentag.disabled = gentagStak.length === 0;
  for (const b of vaerktoejKnapper) b.classList.toggle('valgt', b.dataset.v === vaerktoej);
  laerred.style.cursor = erViskeVaerktoej(vaerktoej) ? 'none' : 'crosshair';
  const [mn, mx] = GRAENSER[vaerktoej];
  const v = STOERRELSE[vaerktoej];
  stoerrelseGlider.value = String(Math.round(100 * Math.log(v / mn) / Math.log(mx / mn)));
  stoerrelseTal.textContent = formaterPx(v);
  menu.classList.toggle('lukket', !menuAaben);
  menuKnap.setAttribute('aria-expanded', menuAaben ? 'true' : 'false');
  menuKnap.textContent = menuAaben ? '✕ Luk menu' : '☰ Menu';
  trykGlider.value = String(Math.round(trykFuld * 100));
  trykTal.textContent = Math.round(trykFuld * 100) + ' %';
  trykKnap.classList.toggle('valgt', trykTil);
  trykKnap.setAttribute('aria-pressed', trykTil ? 'true' : 'false');
  fliseKnap.textContent = 'Tegnemetode: ' + (brugFliser ? 'FLISER (hurtig)' : 'KLASSISK');
  fliseKnap.classList.toggle('valgt', brugFliser);
  trykKnap.textContent = 'Tryk fra stylus: ' + (trykTil ? 'TIL' : 'FRA');
  trykDel.classList.toggle('skjult', !trykTil);
  styrkeGlider.value = String(Math.round(fastStyrke * 100));
  styrkeTal.textContent = Math.round(fastStyrke * 100) + ' %';
  blandKnap.classList.toggle('valgt', blandFarver);
  blandKnap.setAttribute('aria-pressed', blandFarver ? 'true' : 'false');
  blandKnap.textContent = 'Bland farver ved overlap: ' + (blandFarver ? 'TIL' : 'FRA');
  opdaterFarveUI();
}

function saetStoerrelse(v) {
  const [mn, mx] = GRAENSER[vaerktoej];
  STOERRELSE[vaerktoej] = Math.min(mx, Math.max(mn, v));
  if (erViskeVaerktoej(vaerktoej)) {
    if (musX < 0) { musX = bredde / 2; musY = hoejde / 2; } // vis cirklen midt på skærmen
  }
  snavs = true;
  opdaterKnapper();
}

function vaelgVaerktoej(v) {
  if (!GRAENSER[v]) return;
  afslutSlet();
  if (PENSLER[v]) sidstePensel = v;
  vaerktoej = v;
  musX = -1;
  snavs = true;
  opdaterKnapper();
}

// ---------- historik (fortryd/gentag) ----------

function skubHandling(h) {
  fortrydStak.push(h);
  if (fortrydStak.length > HISTORIK_MAX) fortrydStak.shift();
  gentagStak.length = 0;
  markerAendret();
  opdaterKnapper();
}

function afslutStreg() {
  if (tegnerNu && tegnerNode) {
    const i = tegnerNode.strokes.lastIndexOf(tegnerNu);
    if (i >= 0) {
      forenklStreg(tegnerNu);
      skubHandling({ type: 'tilfoej', node: tegnerNode, stroke: tegnerNu, index: i });
      flettIMellemlager(tegnerNu, tegnerNode);
      fliserTilfoej(tegnerNu, tegnerNode);
    }
  }
  tegnerNu = null;
  tegnerNode = null;
}

// Den færdige streg lægges oven på mellemlageret, så alt ikke skal tegnes forfra
function flettIMellemlager(streg, node) {
  if (!baseGyldig || !baseKamera || node !== kamera.node ||
      baseKamera.node !== kamera.node || baseKamera.x !== kamera.x ||
      baseKamera.y !== kamera.y || baseKamera.zoom !== kamera.zoom) {
    baseGyldig = false;
    return;
  }
  const gammel = ctx;
  ctx = baseCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  tegnStreg(streg, kamera.zoom, kamera.x, 0, kamera.y, 0, bredde / 2, hoejde / 2);
  ctx = gammel;
}

function afslutSlet() {
  if (sletAktiv && sletItems.length) skubHandling({ type: 'slet', items: sletItems });
  sletAktiv = false;
  sletItems = [];
}

function fortryd() {
  if (tegnerNu || sletAktiv) return;
  const h = fortrydStak.pop();
  if (!h) return;
  if (h.type === 'tilfoej') {
    const i = h.node.strokes.indexOf(h.stroke);
    if (i >= 0) { h.node.strokes.splice(i, 1); antalStreger--; }
    stregFjernet(h.stroke);
    fliserUgyldig(h.node, h.stroke);
  } else {
    for (let k = h.items.length - 1; k >= 0; k--) {
      const it = h.items[k];
      it.node.strokes.splice(Math.min(it.index, it.node.strokes.length), 0, it.stroke);
      antalStreger++;
      stregTilfoejet(it.stroke);
      fliserUgyldig(it.node, it.stroke);
    }
  }
  gentagStak.push(h);
  baseGyldig = false;
  markerAendret();
  snavs = true;
  opdaterKnapper();
}

function gentag() {
  if (tegnerNu || sletAktiv) return;
  const h = gentagStak.pop();
  if (!h) return;
  if (h.type === 'tilfoej') {
    h.node.strokes.splice(Math.min(h.index, h.node.strokes.length), 0, h.stroke);
    antalStreger++;
    stregTilfoejet(h.stroke);
    fliserUgyldig(h.node, h.stroke);
  } else {
    for (const it of h.items) {
      const i = it.node.strokes.indexOf(it.stroke);
      if (i >= 0) { it.node.strokes.splice(i, 1); antalStreger--; }
      stregFjernet(it.stroke);
      fliserUgyldig(it.node, it.stroke);
    }
  }
  fortrydStak.push(h);
  baseGyldig = false;
  markerAendret();
  snavs = true;
  opdaterKnapper();
}

// ---------- "slet streg" (fjerner hele streger) ----------

// Rammer cirklen (radius r om (px, py)) stregen? Afstand regnes i skærmpixels.
function stregVedPunkt(s, z, kxh, kxl, kyh, kyl, cx, cy, px, py, radius) {
  const p = s.p;
  const r = radius + Math.min(s.w * z / 2, 1e12);
  const r2 = r * r;
  let ax = ((p[0] - kxh) - kxl) * z + cx;
  let ay = ((p[1] - kyh) - kyl) * z + cy;
  if (p.length === 2) return (ax - px) * (ax - px) + (ay - py) * (ay - py) <= r2;
  for (let i = 2; i < p.length; i += 2) {
    const bx = ((p[i] - kxh) - kxl) * z + cx;
    const by = ((p[i + 1] - kyh) - kyl) * z + cy;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    if (qx * qx + qy * qy <= r2) return true;
    ax = bx; ay = by;
  }
  return false;
}

function sletStregVed(px, py) {
  const radius = STOERRELSE.slet / 2;
  const ramt = [];
  gennemloebAlt((node, s, z, kxh, kxl, kyh, kyl, cx, cy) => {
    if (s.t === 'visk') return; // selve viskelæder-stregerne er usynlige og røres ikke
    if (stregVedPunkt(s, z, kxh, kxl, kyh, kyl, cx, cy, px, py, radius)) ramt.push([node, s]);
  });
  for (const [node, s] of ramt) {
    const i = node.strokes.indexOf(s);
    if (i < 0) continue;
    node.strokes.splice(i, 1);
    antalStreger--;
    sletItems.push({ node, stroke: s, index: i });
    stregFjernet(s);
    fliserUgyldig(node, s);
  }
  if (ramt.length) { baseGyldig = false; snavs = true; }
}

// ---------- tegning med pen/finger ----------

function tilfoejPunkt(streg, wx, wy, tryk) {
  const p = streg.p;
  const n = p.length;
  if (n >= 2) {
    const dx = (wx - p[n - 2]) * kamera.zoom;
    const dy = (wy - p[n - 1]) * kamera.zoom;
    if (dx * dx + dy * dy < 1) return;
  }
  p.push(wx, wy);
  if (streg.pr) streg.pr.push(tryk === undefined || tryk === null ? 0.6 : tryk);
  if (wx < streg.minX) streg.minX = wx;
  if (wx > streg.maxX) streg.maxX = wx;
  if (wy < streg.minY) streg.minY = wy;
  if (wy > streg.maxY) streg.maxY = wy;
  const pad = streg.w / 2;
  udvidBox(tegnerNode, wx - pad, wx + pad, wy - pad, wy + pad);
}

// type: 'spids' | 'blod' | 'fyldepen' | 'tusse' | 'visk'
// tryk: stylussens rå tryk (0-1) eller null/undefined for mus og finger
function startStreg(sx, sy, tryk, type) {
  type = type || vaerktoej;
  if (!STOERRELSE[type] || type === 'slet' || type === 'pipette') type = 'spids';
  const [wx, wy] = tilVerden(sx, sy);
  const pensel = PENSLER[type];
  const medStylus = trykTil && typeof tryk === 'number' && type !== 'visk';
  const brugTryk = !!pensel && (medStylus || (trykTil && !!pensel.fart));
  const px = STOERRELSE[type] * (type === 'fyldepen' ? 1.5 : 1);   // w = største bredde
  tegnerNode = kamera.node;
  tegnerNu = {
    id: naesteId++,
    t: type,
    c: type === 'visk' ? null : farve,
    m: blandFarver,
    a: fastStyrke,
    p: [wx, wy],
    pr: brugTryk ? [medStylus ? trykKurve(tryk) : 0.6] : null,
    w: px / kamera.zoom,
    minX: wx, maxX: wx, minY: wy, maxY: wy,
    _z0: kamera.zoom,                // zoom, da stregen blev tegnet (bruges til at forenkle den)
    _p: 0.6, _x: sx, _y: sy, _t: 0   // tilstand til simuleret tryk (bruges ikke ved gemning)
  };
  tegnerNode.strokes.push(tegnerNu);
  antalStreger++;
  const pad = tegnerNu.w / 2;
  udvidBox(tegnerNode, wx - pad, wx + pad, wy - pad, wy + pad);
  snavs = true;
}

function afbrydStreg() {
  if (tegnerNu && tegnerNode) {
    const i = tegnerNode.strokes.lastIndexOf(tegnerNu);
    if (i >= 0) { tegnerNode.strokes.splice(i, 1); antalStreger--; }
  }
  tegnerNu = null;
  tegnerNode = null;
  snavs = true;
}

function toFingre() {
  const [a, b] = [...pegere.values()];
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    d: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1)
  };
}

// Tryk til en streg, der bruger varierende bredde. Stylus: rigtigt tryk. Mus/finger: ud fra farten
// (langsomt = tykt, hurtigt = tyndt), glattet, så bredden ikke hopper.
function trykTilPunkt(streg, h) {
  if (!streg.pr) return null;
  if (h.pointerType === 'pen') return trykKurve(h.pressure || 0);
  const nu = h.timeStamp || 0;
  const dt = Math.max(nu - streg._t, 1);
  const d = Math.hypot(h.clientX - streg._x, h.clientY - streg._y);
  const maal = 1 - Math.min((d / dt) / 2.5, 1) * 0.75;
  streg._p = streg._p * 0.85 + maal * 0.15;
  streg._t = nu; streg._x = h.clientX; streg._y = h.clientY;
  return streg._p;
}


// ---------- forenkling af færdige streger ----------
// Når en streg er færdig, fjernes punkter, der ligger næsten på en ret linje (mindre end ca. 0,2 pixel fra den,
// målt ved den zoom, stregen blev tegnet med). Det kan ikke ses, men gør tegningen mindre og hurtigere.
// Stregen forenkles kun én gang og ændres aldrig bagefter.
function forenklStreg(s) {
  const n = s.p.length / 2;
  if (n < 4 || !s._z0) return;
  const tol = 0.2 / s._z0, tol2 = tol * tol;
  const behold = new Uint8Array(n);
  behold[0] = 1; behold[n - 1] = 1;
  const stak = [0, n - 1];
  const p = s.p;
  while (stak.length) {
    const b = stak.pop(), a = stak.pop();
    if (b <= a + 1) continue;
    const ax = p[a * 2], ay = p[a * 2 + 1], bx = p[b * 2], by = p[b * 2 + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let maks = -1, mi = -1;
    for (let k = a + 1; k < b; k++) {
      const px = p[k * 2] - ax, py = p[k * 2 + 1] - ay;
      let d2;
      if (l2 === 0) d2 = px * px + py * py;
      else {
        let t = (px * dx + py * dy) / l2;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const qx = px - t * dx, qy = py - t * dy;
        d2 = qx * qx + qy * qy;
      }
      if (d2 > maks) { maks = d2; mi = k; }
    }
    if (maks > tol2) { behold[mi] = 1; stak.push(a, mi, mi, b); }
  }
  let antal = 0;
  for (let k = 0; k < n; k++) antal += behold[k];
  if (antal === n) return;
  const np = new Array(antal * 2), npr = s.pr ? new Array(antal) : null;
  let q = 0;
  for (let k = 0; k < n; k++) {
    if (!behold[k]) continue;
    np[q * 2] = p[k * 2]; np[q * 2 + 1] = p[k * 2 + 1];
    if (npr) npr[q] = s.pr[k];
    q++;
  }
  s.p = np;
  if (npr) s.pr = npr;
  s._tp = null; s._tr = null;
}
