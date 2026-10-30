// Fibres, constructions, presets and physics derivation
import * as THREE from 'three';
import { clamp, rng, hexToRgb, uid, shade } from './util.js';

export const FIBERS = {
  cotton: { n: 'Хлопок', stiff: 1.0, ext: 1.0, fric: 0.62, sheen: 0.05, shrink: 1.0 },
  linen: { n: 'Лён', stiff: 1.7, ext: 0.6, fric: 0.55, sheen: 0.15, shrink: 1.1 },
  ramie: { n: 'Рами', stiff: 1.8, ext: 0.55, fric: 0.5, sheen: 0.25, shrink: 0.9 },
  hemp: { n: 'Конопля', stiff: 1.8, ext: 0.55, fric: 0.6, sheen: 0.1, shrink: 0.9 },
  wool: { n: 'Шерсть', stiff: 0.9, ext: 1.3, fric: 0.7, sheen: 0.05, shrink: 1.2 },
  merino: { n: 'Меринос', stiff: 0.7, ext: 1.35, fric: 0.65, sheen: 0.08, shrink: 1.1 },
  cashmere: { n: 'Кашемир', stiff: 0.55, ext: 1.3, fric: 0.6, sheen: 0.1, shrink: 1.0 },
  mohair: { n: 'Мохер', stiff: 0.7, ext: 1.2, fric: 0.75, sheen: 0.35, shrink: 1.0 },
  alpaca: { n: 'Альпака', stiff: 0.6, ext: 1.25, fric: 0.6, sheen: 0.2, shrink: 1.0 },
  silk: { n: 'Шёлк', stiff: 0.45, ext: 1.0, fric: 0.35, sheen: 0.8, shrink: 0.5 },
  viscose: { n: 'Вискоза', stiff: 0.4, ext: 1.2, fric: 0.42, sheen: 0.4, shrink: 1.3 },
  modal: { n: 'Модал', stiff: 0.45, ext: 1.15, fric: 0.42, sheen: 0.35, shrink: 0.9 },
  lyocell: { n: 'Лиоцелл (тенсел)', stiff: 0.6, ext: 1.05, fric: 0.45, sheen: 0.35, shrink: 0.8 },
  cupro: { n: 'Купро', stiff: 0.42, ext: 1.05, fric: 0.35, sheen: 0.6, shrink: 0.8 },
  polyester: { n: 'Полиэстер', stiff: 0.9, ext: 0.9, fric: 0.35, sheen: 0.35, shrink: 0.15 },
  nylon: { n: 'Полиамид (нейлон)', stiff: 0.7, ext: 1.2, fric: 0.3, sheen: 0.5, shrink: 0.2 },
  acrylic: { n: 'Акрил', stiff: 0.8, ext: 1.1, fric: 0.5, sheen: 0.1, shrink: 0.3 },
  elastane: { n: 'Эластан', stiff: 0.15, ext: 6.0, fric: 0.4, sheen: 0.2, shrink: 0.3 },
  pu: { n: 'Полиуретан (покрытие)', stiff: 2.0, ext: 0.4, fric: 0.55, sheen: 0.5, shrink: 0 },
  wax: { n: 'Воск/пропитка', stiff: 2.2, ext: 0.6, fric: 0.5, sheen: 0.4, shrink: 0 },
  leather: { n: 'Кожа', stiff: 3.0, ext: 0.45, fric: 0.75, sheen: 0.3, shrink: 0 },
};

