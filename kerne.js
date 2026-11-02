'use strict';
// KERNE: skalering, niveauer (uendelig zoom), kamera, dobbelt-præcision og gennemløb af alle synlige streger.

function skaler() {
  dpr = window.devicePixelRatio || 1;
  bredde = window.innerWidth;
  hoejde = window.innerHeight;
  laerred.width = Math.round(bredde * dpr);
  laerred.height = Math.round(hoejde * dpr);
  baseGyldig = false;
  snavs = true;
}

// ---------- niveauer ----------

function udvidBox(node, x0, x1, y0, y1) {
  let n = node;
  while (n) {
    const b = n.box;
    if (!b) {
      n.box = { minX: x0, maxX: x1, minY: y0, maxY: y1 };
    } else {
      if (x0 >= b.minX && x1 <= b.maxX && y0 >= b.minY && y1 <= b.maxY) return;
      if (x0 < b.minX) b.minX = x0;
      if (x1 > b.maxX) b.maxX = x1;
      if (y0 < b.minY) b.minY = y0;
      if (y1 > b.maxY) b.maxY = y1;
    }
    if (!n.parent) return;
    x0 = n.ox + x0 / S; x1 = n.ox + x1 / S;
    y0 = n.oy + y0 / S; y1 = n.oy + y1 / S;
    n = n.parent;
  }
}

function gaaInd() {
  const n = kamera.node;
  let barn = null;
  for (const ch of n.children) {
    const b = ch.box;
    if (!b) continue;
    if (kamera.x >= ch.ox + b.minX / S && kamera.x <= ch.ox + b.maxX / S &&
        kamera.y >= ch.oy + b.minY / S && kamera.y <= ch.oy + b.maxY / S) {
      barn = ch;
      break;
    }
  }
  if (!barn) {
    barn = nyNode(n, kamera.x, kamera.y, n.niveau + 1);
    n.children.push(barn);
  }
  kamera.x = (kamera.x - barn.ox) * S;
  kamera.y = (kamera.y - barn.oy) * S;
  kamera.zoom /= S;
  kamera.node = barn;
}

function gaaOp() {
  const n = kamera.node;
  let p = n.parent;
  if (!p) {
    // Zoomer ud over det øverste niveau: lav et nyt forældreniveau
    p = nyNode(null, 0, 0, n.niveau - 1);
    p.children.push(n);
    n.parent = p;
    n.ox = 0; n.oy = 0;
    // det nye forældreniveau skal kende udstrækningen af det indhold, der allerede findes
    if (n.box) {
      p.box = { minX: n.box.minX / S, maxX: n.box.maxX / S,
                minY: n.box.minY / S, maxY: n.box.maxY / S };
    }
  }
  kamera.x = n.ox + kamera.x / S;
  kamera.y = n.oy + kamera.y / S;
  kamera.zoom *= S;
  kamera.node = p;
  // ryd tomme børn op, så der ikke samles skrald
  if (n !== start && !n.box && n.children.length === 0) {
    const i = p.children.indexOf(n);
    if (i >= 0) p.children.splice(i, 1);
  }
}

function skiftNiveau() {
  if (!(kamera.zoom > 0) || !isFinite(kamera.zoom)) { kamera.zoom = 1; }
  let skiftet = false;
  while (kamera.zoom >= ZOOM_IND) { gaaInd(); skiftet = true; }
  while (kamera.zoom < ZOOM_OP) { gaaOp(); skiftet = true; }
  // Sikkerhedsnet: hvis kameraets position er blevet ugyldig, flyt det til niveauets midte
  if (!isFinite(kamera.x) || !isFinite(kamera.y)) { kamera.x = 0; kamera.y = 0; }
  if (skiftet) { afslutStreg(); afslutSlet(); }
}

// ---------- kamera ----------

function tilVerden(sx, sy) {
  return [
    kamera.x + (sx - bredde / 2) / kamera.zoom,
    kamera.y + (sy - hoejde / 2) / kamera.zoom
  ];
}

function zoomOmkring(sx, sy, nyZoom) {
  if (!(nyZoom > 0) || !isFinite(nyZoom)) return;
  const [wx, wy] = tilVerden(sx, sy);
  kamera.zoom = nyZoom;
  kamera.x = wx - (sx - bredde / 2) / nyZoom;
  kamera.y = wy - (sy - hoejde / 2) / nyZoom;
  skiftNiveau();
  snavs = true;
}

function panSkaerm(dx, dy) {
  kamera.x -= dx / kamera.zoom;
  kamera.y -= dy / kamera.zoom;
  snavs = true;
}

