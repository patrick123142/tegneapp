'use strict';
// TEGNING: selve tegningen af streger, mellemlager (cache) og hele billedet.

// ---------- tegning ----------

function klip(ax, ay, bx, by, xmin, xmax, ymin, ymax) {
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - xmin, xmax - ax, ay - ymin, ymax - ay];
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 4; k++) {
    if (p[k] === 0) {
      if (q[k] < 0) return null;
    } else {
      const r = q[k] / p[k];
      if (p[k] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

// Udtynd en streg til skærmpunkter mindst 1 pixel fra hinanden (med tryk). Returnerer antal punkter.
function udtynPunkter(s, z, kxh, kxl, kyh, kyl, cx, cy) {
  const p = s.p, pr = s.pr;
  let lx = ((p[0] - kxh) - kxl) * z + cx;
  let ly = ((p[1] - kyh) - kyl) * z + cy;
  bufX[0] = lx; bufY[0] = ly; bufT[0] = pr[0];
  let n = 1;
  for (let i = 2; i < p.length; i += 2) {
    const x = ((p[i] - kxh) - kxl) * z + cx;
    const y = ((p[i + 1] - kyh) - kyl) * z + cy;
    const dx = x - lx, dy = y - ly;
    if (dx * dx + dy * dy >= 1.44) {
      bufX[n] = x; bufY[n] = y; bufT[n] = pr[i / 2]; n++;
      lx = x; ly = y;
    }
  }
  return n;
}

// Trykket deles i KVANT trin, og sammenhængende punkter med samme trin tegnes som ét stykke
// (ét tegnekald i stedet for ét pr. lille linjestykke). Det er det, der gør tegningen hurtig.
const KVANT = 12;
let koerA = [], koerB = [], koerL = [], bufT2 = [];

function lavKoerler(n) {
  for (let i = 0; i < n; i++) {                      // glat trykket en smule
    const a = bufT[i > 0 ? i - 1 : 0], c = bufT[i < n - 1 ? i + 1 : n - 1];
    bufT2[i] = (a + bufT[i] + c) / 3;
  }
  let antal = 0, niv = -1;
  for (let k = 1; k < n; k++) {
    const lf = (bufT2[k - 1] + bufT2[k]) / 2 * (KVANT - 1);
    if (niv < 0 || Math.abs(lf - niv) > 0.9) niv = Math.round(lf);   // lidt "hysterese", så det ikke flimrer
    if (antal > 0 && koerL[antal - 1] === niv) {
      koerB[antal - 1] = k;
    } else {
      koerA[antal] = k - 1; koerB[antal] = k; koerL[antal] = niv; antal++;
    }
  }
  return antal;
}

// Tegn stykkerne på c. saetStil(tq) sætter bredde/farve for trin tq (0-1).
function tegnKoerer(c, antal, xmin, xmax, ymin, ymax, saetStil) {
  for (let r = 0; r < antal; r++) {
    const a = koerA[r], b = koerB[r];
    saetStil(koerL[r] / (KVANT - 1));
    c.beginPath();
    let inde = true;
    for (let i = a; i <= b; i++) {
      if (!(bufX[i] > xmin && bufX[i] < xmax && bufY[i] > ymin && bufY[i] < ymax)) { inde = false; break; }
    }
    if (inde) {
      c.moveTo(bufX[a], bufY[a]);
      for (let i = a + 1; i <= b; i++) c.lineTo(bufX[i], bufY[i]);
    } else {                                           // sjældent: stykket når uden for tegneområdet
      for (let i = a + 1; i <= b; i++) {
        const kl = klip(bufX[i - 1], bufY[i - 1], bufX[i], bufY[i], xmin, xmax, ymin, ymax);
        if (kl) { c.moveTo(kl[0], kl[1]); c.lineTo(kl[2], kl[3]); }
      }
    }
    c.stroke();
  }
}

// Streg med varierende bredde (fyldepen): bredden følger trykket.
function tegnTryk(s, z, kxh, kxl, kyh, kyl, cx, cy) {
  const pensel = PENSLER[s.t] || PENSLER.fyldepen;
  const xmin = cx - GRAENSE, xmax = cx + GRAENSE;
  const ymin = cy - GRAENSE, ymax = cy + GRAENSE;
  const maxB = Math.min(s.w * z, MAX_LINJEBREDDE);
  const n = udtynPunkter(s, z, kxh, kxl, kyh, kyl, cx, cy);
  if (n === 1) {
    if (!(bufX[0] > xmin && bufX[0] < xmax && bufY[0] > ymin && bufY[0] < ymax)) return;
    ctx.beginPath();
    ctx.arc(bufX[0], bufY[0], Math.max(maxB * mellem(pensel.bredde, bufT[0]), 0.3) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const antal = lavKoerler(n);
  tegnKoerer(ctx, antal, xmin, xmax, ymin, ymax, tq => {
    ctx.lineWidth = Math.max(maxB * mellem(pensel.bredde, tq), 0.3);
  });
}

function sikrLag() {
  if (!lagCanvas || lagCanvas.width !== laerred.width || lagCanvas.height !== laerred.height) {
    lagCanvas = document.createElement('canvas');
    lagCanvas.width = laerred.width;
    lagCanvas.height = laerred.height;
    lagCtx = lagCanvas.getContext('2d');
  }
}

// Streg hvor trykket styrer både bredde og gennemsigtighed (spids/blød blyant, tusse med stylus).
// For at stykkerne ikke bliver mørkere, hvor de overlapper, tegnes stregen først på et midlertidigt
// lag i graatoner (mørkeste gælder), og laget lægges derefter på lærredet med "gang sammen".
// På hvidt papir er det præcis det samme som en gennemsigtig streg i farven.
function tegnTrykLag(s, z, kxh, kxl, kyh, kyl, cx, cy) {
  const pensel = PENSLER[s.t] || PENSLER.spids;
  const rgb = hexTilRgb(s.c || '#000000');
  const xmin = cx - GRAENSE, xmax = cx + GRAENSE;
  const ymin = cy - GRAENSE, ymax = cy + GRAENSE;
  const maxB = Math.min(s.w * z, MAX_LINJEBREDDE);
  const n = udtynPunkter(s, z, kxh, kxl, kyh, kyl, cx, cy);

  // Område på skærmen, som stregen dækker
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < n; k++) {
    if (bufX[k] < x0) x0 = bufX[k];
    if (bufX[k] > x1) x1 = bufX[k];
    if (bufY[k] < y0) y0 = bufY[k];
    if (bufY[k] > y1) y1 = bufY[k];
  }
  const pad = maxB / 2 + 2;
  x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
  x1 = Math.min(bredde, Math.ceil(x1 + pad)); y1 = Math.min(hoejde, Math.ceil(y1 + pad));
  if (x1 <= x0 || y1 <= y0) return;

  sikrLag();
  const L = lagCtx;
  L.setTransform(dpr, 0, 0, dpr, 0, 0);
  L.globalCompositeOperation = 'source-over';
  L.globalAlpha = 1;
  L.fillStyle = '#ffffff';
  L.fillRect(x0, y0, x1 - x0, y1 - y0);
  L.globalCompositeOperation = 'darken';
  L.lineCap = 'round';
  L.lineJoin = 'round';

  const lag = pensel.blod ? BLOD_LAG : [[1, 1]];
  // Farven som blæk med styrke a ville se ud på hvidt papir (bruges, til lagene lægges sammen)
  const blaek = a => {
    const t = Math.min(1, Math.max(0, a));
    return 'rgb(' + Math.round(255 - (255 - rgb[0]) * t) + ',' + Math.round(255 - (255 - rgb[1]) * t) + ',' + Math.round(255 - (255 - rgb[2]) * t) + ')';
  };

  if (n === 1) {
    const t = bufT[0];
    for (const [b, a] of lag) {
      L.fillStyle = blaek(a * mellem(pensel.styrke, t));
      L.beginPath();
      L.arc(bufX[0], bufY[0], Math.max(maxB * mellem(pensel.bredde, t) * b, 0.3) / 2, 0, Math.PI * 2);
      L.fill();
    }
  } else {
    const antal = lavKoerler(n);
    for (const [b, a] of lag) {
      tegnKoerer(L, antal, xmin, xmax, ymin, ymax, tq => {
        L.strokeStyle = blaek((pensel.blod ? a : pensel.alpha) * mellem(pensel.styrke, tq));
        L.lineWidth = Math.max(maxB * mellem(pensel.bredde, tq) * b, 0.3);
      });
    }
  }

  // Læg laget på lærredet (i enhedens pixels)
  const sx = Math.floor(x0 * dpr), sy = Math.floor(y0 * dpr);
  const sw = Math.min(lagCanvas.width - sx, Math.ceil((x1 - x0) * dpr));
  const sh = Math.min(lagCanvas.height - sy, Math.ceil((y1 - y0) * dpr));
  if (sw <= 0 || sh <= 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 1;
  ctx.drawImage(lagCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
  ctx.restore();
}

// Streg med trykfølsom styrke uden blanding: hvert stykke tegnes som en fuldt dækkende farve,
// der svarer til stregen på hvidt papir. Så bliver overlap ikke mørkere.
function tegnTrykOpak(s, z, kxh, kxl, kyh, kyl, cx, cy) {
  const pensel = PENSLER[s.t] || PENSLER.spids;
  const rgb = hexTilRgb(s.c || '#000000');
  const xmin = cx - GRAENSE, xmax = cx + GRAENSE;
  const ymin = cy - GRAENSE, ymax = cy + GRAENSE;
  const maxB = Math.min(s.w * z, MAX_LINJEBREDDE);
  const n = udtynPunkter(s, z, kxh, kxl, kyh, kyl, cx, cy);
  const lag = pensel.blod ? BLOD_LAG : [[1, pensel.alpha]];
  ctx.globalAlpha = 1;
  if (n === 1) {
    if (!(bufX[0] > xmin && bufX[0] < xmax && bufY[0] > ymin && bufY[0] < ymax)) return;
    for (const [b, a] of lag) {
      ctx.fillStyle = inkPaaHvid(rgb, a * mellem(pensel.styrke, bufT[0]));
      ctx.beginPath();
      ctx.arc(bufX[0], bufY[0], Math.max(maxB * mellem(pensel.bredde, bufT[0]) * b, 0.3) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  const antal = lavKoerler(n);
  for (const [b, a] of lag) {            // yderste lag først, så de stærkeste ligger øverst
    tegnKoerer(ctx, antal, xmin, xmax, ymin, ymax, tq => {
      ctx.strokeStyle = inkPaaHvid(rgb, (pensel.blod ? a : pensel.alpha) * mellem(pensel.styrke, tq));
      ctx.lineWidth = Math.max(maxB * mellem(pensel.bredde, tq) * b, 0.3);
    });
  }
}

function tegnStreg(s, z, kxh, kxl, kyh, kyl, cx, cy) {
  const pensel = PENSLER[s.t] || PENSLER.spids;
  const c = s.c || '#000000';
  if (s.t === 'visk') {
    tegnEnkeltStreg(s, z, kxh, kxl, kyh, kyl, cx, cy, [[1, '#ffffff', 1]]);
    return;
  }
  if (s.pr && s.t === 'fyldepen') {
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.globalAlpha = 1;
    tegnTryk(s, z, kxh, kxl, kyh, kyl, cx, cy);
  } else if (s.pr) {
    ctx.globalAlpha = 1;
    if (s.m) tegnTrykLag(s, z, kxh, kxl, kyh, kyl, cx, cy);
    else tegnTrykOpak(s, z, kxh, kxl, kyh, kyl, cx, cy);
  } else {
    // Lag: [bredde-andel, farve, gennemsigtighed]. Med blanding bruges gennemsigtighed,
    // uden blanding bruges den tilsvarende fuldt dækkende farve.
    const styrke = typeof s.a === 'number' ? s.a : pensel.alpha;   // fast styrke for denne streg
    let lag;
    if (s.m) {
      lag = pensel.blod ? BLOD_LAG.map(([b, a]) => [b, c, a * styrke]) : [[1, c, styrke]];
    } else {
      const rgb = hexTilRgb(c);
      lag = pensel.blod ? BLOD_LAG.map(([b, a]) => [b, inkPaaHvid(rgb, a * styrke), 1]) : [[1, inkPaaHvid(rgb, styrke), 1]];
    }
    tegnEnkeltStreg(s, z, kxh, kxl, kyh, kyl, cx, cy, lag);
  }
  ctx.globalAlpha = 1;
}

function tegnEnkeltStreg(s, z, kxh, kxl, kyh, kyl, cx, cy, lag) {
  const p = s.p;
  const xmin = cx - GRAENSE, xmax = cx + GRAENSE;
  const ymin = cy - GRAENSE, ymax = cy + GRAENSE;
  const indenfor = (x, y) => x > xmin && x < xmax && y > ymin && y < ymax;

  let n = 0;
  let lx = ((p[0] - kxh) - kxl) * z + cx;
  let ly = ((p[1] - kyh) - kyl) * z + cy;
  bufX[0] = lx; bufY[0] = ly; n = 1;
  for (let i = 2; i < p.length; i += 2) {
    const x = ((p[i] - kxh) - kxl) * z + cx;
    const y = ((p[i + 1] - kyh) - kyl) * z + cy;
    const dx = x - lx, dy = y - ly;
    if (dx * dx + dy * dy >= 1.44) {
      bufX[n] = x; bufY[n] = y; n++;
      lx = x; ly = y;
    }
  }
  const slutX = ((p[p.length - 2] - kxh) - kxl) * z + cx;
  const slutY = ((p[p.length - 1] - kyh) - kyl) * z + cy;
  if (n > 1 && (bufX[n - 1] !== slutX || bufY[n - 1] !== slutY)) {
    bufX[n] = slutX; bufY[n] = slutY; n++;
  }

  const linjeB = Math.min(Math.max(s.w * z, 0.3), MAX_LINJEBREDDE);

  if (n === 1) {
    if (!indenfor(bufX[0], bufY[0])) return;
    for (const [b, stil, a] of lag) {
      ctx.fillStyle = stil;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(bufX[0], bufY[0], Math.max(linjeB * b, 0.3) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }

  ctx.beginPath();
  let pennOK = false;
  let ax = bufX[0], ay = bufY[0];
  for (let i = 1; i < n; i++) {
    let cxp = null, cyp = null, bx, by;
    if (i < n - 1) {
      cxp = bufX[i]; cyp = bufY[i];
      bx = (bufX[i] + bufX[i + 1]) / 2;
      by = (bufY[i] + bufY[i + 1]) / 2;
    } else {
      bx = bufX[i]; by = bufY[i];
    }
    const sikker = indenfor(ax, ay) && indenfor(bx, by) &&
                   (cxp === null || indenfor(cxp, cyp));
    if (sikker) {
      if (!pennOK) ctx.moveTo(ax, ay);
      if (cxp === null) ctx.lineTo(bx, by);
      else ctx.quadraticCurveTo(cxp, cyp, bx, by);
      pennOK = true;
    } else {
      const k = klip(ax, ay, bx, by, xmin, xmax, ymin, ymax);
      if (k) {
        ctx.moveTo(k[0], k[1]);
        ctx.lineTo(k[2], k[3]);
      }
      pennOK = false;
    }
    ax = bx; ay = by;
  }
  for (const [b, stil, a] of lag) {
    ctx.strokeStyle = stil;
    ctx.globalAlpha = a;
    ctx.lineWidth = Math.max(linjeB * b, 0.3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ---------- mellemlager og tegning af hele billedet ----------

function sikrBase() {
  if (!baseCanvas || baseCanvas.width !== laerred.width || baseCanvas.height !== laerred.height) {
    baseCanvas = document.createElement('canvas');
    baseCanvas.width = laerred.width;
    baseCanvas.height = laerred.height;
    baseCtx = baseCanvas.getContext('2d');
    baseGyldig = false;
  }
}

function kameraLigBase() {
  return !!baseKamera && baseKamera.node === kamera.node && baseKamera.x === kamera.x &&
         baseKamera.y === kamera.y && baseKamera.zoom === kamera.zoom;
}

// Tegn alle synlige streger (undtagen den, der tegnes lige nu) på mellemlageret,
// i den rækkefølge de blev lavet, så viskelæderet fjerner præcis det, der lå under det.
function tegnAltTilBase() {
  const t0 = performance.now();
  const gammel = ctx;
  ctx = baseCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, bredde, hoejde);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const udenStreg = tegnerNu;
  const liste = [];
  gennemloebAlt((node, s, z, kxh, kxl, kyh, kyl, cx, cy) => {
    if (s !== udenStreg) liste.push({ s, z, kxh, kxl, kyh, kyl, cx, cy });
  });
  liste.sort((a, b) => a.s.id - b.s.id);
  for (const k of liste) tegnStreg(k.s, k.z, k.kxh, k.kxl, k.kyh, k.kyl, k.cx, k.cy);
  ctx = gammel;

  tegnet = liste.length;
  baseGyldig = true;
  baseKamera = { node: kamera.node, x: kamera.x, y: kamera.y, zoom: kamera.zoom };
  fuldTid = fuldTid * 0.6 + (performance.now() - t0) * 0.4;
}

function tegn() {
  snavs = false;
  const nu = performance.now();
  sikrBase();

  if (!forrigeKamera || forrigeKamera.node !== kamera.node || forrigeKamera.x !== kamera.x ||
      forrigeKamera.y !== kamera.y || forrigeKamera.zoom !== kamera.zoom) {
    sidsteBevaegelse = nu;
    forrigeKamera = { node: kamera.node, x: kamera.x, y: kamera.y, zoom: kamera.zoom };
  }

  // På langsomme enheder vises under pan/zoom det gamle billede flyttet/forstørret (hurtigt),
  // og først når bevægelsen stopper, tegnes alt skarpt igen.
  let preview = false;
  if (!baseGyldig) {
    tegnAltTilBase();
  } else if (!kameraLigBase()) {
    if (fuldTid > 12 && !tegnerNu && baseKamera.node === kamera.node && nu - sidsteBevaegelse < 150) {
      preview = true;
    } else {
      tegnAltTilBase();
    }
  }

  const c0 = bredde / 2, c1 = hoejde / 2;
  hovedCtx.setTransform(1, 0, 0, 1, 0, 0);
  hovedCtx.globalCompositeOperation = 'source-over';
  hovedCtx.globalAlpha = 1;
  if (preview) {
    const k = kamera.zoom / baseKamera.zoom;
    const ox = (baseKamera.x - kamera.x) * kamera.zoom;
    const oy = (baseKamera.y - kamera.y) * kamera.zoom;
    hovedCtx.fillStyle = '#ffffff';
    hovedCtx.fillRect(0, 0, laerred.width, laerred.height);
    hovedCtx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (c0 * (1 - k) + ox), dpr * (c1 * (1 - k) + oy));
    hovedCtx.drawImage(baseCanvas, 0, 0, baseCanvas.width, baseCanvas.height, 0, 0, bredde, hoejde);
    previewVentende = true;
  } else {
    hovedCtx.drawImage(baseCanvas, 0, 0);
  }

  hovedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hovedCtx.lineCap = 'round';
  hovedCtx.lineJoin = 'round';

  // Den streg, der tegnes lige nu, tegnes oven på
  if (!preview && tegnerNu && tegnerNode === kamera.node) {
    const gammel = ctx;
    ctx = hovedCtx;
    tegnStreg(tegnerNu, kamera.zoom, kamera.x, 0, kamera.y, 0, c0, c1);
    ctx = gammel;
  }

  // Viskelæderets cirkel
  if (erViskeVaerktoej(vaerktoej) && musX >= 0) {
    hovedCtx.globalAlpha = 1;
    hovedCtx.lineWidth = 1.5;
    hovedCtx.strokeStyle = '#777777';
    hovedCtx.beginPath();
    hovedCtx.arc(musX, musY, STOERRELSE[vaerktoej] / 2, 0, Math.PI * 2);
    hovedCtx.stroke();
  }

  if (visFejlsoeg) {
    const linjer = ['kamera: x=' + kamera.x.toExponential(3) + ' y=' + kamera.y.toExponential(3) +
      ' zoom=' + kamera.zoom.toPrecision(4),
      'historik: ' + fortrydStak.length + ' fortryd, ' + gentagStak.length + ' gentag',
      'fuld tegning: ' + fuldTid.toFixed(1) + ' ms' + (preview ? ' (viser forhåndsvisning)' : '')];
    let m = kamera.node, d = 0;
    while (m && d < 8) {
      linjer.push('niveau ' + m.niveau + ': ' + m.strokes.length + ' streger, ' + m.children.length +
        ' børn, box ' + (m.box ? 'ja' : 'NEJ') + (m.parent ? ', origo ' + m.ox.toExponential(2) + ',' + m.oy.toExponential(2) : ', øverst'));
      m = m.parent; d++;
    }
    fejlsoeg.textContent = linjer.join('\n');
  }
  zoomtekst.textContent = 'Zoom ' + zoomTekst() + ' · niveau ' + kamera.node.niveau +
    ' · ' + tegnet + ' af ' + antalStreger + ' streger tegnet';
}

function loop() {
  if (previewVentende && performance.now() - sidsteBevaegelse >= 150) {
    previewVentende = false;
    snavs = true;
  }
  if (snavs) tegn();
  requestAnimationFrame(loop);
}