// warp/weft/bias = extensibility (relative strain), bend = bending factor, tex = surface texture
export const CONS = {
  jersey: { n: 'Кулирная гладь (джерси)', knit: 1, warp: 0.07, weft: 0.26, bias: 0.18, bend: 0.5, tex: 'knit', tile: 0.45 },
  slub: { n: 'Слаб-джерси', knit: 1, warp: 0.07, weft: 0.24, bias: 0.17, bend: 0.5, tex: 'knit', tile: 0.5 },
  interlock: { n: 'Интерлок', knit: 1, warp: 0.05, weft: 0.18, bias: 0.13, bend: 0.75, tex: 'knit', tile: 0.4 },
  rib: { n: 'Рибана 1×1 / 2×2', knit: 1, warp: 0.06, weft: 0.55, bias: 0.3, bend: 0.65, tex: 'rib', tile: 0.6 },
  terry: { n: 'Футер (петля)', knit: 1, warp: 0.045, weft: 0.12, bias: 0.1, bend: 1.0, tex: 'knit', tile: 0.5 },
  fleece: { n: 'Футер с начёсом', knit: 1, warp: 0.04, weft: 0.1, bias: 0.09, bend: 1.1, tex: 'fleece', tile: 1.2 },
  sweater: { n: 'Вязаное полотно', knit: 1, warp: 0.1, weft: 0.32, bias: 0.25, bend: 0.55, tex: 'chunky', tile: 1.0 },
  mesh: { n: 'Сетка', knit: 1, warp: 0.1, weft: 0.2, bias: 0.2, bend: 0.25, tex: 'mesh', tile: 0.35 },
  neoprene: { n: 'Неопрен / скуба', knit: 1, warp: 0.08, weft: 0.12, bias: 0.1, bend: 1.9, tex: 'smooth', tile: 1 },
  plain: { n: 'Полотняное', knit: 0, warp: 0.012, weft: 0.016, bias: 0.08, bend: 1.0, tex: 'plain', tile: 0.22 },
  oxford: { n: 'Рогожка (оксфорд)', knit: 0, warp: 0.012, weft: 0.016, bias: 0.08, bend: 1.05, tex: 'basket', tile: 0.35 },
  twill: { n: 'Саржа / твил', knit: 0, warp: 0.013, weft: 0.02, bias: 0.1, bend: 1.1, tex: 'twill', tile: 0.35 },
  denim: { n: 'Деним (саржа 3/1)', knit: 0, warp: 0.012, weft: 0.018, bias: 0.09, bend: 1.15, tex: 'denim', tile: 0.4 },
  satin: { n: 'Атлас / сатин', knit: 0, warp: 0.01, weft: 0.016, bias: 0.12, bend: 0.65, tex: 'satin', tile: 0.4 },
  gauze: { n: 'Марля / муслин', knit: 0, warp: 0.025, weft: 0.045, bias: 0.16, bend: 0.38, tex: 'gauze', tile: 0.4 },
  crepe: { n: 'Креп', knit: 0, warp: 0.02, weft: 0.04, bias: 0.15, bend: 0.6, tex: 'crepe', tile: 0.6 },
  chiffon: { n: 'Шифон / органза', knit: 0, warp: 0.012, weft: 0.02, bias: 0.12, bend: 0.3, tex: 'plain', tile: 0.15 },
  canvas: { n: 'Канвас / парусина', knit: 0, warp: 0.008, weft: 0.01, bias: 0.05, bend: 1.6, tex: 'canvas', tile: 0.45 },
  velvet: { n: 'Бархат', knit: 0, warp: 0.012, weft: 0.02, bias: 0.1, bend: 1.0, tex: 'velvet', tile: 1 },
  cord: { n: 'Вельвет', knit: 0, warp: 0.012, weft: 0.02, bias: 0.09, bend: 1.25, tex: 'cord', tile: 0.5 },
  felt: { n: 'Сукно / валяная', knit: 0, warp: 0.03, weft: 0.03, bias: 0.03, bend: 1.4, tex: 'fleece', tile: 1.5 },
  jacquard: { n: 'Жаккард', knit: 0, warp: 0.012, weft: 0.016, bias: 0.07, bend: 1.2, tex: 'jacquard', tile: 1.6 },
  ripstop: { n: 'Рипстоп', knit: 0, warp: 0.01, weft: 0.012, bias: 0.07, bend: 0.7, tex: 'ripstop', tile: 0.6 },
  leather: { n: 'Кожа (гладкая)', knit: 0, warp: 0.02, weft: 0.026, bias: 0.03, bend: 2.0, tex: 'leather', tile: 3.5, hide: 1 },
  suede: { n: 'Замша / нубук', knit: 0, warp: 0.025, weft: 0.03, bias: 0.035, bend: 1.6, tex: 'suede', tile: 2.5, hide: 1 },
  coated: { n: 'С покрытием (PU/воск)', knit: 0, warp: 0.012, weft: 0.016, bias: 0.06, bend: 1.5, tex: 'coated', tile: 1.5 },
};