function zoomTekst() {
  const logZ = Math.log10(kamera.zoom) + kamera.node.niveau * 3;
  if (Math.abs(logZ) < 3) return (Math.pow(10, logZ)).toPrecision(3) + '×';
  return '10^' + logZ.toFixed(1) + '×';
}

// ---------- dobbelt-præcision (to doubles: hi + lo) til kameraets position ----------
// Når vi tegner store forfædre-niveauer, ganges forskelle med enorme tal. Derfor holder vi
// kameraets position som to tal, så afstanden til en streg bliver nøjagtig.

function twoSum(a, b) {
  const s = a + b;
  const bb = s - a;
  return [s, (a - (s - bb)) + (b - bb)];
}

function twoProd(a, b) {
  const p = a * b;
  const ca = 134217729 * a, ah = ca - (ca - a), al = a - ah;
  const cb = 134217729 * b, bh = cb - (cb - b), bl = b - bh;
  return [p, ((ah * bh - p) + ah * bl + al * bh) + al * bl];
}

function ddPlus(h, l, b) {            // (h + l) + b
  const t = twoSum(h, b);
  return twoSum(t[0], t[1] + l);
}

function ddDivS(h, l) {               // (h + l) / S
  const q1 = h / S;
  const pr = twoProd(q1, S);
  const q2 = (((h - pr[0]) - pr[1]) + l) / S;
  return twoSum(q1, q2);
}

function ddMulS(h, l) {               // (h + l) * S
  const pr = twoProd(h, S);
  return twoSum(pr[0], pr[1] + l * S);
}

// ---------- gennemløb af alle synlige streger (bruges af tegning og "slet streg") ----------

// Besøg alle streger i et niveau (og dets børn), som kan ses med kameraet (kx, ky, z)
// udtrykt i dette niveaus koordinater. "ikke" er et barn, der springes over.
function gennemloebNode(node, kxh, kxl, kyh, kyl, z, ikke, besog) {
  const cx = bredde / 2, cy = hoejde / 2;
  const halvB = cx / z, halvH = cy / z;
  const vMinX = kxh - halvB, vMaxX = kxh + halvB;
  const vMinY = kyh - halvH, vMaxY = kyh + halvH;

  for (const s of node.strokes) {
    const pad = s.w / 2;
    if (s.maxX + pad < vMinX || s.minX - pad > vMaxX ||
        s.maxY + pad < vMinY || s.minY - pad > vMaxY) continue;
    const stoerrelse = Math.max(s.maxX - s.minX, s.maxY - s.minY) * z + s.w * z;
    if (stoerrelse < 0.5) continue;
    besog(node, s, z, kxh, kxl, kyh, kyl, cx, cy);
  }

  const cz = z / S;
  for (const ch of node.children) {
    if (ch === ikke || !ch.box) continue;
    const nx = ddMulS(...ddPlus(kxh, kxl, -ch.ox));
    const ny = ddMulS(...ddPlus(kyh, kyl, -ch.oy));
    const b = ch.box;
    const hb = cx / cz, hh = cy / cz;
    if (b.maxX < nx[0] - hb || b.minX > nx[0] + hb ||
        b.maxY < ny[0] - hh || b.minY > ny[0] + hh) continue;
    if (Math.max(b.maxX - b.minX, b.maxY - b.minY) * cz < 0.5) continue;
    gennemloebNode(ch, nx[0], nx[1], ny[0], ny[1], cz, null, besog);
  }
}

function gennemloebAlt(besog) {
  // Forfædre (større niveauer) først, så kameraets eget niveau og dets børn
  const kaede = [];
  let n = kamera.node, z = kamera.zoom;
  let xh = kamera.x, xl = 0, yh = kamera.y, yl = 0;
  while (n.parent) {
    const p = n.parent;
    let t = ddDivS(xh, xl); t = ddPlus(t[0], t[1], n.ox); xh = t[0]; xl = t[1];
    t = ddDivS(yh, yl); t = ddPlus(t[0], t[1], n.oy); yh = t[0]; yl = t[1];
    z = z * S;
    if (z > MAX_ANCESTOR_ZOOM) break;
    kaede.push({ node: p, xh, xl, yh, yl, z, ikke: n });
    n = p;
  }
  for (let i = kaede.length - 1; i >= 0; i--) {
    const k = kaede[i];
    gennemloebNode(k.node, k.xh, k.xl, k.yh, k.yl, k.z, k.ikke, besog);
  }
  gennemloebNode(kamera.node, kamera.x, 0, kamera.y, 0, kamera.zoom, null, besog);
}

