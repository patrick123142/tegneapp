'use strict';
// GRUNDLAG: version, referencer til sidens elementer, konstanter, penseltyper og al tilstand (variabler).
// Indlæses først.
// Bid 6: flere lærreder (galleri) og automatisk gem. (Bid 5: farver. Bid 4: pensler og præcist viskelæder.)
// Bygger på bid 2 (uendelig zoom) og bid 3 (fortryd/gentag, tryk).
//
// Lærredet er et træ af koordinatsystemer ("niveauer"). Hvert niveau er S gange mere forstørret
// end sit forældreniveau. Kameraet har altid en moderat zoom i det niveau, det står i, og
// skifter automatisk til et barn (ind) eller en forælder (ud). Dermed mister vi aldrig præcision.
//
// Viskelæderet ("visk") er en hvid streg, der tegnes i samme rækkefølge som alt andet
// (efter tidspunkt). Den fjerner altså præcis det, den rører, uanset zoom og niveau,
// og kan fortrydes. "Slet streg" fjerner derimod hele streger.
const VERSION = 8; // bid 7: fliser, forenklede streger og trinvist gem

const laerred = document.getElementById('laerred');
const hovedCtx = laerred.getContext('2d');
let ctx = hovedCtx;   // den lærred der tegnes på lige nu (hoved- eller mellemlager)
const zoomtekst = document.getElementById('zoomtekst');
const nulstilKnap = document.getElementById('nulstil');
const knapFortryd = document.getElementById('knapFortryd');
const knapGentag = document.getElementById('knapGentag');
const stoerrelseGlider = document.getElementById('stoerrelse');
const stoerrelseTal = document.getElementById('stoerrelseTal');
const vaerktoejKnapper = Array.from(document.querySelectorAll('[data-v]'));
const menu = document.getElementById('menu');
const menuKnap = document.getElementById('menuKnap');
const trykGlider = document.getElementById('trykfoelsomhed');
const trykTal = document.getElementById('trykTal');
const fliseKnap = document.getElementById('fliseKnap');
const farveKnap = document.getElementById('farveKnap');
const blandKnap = document.getElementById('blandKnap');
const trykKnap = document.getElementById('trykKnap');
const trykDel = document.getElementById('trykDel');
const trykMaaling = document.getElementById('trykMaaling');
const brugHoejesteKnap = document.getElementById('brugHoejeste');
const nulstilMaalingKnap = document.getElementById('nulstilMaaling');
const styrkeGlider = document.getElementById('styrke');
const styrkeTal = document.getElementById('styrkeTal');
const farveProeve = document.getElementById('farveProeve');
const farveHex = document.getElementById('farveHex');
const farvePanel = document.getElementById('farvePanel');
const farvehjul = document.getElementById('farvehjul');
const hjulCtx = farvehjul.getContext('2d');
const lysstyrkeGlider = document.getElementById('lysstyrke');
const gemFarveKnap = document.getElementById('gemFarve');
const fjernFarveKnap = document.getElementById('fjernFarve');
const gemteFarverEl = document.getElementById('gemteFarver');

// Fejlsøgningsvindue: tryk på tasten D for at vise/skjule
const fejlsoeg = document.createElement('div');
fejlsoeg.style.cssText = 'position:fixed;right:12px;top:12px;padding:6px 10px;background:rgba(255,255,255,0.92);' +
  'border:1px solid #d0d0d0;border-radius:8px;font:12px monospace;white-space:pre;color:#222;display:none';
document.body.appendChild(fejlsoeg);
let visFejlsoeg = false;

const S = 1000;          // forstørrelse mellem to niveauer
const ZOOM_IND = 1000;   // zoom ind i et barn, når zoom når hertil
const ZOOM_OP = 0.1;     // zoom op til forælderen, når zoom kommer under dette
const MAX_ANCESTOR_ZOOM = 1e27; // forfædre tegnes, så længe de er under denne zoom
const GRAENSE = 30000;   // maks. afstand fra skærmens midte (px), som tegnes direkte
const MAX_LINJEBREDDE = 100000;
const HISTORIK_MAX = 1000;

// Penseltyper.
//   alpha: gennemsigtighed uden tryk (mus/finger)
//   bredde: [mindst, størst] andel af penselstørrelsen ved tryk (stylus)
//   styrke: [mindst, størst] gennemsigtighed ved tryk (stylus)
//   fart: uden stylus følger bredden farten (kun fyldepen)
const PENSLER = {
  spids:    { alpha: 0.95, blod: false, bredde: [1, 1],    styrke: [0.2, 0.95] },
  blod:     { alpha: 1,    blod: true,  bredde: [1, 1],    styrke: [0.15, 1]   },
  fyldepen: { alpha: 1,    blod: false, bredde: [0.2, 1],  styrke: [1, 1], fart: true },
  tusse:    { alpha: 0.9,  blod: false, bredde: [1, 1],    styrke: [0.55, 0.95] }
};
// Blød blyant tegnes som tre lag oven på hinanden (bred og svag, smal og stærk)
const BLOD_LAG = [[1.0, 0.16], [0.65, 0.22], [0.3, 0.35]];