export const FINISHES = {
  none: 'Без обработки',
  garmentdye: 'Окрашено в изделии (garment dye)',
  objectdye: 'Окрашено в объекте (object dye, пятнистость)',
  enzyme: 'Энзимная стирка',
  stone: 'Стоун-вош / выцветание',
  distressed: 'Дистресс (потёртости, дыры)',
  waxed: 'Вощение',
  cracked: 'Кракле (трещины)',
  coated: 'Покрытие / ламинация',
};

const P = (id, name, group, comp, cons, gsm, color, extra = {}) => ({ id, name, group, comp, cons, gsm, color, width: extra.width ?? (CONS[cons].knit ? 180 : 150), finish: 'none', shrink: null, price: 0, thick: null, ...extra });
// composition: [[fiber, %], …]; gsm = г/м²; price ₽/м (кожа — ₽/фут²)
export const PRESETS = [
  P('jer180', 'Кулирка 180', 'Трикотаж', [['cotton', 100]], 'jersey', 180, '#e9e6df', { price: 650 }),
  P('jer200l', 'Кулирка с лайкрой', 'Трикотаж', [['cotton', 95], ['elastane', 5]], 'jersey', 200, '#1b1b1c', { price: 780 }),
  P('jer260', 'Пенье «супрем» плотное', 'Трикотаж', [['cotton', 100]], 'jersey', 260, '#2a2927', { price: 980 }),
  P('slub160', 'Слаб-джерси', 'Трикотаж', [['cotton', 100]], 'slub', 160, '#b9b4aa', { price: 820 }),
  P('vis180', 'Вискозный джерси', 'Трикотаж', [['viscose', 95], ['elastane', 5]], 'jersey', 180, '#141415', { price: 900 }),
  P('mod170', 'Модал-джерси', 'Трикотаж', [['modal', 92], ['elastane', 8]], 'jersey', 170, '#3b3a38', { price: 1100 }),
  P('cup140', 'Купро-джерси', 'Трикотаж', [['cupro', 100]], 'jersey', 140, '#4a4744', { price: 1500 }),
  P('int240', 'Интерлок', 'Трикотаж', [['cotton', 100]], 'interlock', 240, '#d8d4cb', { price: 900 }),
  P('rib280', 'Рибана 2×2', 'Трикотаж', [['cotton', 95], ['elastane', 5]], 'rib', 280, '#1d1d1e', { price: 950 }),
  P('ter320', 'Футер 3-нитка петля', 'Трикотаж', [['cotton', 100]], 'terry', 320, '#5a5650', { price: 1100 }),
  P('fle350', 'Футер с начёсом', 'Трикотаж', [['cotton', 80], ['polyester', 20]], 'fleece', 350, '#2c2c2d', { price: 1150 }),
  P('mer170', 'Меринос-джерси', 'Трикотаж', [['merino', 100]], 'jersey', 170, '#232220', { price: 3200 }),
  P('mohk', 'Мохер, вязка', 'Трикотаж', [['mohair', 70], ['nylon', 30]], 'sweater', 260, '#77706a', { price: 3900 }),
  P('casp', 'Кашемир, вязка', 'Трикотаж', [['cashmere', 100]], 'sweater', 300, '#8c8478', { price: 7800 }),
  P('neo320', 'Скуба / неопрен', 'Трикотаж', [['polyester', 92], ['elastane', 8]], 'neoprene', 320, '#111112', { price: 1300 }),
  P('mesh90', 'Сетка', 'Трикотаж', [['polyester', 100]], 'mesh', 90, '#0f0f10', { price: 600 }),
  P('pop120', 'Поплин', 'Тканые: хлопок, лён', [['cotton', 100]], 'plain', 120, '#f1efea', { price: 700 }),
  P('oxf140', 'Оксфорд', 'Тканые: хлопок, лён', [['cotton', 100]], 'oxford', 140, '#c9c7c0', { price: 780 }),
  P('gau110', 'Двойная марля', 'Тканые: хлопок, лён', [['cotton', 100]], 'gauze', 110, '#dcd6cb', { price: 900 }),
  P('lin185', 'Лён', 'Тканые: хлопок, лён', [['linen', 100]], 'plain', 185, '#a39b8c', { price: 1200 }),
  P('linco', 'Лён-хлопок', 'Тканые: хлопок, лён', [['linen', 55], ['cotton', 45]], 'plain', 200, '#6d685f', { price: 1000 }),
  P('ramie', 'Рами-лён, лёгкий', 'Тканые: хлопок, лён', [['ramie', 70], ['linen', 30]], 'plain', 130, '#cfc9bd', { price: 1300 }),
  P('den12', 'Деним 12 oz', 'Деним и канвас', [['cotton', 100]], 'denim', 407, '#22283a', { price: 1100 }),
  P('den11s', 'Деним стрейч 11 oz', 'Деним и канвас', [['cotton', 98], ['elastane', 2]], 'denim', 373, '#14161c', { price: 1150 }),
  P('den14', 'Селвидж деним 14,5 oz', 'Деним и канвас', [['cotton', 100]], 'denim', 492, '#1c2233', { price: 2600, width: 80 }),
  P('can340', 'Канвас', 'Деним и канвас', [['cotton', 100]], 'canvas', 340, '#8a8170', { price: 950 }),
  P('wax300', 'Вощёный хлопок', 'Деним и канвас', [['cotton', 90], ['wax', 10]], 'canvas', 300, '#2f3027', { price: 1700, finish: 'waxed' }),
  P('cord300', 'Вельвет', 'Деним и канвас', [['cotton', 100]], 'cord', 300, '#4b4136', { price: 1200 }),
  P('gab260', 'Шерстяной габардин', 'Шерсть', [['wool', 100]], 'twill', 260, '#1e1e20', { price: 3100 }),
  P('mel600', 'Мельтон пальтовый', 'Шерсть', [['wool', 80], ['nylon', 20]], 'felt', 600, '#191919', { price: 3600 }),
  P('boil450', 'Валяная шерсть', 'Шерсть', [['wool', 100]], 'felt', 450, '#3a3733', { price: 3300 }),
  P('wsilk', 'Шерсть-шёлк креп', 'Шерсть', [['wool', 70], ['silk', 30]], 'crepe', 180, '#262422', { price: 4200 }),
  P('silkch', 'Шёлк шармёз 19 мм', 'Шёлк и искусственные', [['silk', 100]], 'satin', 81, '#0e0e0f', { price: 4500, width: 114 }),
  P('silkcf', 'Шёлк шифон', 'Шёлк и искусственные', [['silk', 100]], 'chiffon', 40, '#141414', { price: 3200, width: 140 }),
  P('organza', 'Органза шёлковая', 'Шёлк и искусственные', [['silk', 100]], 'chiffon', 50, '#e8e4dc', { price: 3500, width: 140 }),
  P('cuptw', 'Купро твил', 'Шёлк и искусственные', [['cupro', 100]], 'twill', 110, '#2d2b29', { price: 1400 }),
  P('vischal', 'Вискоза шаллис', 'Шёлк и искусственные', [['viscose', 100]], 'plain', 120, '#3e3a35', { price: 700 }),
  P('velv', 'Бархат вискоза/шёлк', 'Шёлк и искусственные', [['viscose', 82], ['silk', 18]], 'velvet', 290, '#151214', { price: 3800, width: 140 }),
  P('jacq', 'Жаккард', 'Шёлк и искусственные', [['polyester', 60], ['viscose', 40]], 'jacquard', 280, '#2a2725', { price: 1900 }),
  P('crepe150', 'Креп полиэстер', 'Техно и синтетика', [['polyester', 100]], 'crepe', 150, '#0d0d0e', { price: 600 }),
  P('rip60', 'Нейлон рипстоп', 'Техно и синтетика', [['nylon', 100]], 'ripstop', 60, '#232425', { price: 900 }),
  P('pu300', 'Экокожа PU на трикотаже', 'Техно и синтетика', [['pu', 60], ['polyester', 40]], 'coated', 300, '#0f0f0f', { price: 900, finish: 'coated' }),
  P('lamb06', 'Кожа ягнёнка 0,6 мм', 'Кожа и замша', [['leather', 100]], 'leather', 520, '#111111', { price: 900, thick: 0.6 }),
  P('goat08', 'Козья кожа 0,8 мм', 'Кожа и замша', [['leather', 100]], 'leather', 700, '#1a1715', { price: 850, thick: 0.8 }),
  P('horse12', 'Конская кожа 1,2 мм, мытая', 'Кожа и замша', [['leather', 100]], 'leather', 1050, '#211d1a', { price: 1400, thick: 1.2, finish: 'enzyme' }),
  P('cow14', 'Кожа КРС 1,4 мм', 'Кожа и замша', [['leather', 100]], 'leather', 1250, '#16120f', { price: 700, thick: 1.4 }),
  P('crack', 'Кожа «кракле»', 'Кожа и замша', [['leather', 100]], 'leather', 800, '#1b1918', { price: 1300, thick: 0.9, finish: 'cracked' }),
  P('suede09', 'Замша 0,9 мм', 'Кожа и замша', [['leather', 100]], 'suede', 700, '#4a3f35', { price: 950, thick: 0.9 }),
];

const SHRINK_BASE = { knit: [5, 6], woven: [3, 2] };

export function makeMaterial(presetId, over = {}) {
  const p = PRESETS.find((x) => x.id === presetId) || PRESETS[0];
  const m = JSON.parse(JSON.stringify(p));
  m.presetId = p.id;
  m.id = uid('m');
  Object.assign(m, over);
  if (!m.shrink) m.shrink = defaultShrink(m);
  return m;
}

export function defaultShrink(m) {
  const c = CONS[m.cons];
  if (c.hide) return [0, 0];
  let f = 0;
  for (const [fb, pct] of m.comp) f += (FIBERS[fb]?.shrink ?? 1) * pct / 100;
  const base = c.knit ? SHRINK_BASE.knit : SHRINK_BASE.woven;
  let k = f;
  if (m.finish === 'garmentdye' || m.finish === 'objectdye') k += 0.6;
  return [Math.round(base[0] * k * 10) / 10, Math.round(base[1] * k * 10) / 10];
}

// physical model ----------------------------------------------------------
export function physics(m) {
  const c = CONS[m.cons] || CONS.plain;
  let stiff = 0, ext = 0, fric = 0, sheen = 0, tot = 0, el = 0;
  for (const [f, pct] of m.comp) {
    const F = FIBERS[f]; if (!F) continue;
    tot += pct;
    if (f === 'elastane') { el += pct; continue; }
    stiff += F.stiff * pct; ext += F.ext * pct; fric += F.fric * pct; sheen += F.sheen * pct;
  }
  const nonEl = Math.max(1, tot - el);
  stiff /= nonEl; ext /= nonEl; fric /= nonEl; sheen /= nonEl;
  const gsm = clamp(+m.gsm || 150, 20, 2000);
  let warp = c.warp * ext + el * (c.knit ? 0.012 : 0.004);
  let weft = c.weft * ext + el * (c.knit ? 0.07 : 0.05);
  let bias = c.bias * ext + el * (c.knit ? 0.035 : 0.025);
  let bendF = 1;
  if (m.finish === 'waxed' || m.finish === 'coated') { bendF = 1.35; warp *= 0.7; weft *= 0.7; bias *= 0.6; }
  if (m.finish === 'enzyme' || m.finish === 'stone' || m.finish === 'garmentdye') bendF = 0.85;
  if (m.finish === 'cracked') bendF = 1.15;
  const thick = m.thick ? m.thick / 10 : clamp((gsm / 10000) * (c.knit ? 3.2 : 2.2) * (m.cons === 'fleece' || m.cons === 'sweater' || m.cons === 'felt' ? 1.8 : 1), 0.008, 0.5); // cm
  const bend = c.bend * stiff * bendF * Math.pow(gsm / 200, 1.5); // relative bending rigidity
  const drape = clamp(0.5 + 0.2 * Math.log(bend), 0.05, 0.98); // ≈ drape coefficient (0 = текучая, 1 = жёсткая)
  const o = m.phys || {};
  return {
    gsm, warp: o.warp ?? warp, weft: o.weft ?? weft, bias: o.bias ?? bias, bend: o.bend ?? bend,
    fric: o.fric ?? clamp(fric + (m.cons === 'fleece' || m.cons === 'suede' ? 0.15 : 0) - (m.cons === 'satin' ? 0.12 : 0), 0.1, 0.95),
    damp: o.damp ?? clamp(0.9 * Math.sqrt(100 / gsm), 0.05, 2.5),
    thick, drape, knit: !!c.knit, el,
    rough: m.cons === 'leather' ? (m.finish === 'enzyme' ? 0.62 : 0.48) : m.cons === 'satin' ? 0.42 : m.finish === 'waxed' || m.finish === 'coated' ? 0.45 : m.cons === 'velvet' ? 0.95 : 0.88,
    sheen: m.cons === 'velvet' ? 1 : clamp(sheen * (m.cons === 'satin' ? 1.4 : 0.8), 0, 1),
    tex: c.tex, tile: c.tile,
  };
}