// Størrelser (diameter i skærmpixels) og grænser pr. værktøj
const STOERRELSE = { spids: 2.5, blod: 8, fyldepen: 4, tusse: 9, visk: 24, slet: 24, pipette: 6 };
const GRAENSER = {
  spids: [0.5, 12], blod: [2, 60], fyldepen: [1, 30], tusse: [2, 60], visk: [4, 300], slet: [4, 300], pipette: [3, 30]
};

function nyNode(parent, ox, oy, niveau) {
  // ox, oy: barnets origo i forælderens koordinater. strokes: i nodens egne koordinater.
  // box: udstrækning af alt indhold (inkl. børn) i nodens egne koordinater, eller null.
  return { parent, ox, oy, niveau, strokes: [], children: [], box: null, nid: null };
}

let start = nyNode(null, 0, 0, 0);
const kamera = { node: start, x: 0, y: 0, zoom: 1 };

let bredde = 0, hoejde = 0, dpr = 1;
let tegnerNu = null, tegnerNode = null;     // streg under tegning
let sletAktiv = false, sletItems = [];      // slettede streger under et "slet streg"-træk
let vaerktoej = 'spids';
let musX = -1, musY = -1;                   // sidste pegerposition (til viskelæder-cirklen)
const pegere = new Map();
let bevaegelse = null;
let hoejreTraek = null;
let snavs = true;
let tegnet = 0;
let antalStreger = 0;
let naesteId = 1;                           // tegnerækkefølge: lavt id tegnes først
const fortrydStak = [], gentagStak = [];

let bufX = [], bufY = [], bufT = [];
let trykFuld = 0.55;     // andel af stylussens maksimale tryk, hvor stregen er på fuld styrke
let menuAaben = true;
let lagCanvas = null, lagCtx = null;   // midlertidigt lag til streger med varierende gennemsigtighed

// Farver
const STANDARD_FARVER = ['#000000', '#555555', '#d62828', '#f77f00', '#fcbf49', '#2a9d3f', '#1d6fd6', '#7b2cbf', '#8b5a2b'];
const MAX_GEMTE = 30;
let farve = '#000000';                  // den farve, der tegnes med
let farveH = 0, farveS = 0, farveV = 0; // samme farve som farvetone, mætning, lysstyrke (0-1)
let gemteFarver = [];
let farvePanelAaben = false;
let hjulTrukket = false;
let sidstePensel = 'spids';             // pipetten vender tilbage til denne pensel
let blandFarver = false;                // til: overlap blander/mørkner farver. fra: ny streg dækker det under
let trykTil = true;                     // stylussens tryk styrer styrken (fra: fast styrke)
let fastStyrke = 1;                     // fast styrke (0,05-1) for mus, finger og når tryk er fra
let hoejesteTryk = 0;                   // højeste rå tryk målt fra stylus (til kalibrering)

// Mellemlager: alt undtagen den streg, der tegnes lige nu, så der kun skal tegnes én streg pr. billede
let baseCanvas = null, baseCtx = null, baseGyldig = false, baseKamera = null;

// Fliser (bid 9): se fliser.js
const FLISE_PX = 256;                    // en flises størrelse i enhedens pixels
const FLISE_MIN = -3, FLISE_MAX = 10;    // flise-niveauer svarer til zoom 2^niveau
const MAX_FLISER = 450;                  // højst så mange flise-billeder i hukommelsen (ca. 115 MB)
let brugFliser = true;                   // fliser (hurtig) eller den klassiske tegnemetode (reserve)
let fliseAntal = 0, fliseCanvasAntal = 0, fliseFrame = 0, sidsteFliseMs = 0, fliseMangler = false;
const fliseNoder = new Set();            // niveauer, der har fliser
let fliseBassin = [];                    // genbrugte flise-billeder
let kompA = null, kompB = null, kompNyt = null, kompSenest = null, kompKamera = null, forrigeBevKamera = null;
let maalB = 0, maalH = 0;                // størrelse (css-pixels) på det område, der tegnes på lige nu
let forrigeKamera = null, sidsteBevaegelse = 0, previewVentende = false;
let fuldTid = 0;                        // gennemsnitlig tid (ms) for at tegne hele lærredet