export function describe(m) {
  const ph = physics(m);
  const st = (v) => (v * 100 < 4 ? 'почти нет' : Math.round(v * 100) + '%');
  return {
    drape: ph.drape < 0.35 ? 'текучая' : ph.drape < 0.6 ? 'мягкая' : ph.drape < 0.8 ? 'держит форму' : 'жёсткая, архитектурная',
    stretch: `основа ${st(ph.warp)} · уток ${st(ph.weft)} · косая ${st(ph.bias)}`,
    ph,
  };
}

export function compString(m) {
  return m.comp.map(([f, p]) => `${(FIBERS[f]?.n || f).toLowerCase()} ${p}%`).join(' + ');
}

// textures -----------------------------------------------------------------
const normalCache = {};
export function normalMap(kind) {
  if (normalCache[kind]) return normalCache[kind];
  const S = 128, hgt = new Float32Array(S * S), r = rng(kind.length * 97 + 13);
  const noise = () => r() - 0.5;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      let h = 0;
      switch (kind) {
        case 'knit': { const col = (u * 4) % 1, row = (v * 6) % 1; const vv = Math.abs(col - 0.5) * 2; h = Math.sin(Math.PI * row) * 0.5 + (1 - Math.abs(vv - (row < 0.5 ? row : 1 - row) * 1.2)) * 0.6; break; }
        case 'rib': h = Math.pow(Math.abs(Math.sin(Math.PI * u * 4)), 0.6) + 0.2 * Math.sin(Math.PI * v * 12); break;
        case 'chunky': { const col = (u * 2) % 1, row = (v * 3) % 1; h = Math.sin(Math.PI * row) * (1 - Math.abs(col - 0.5)) * 1.2; break; }
        case 'plain': case 'gauze': h = Math.sin(Math.PI * 2 * u * 4) * Math.sin(Math.PI * 2 * v * 4) * (kind === 'gauze' ? 1.3 : 0.7); break;
        case 'basket': h = Math.sin(Math.PI * 2 * u * 3) * Math.sin(Math.PI * 2 * v * 3); break;
        case 'twill': case 'denim': h = Math.sin(Math.PI * 2 * (u * 4 + v * 4)) * 0.8 + 0.2 * Math.sin(Math.PI * 2 * v * 16); break;
        case 'satin': h = 0.15 * Math.sin(Math.PI * 2 * v * 8); break;
        case 'crepe': h = 0; break;
        case 'canvas': h = Math.sin(Math.PI * 2 * u * 3) * Math.sin(Math.PI * 2 * v * 3) * 1.2; break;
        case 'cord': h = Math.pow(Math.abs(Math.sin(Math.PI * u * 3)), 0.5) * 1.5; break;
        case 'ripstop': h = (u * 4 % 1 < 0.08 || v * 4 % 1 < 0.08 ? 1 : 0) + 0.3 * Math.sin(Math.PI * 2 * u * 16) * Math.sin(Math.PI * 2 * v * 16); break;
        case 'mesh': { const a = (u * 4) % 1 - 0.5, b = (v * 4) % 1 - 0.5; h = Math.hypot(a, b) < 0.3 ? -1 : 0.6; break; }
        case 'jacquard': h = Math.sin(Math.PI * 2 * (u * 2)) * Math.cos(Math.PI * 2 * (v * 2) + Math.sin(Math.PI * 2 * u * 2)) * 0.9; break;
        default: h = 0;
      }
      hgt[y * S + x] = h;
    }
  if (['leather', 'suede', 'fleece', 'crepe', 'velvet', 'smooth', 'coated'].includes(kind)) {
    // value noise
    const amp = { leather: 1.2, suede: 0.6, fleece: 1, crepe: 1.3, velvet: 0.4, smooth: 0.2, coated: 0.3 }[kind];
    const oct = (f) => {
      const g = new Float32Array((f + 1) * (f + 1)); for (let i = 0; i < g.length; i++) g[i] = noise();
      return (x, y) => { const fx = (x / S) * f, fy = (y / S) * f, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy; const G = (a, b) => g[((b % f) * (f + 1)) + (a % f)]; const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty); return (G(ix, iy) * (1 - sx) + G(ix + 1, iy) * sx) * (1 - sy) + (G(ix, iy + 1) * (1 - sx) + G(ix + 1, iy + 1) * sx) * sy; };
    };
    const o1 = oct(8), o2 = oct(16), o3 = oct(32);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let v = o1(x, y) + 0.5 * o2(x, y) + 0.25 * o3(x, y);
      if (kind === 'leather') v = -Math.abs(v) * 1.6 + 0.3 * o3(x, y);
      hgt[y * S + x] = v * amp * 2;
    }
  }
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(S, S);
  const strength = 2.2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const hL = hgt[y * S + ((x - 1 + S) % S)], hR = hgt[y * S + ((x + 1) % S)], hD = hgt[((y + 1) % S) * S + x], hU = hgt[((y - 1 + S) % S) * S + x];
    let nx = (hL - hR) * strength, ny = (hD - hU) * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * S + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  normalCache[kind] = t;
  return t;
}

// paint fabric colour + finish into a 2D canvas region (pattern-space in cm, ctx already transformed)
export function paintFabric(ctx, m, bx, seed = 1) {
  const r = rng(seed * 7919 + 17);
  const base = m.color || '#777777';
  ctx.fillStyle = base;
  ctx.fillRect(bx.x0 - 5, bx.y0 - 5, bx.w + 10, bx.h + 10);
  const [R, G, B] = hexToRgb(base);
  const lum = (0.3 * R + 0.59 * G + 0.11 * B) / 255;
  const light = lum < 0.25 ? 0.12 : 0.06;
  const cons = m.cons;
  // construction tint details
  if (cons === 'denim') {
    ctx.globalAlpha = 0.18; ctx.strokeStyle = '#d8dce6'; ctx.lineWidth = 0.08;
    for (let x = bx.x0 - bx.h; x < bx.x1; x += 0.35) { ctx.beginPath(); ctx.moveTo(x, bx.y0); ctx.lineTo(x + bx.h, bx.y1); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  if (cons === 'slub' || m.presetId === 'den14') {
    ctx.globalAlpha = 0.14;
    for (let i = 0; i < bx.h * 2.5; i++) {
      const y = bx.y0 + r() * bx.h, x = bx.x0 + r() * bx.w, l = 2 + r() * 10;
      ctx.fillStyle = r() < 0.5 ? shade(base, 0.35) : shade(base, -0.3);
      ctx.fillRect(x, y, l, 0.12 + r() * 0.15);
    }
    ctx.globalAlpha = 1;
  }
  if (cons === 'cord') {
    ctx.globalAlpha = 0.25; ctx.fillStyle = shade(base, -0.4);
    for (let x = bx.x0; x < bx.x1; x += 0.5) ctx.fillRect(x, bx.y0, 0.12, bx.h);
    ctx.globalAlpha = 1;
  }
  if (cons === 'jacquard') {
    ctx.globalAlpha = 0.22; ctx.strokeStyle = shade(base, 0.4); ctx.lineWidth = 0.25;
    for (let y = bx.y0; y < bx.y1; y += 4) for (let x = bx.x0; x < bx.x1; x += 4) { ctx.beginPath(); ctx.ellipse(x + 2, y + 2, 1.4, 0.8, 0.6, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  if (cons === 'mohair' || cons === 'sweater' || cons === 'fleece') {
    ctx.globalAlpha = 0.07;
    for (let i = 0; i < bx.w * bx.h * 0.25; i++) { ctx.fillStyle = r() < 0.5 ? '#fff' : '#000'; ctx.fillRect(bx.x0 + r() * bx.w, bx.y0 + r() * bx.h, 0.5, 0.5); }
    ctx.globalAlpha = 1;
  }
  // finishes
  const f = m.finish;
  if (f === 'garmentdye' || f === 'objectdye' || f === 'enzyme' || f === 'stone') {
    const n = f === 'objectdye' ? 70 : 30;
    for (let i = 0; i < n * (bx.w * bx.h) / 3000; i++) {
      const x = bx.x0 + r() * bx.w, y = bx.y0 + r() * bx.h, rad = (f === 'objectdye' ? 4 : 6) + r() * 14;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const tone = f === 'stone' ? shade(base, 0.25) : r() < 0.5 ? shade(base, light * 1.8) : shade(base, -0.25);
      g.addColorStop(0, tone); g.addColorStop(1, tone + '00');
      ctx.globalAlpha = f === 'objectdye' ? 0.5 : 0.28;
      ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    ctx.globalAlpha = 1;
  }
  if (f === 'distressed') {
    for (let i = 0; i < (bx.w * bx.h) / 260; i++) {
      const x = bx.x0 + r() * bx.w, y = bx.y0 + r() * bx.h;
      ctx.globalAlpha = 0.35; ctx.strokeStyle = shade(base, 0.45); ctx.lineWidth = 0.08;
      for (let k = 0; k < 9; k++) { ctx.beginPath(); ctx.moveTo(x + r() * 3, y + k * 0.25); ctx.lineTo(x + 3 + r() * 3, y + k * 0.25 + r() * 0.1); ctx.stroke(); }
      if (r() < 0.12) { ctx.globalAlpha = 0.9; ctx.fillStyle = '#050505'; ctx.beginPath(); ctx.ellipse(x + 2, y + 1, 0.6 + r(), 0.3 + r() * 0.5, r(), 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }
  if (f === 'cracked') {
    ctx.globalAlpha = 0.5; ctx.strokeStyle = shade(base, 0.32); ctx.lineWidth = 0.06;
    for (let i = 0; i < (bx.w * bx.h) / 9; i++) {
      let x = bx.x0 + r() * bx.w, y = bx.y0 + r() * bx.h;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) { x += (r() - 0.5) * 2.2; y += (r() - 0.5) * 2.2; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (f === 'waxed') {
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < (bx.w * bx.h) / 400; i++) { ctx.strokeStyle = shade(base, 0.3); ctx.lineWidth = 0.15; ctx.beginPath(); const x = bx.x0 + r() * bx.w, y = bx.y0 + r() * bx.h; ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 2, y + 3 * r(), x + 5 * r(), y + 6); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  if (cons === 'leather' || cons === 'suede') {
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < (bx.w * bx.h) / 600; i++) {
      const x = bx.x0 + r() * bx.w, y = bx.y0 + r() * bx.h, rad = 6 + r() * 18;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const tone = r() < 0.5 ? shade(base, 0.2) : shade(base, -0.3);
      g.addColorStop(0, tone); g.addColorStop(1, tone + '00'); ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    ctx.globalAlpha = 1;
  }
}
