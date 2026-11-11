// @ts-check
// Библиотека лекал: параметрические конструкции КРОМКИ (строятся по меркам манекена) с фасетами для поиска —
// категория, силуэт, детали, ткань, сложность и стилистические ассоциации с дизайнерами.
// Ассоциации — это приёмы кроя, которые узнаются в работах дизайнера (заниженная мотня, кожаный клёш, шнуровка…),
// а НЕ оригинальные лекала брендов: дома моды свои лекала не публикуют.
// Детали изделия (молнии, люверсы, сырые края, накладные карманы) описаны декларативно в decor и
// накладываются после каждой генерации (applyDecor), поэтому переживают правку параметров.
import { GARMENT_PRESETS, edgeK } from './patterns.js';
import { PRESETS } from './materials.js';
import { addDecorZip, zipEdges, zipPartner, hardwareAlong } from './hardware.js';
import { uid, bbox, inside } from './util.js';

/** дизайнеры и бренды для фильтра «Ассоциации»; a — как ещё ищут (латиница, кириллица, сокращения) */
export const DESIGNERS = [
  { id: 'rick', n: 'Rick Owens', a: ['рик', 'оуэнс', 'owens', 'drkshdw', 'дркшдв'], note: 'вытянутые силуэты, заниженная мотня, асимметрия, воронки, кожа' },
  { id: 'julius', n: 'Julius', a: ['юлиус', 'horikawa', 'хорикава', '_7'], note: 'многослойность, драпировка, удлинённые рукава, карго, молнии' },
  { id: 'iswn', n: 'if six was nine', a: ['ифсикс', 'iswn', 'isvn', 'six was nine'], note: 'рок 70-х: кожаный клёш, узкий верх, каблук' },
  { id: 'lgb', n: 'L.G.B.', a: ['lgb', 'le grand bleu', 'лгб'], note: 'клёш, состаривание, слои, сырые края' },
  { id: 'n9', n: 'Number (N)ine', a: ['number nine', 'number', 'намбер', 'найн', 'miyashita', 'мияшита'], note: 'гранж: мохер, узкие джинсы, термо, рваные края' },
  { id: 'ann', n: 'Ann Demeulemeester', a: ['анн', 'демельмейстер', 'demeulemeester', 'ann d'], note: 'длинные асимметричные слои, шнуровка, чёрное' },
  { id: '14th', n: '14th Addiction', a: ['14th', 'фортинс', 'addiction', 'аддикшн'], note: 'кожа, клёш, шнуровка, фурнитура' },
  { id: 'kmrii', n: 'KMRii', a: ['кмрии', 'kmri', 'кемури'], note: 'панк: молнии, кожа, сетка' },
  { id: 'balmain', n: 'Balmain', a: ['бальман', 'балмейн', 'decarnin', 'декарнен'], note: 'байкерские джинсы с рельефом у колена, косуха' },
  { id: 'yohji', n: 'Yohji Yamamoto', a: ['йоджи', 'ямамото', 'yohji', 'yamamoto'], note: 'широкие брюки, объём, асимметрия' },
  { id: 'ccp', n: 'Carol Christian Poell', a: ['ccp', 'поэлл', 'poell'], note: 'сырые края, кожа, видимые швы' },
  { id: 'helmut', n: 'Helmut Lang', a: ['хельмут', 'ланг', 'helmut'], note: 'минимализм 90-х, узкие силуэты, ремни' },
];

/** открытые источники лекал: что это, условия, и как ими пользоваться вместе с КРОМКОЙ */
export const OPEN_SOURCES = [
  { n: 'FreeSewing', url: 'https://freesewing.org', lic: 'код и конструкции — MIT', what: 'Десятки базовых конструкций, строятся по меркам прямо в браузере; выгрузка SVG/PDF. Брендовых лекал нет.' },
  { n: 'Make/Use — Holly McQuillan', url: 'https://www.makeuse.nz', lic: 'бесплатно, условия — на сайте', what: 'Открытая система zero-waste одежды, которую пользователь меняет под себя. Близко по идее к КРОМКЕ.' },
  { n: 'SHOWstudio — Design Download', url: 'https://www.showstudio.com/tags/design-download', lic: 'бесплатно, только чтобы сшить себе; © SHOWstudio', what: 'С 2002 года — настоящие лекала дизайнеров: Yohji Yamamoto, Y-3, Martin Margiela, Junya Watanabe, Gareth Pugh, Alexander McQueen, John Galliano, JW Anderson. PDF A4 и A0. Лучший открытый источник под авангард, но в библиотеку их класть нельзя — только для своей работы.' },
  { n: 'Sew In Love', url: 'https://www.sewinlove.com.au', lic: 'бесплатно, условия — на странице лекала', what: 'Простые женские платья и туники (шифт, бокси, заниженная талия), японские лекала. Хорошая база для упрощённых силуэтов.' },
  { n: 'Subtraction Cutting — Julian Roberts', url: 'https://www.julianand.com', lic: 'бесплатная публикация автора', what: 'Метод «вычитания»: объём из туннелей и вырезов. Идеи для авангардных форм, а не готовые лекала.' },
];

/** короткая группа ткани для фильтра */
const MAT_GROUP = { 'Трикотаж': 'трикотаж', 'Тканые: хлопок, лён': 'хлопок / лён', 'Деним и канвас': 'деним', 'Шерсть': 'шерсть', 'Шёлк и искусственные': 'шёлк', 'Техно и синтетика': 'техно', 'Кожа и замша': 'кожа' };
export const matGroup = (matId) => MAT_GROUP[PRESETS.find((x) => x.id === matId)?.group] || 'другое';

// полные наборы параметров генераторов — от них отталкиваются карточки библиотеки
const TOP = { ease: 10, len: 70, sleeve: 21, drop: 0, bicep: 6, cuff: 0, cuffEl: 0, neckW: 1, neckF: 8, neckB: 2, armDrop: 1, hemCurve: 0, asym: 0, flare: 1, waist: 0, open: 0, overlap: 0, collar: 0, collarH: 4, cuffs: 0, cuffH: 6 };
const PANTS = { ease: 8, rise: 0, drop: 0, knee: 46, kneeY: 0, hem: 42, hemBack: 0, len: 102, elastic: 0, artKnee: 0, jeans: 0, buttonFly: 0, contour: 0 };
const SKIRT = { ease: 6, len: 88, flare: 18, rise: 0, asym: 0, elastic: 0 };

// фасеты базовых пресетов (patterns.js) — их id остаются прежними
const BASE_META = {
  tee: { sil: 'прямой', tags: ['базовая', 'короткий рукав'], style: [], level: 1 },
  over: { sil: 'оверсайз', tags: ['спущенное плечо'], style: ['julius', 'n9'], level: 1 },
  long: { sil: 'удлинённый', tags: ['длинный рукав', 'закруглённый низ'], style: ['rick', 'julius'], level: 1 },
  funnel: { sil: 'прямой', tags: ['воротник-воронка', 'манжеты', 'длинный рукав'], style: ['julius', 'rick'], level: 2 },
  tank: { sil: 'удлинённый', tags: ['без рукава', 'глубокая пройма'], style: ['rick', 'julius'], level: 1 },
  tunic: { sil: 'оверсайз', tags: ['асимметрия'], style: ['ann', 'rick', 'yohji'], level: 1 },
  coat: { sil: 'удлинённый', tags: ['распашной', 'длинный рукав', 'верхняя одежда'], style: ['ann', 'rick'], level: 2 },
  trou: { sil: 'прямой', tags: ['классика'], style: ['helmut', 'ann'], level: 2 },
  dropc: { sil: 'заниженная мотня', tags: ['резинка'], style: ['rick', 'julius'], level: 1 },
  jeans: { sil: 'прямой', tags: ['5 карманов', 'кокетка', 'молния'], style: ['n9', 'helmut'], level: 3 },
  bootcut: { sil: 'расклешённый', tags: ['5 карманов', 'низкая посадка', 'контурный пояс'], style: ['rick', 'iswn', '14th'], level: 3 },
  flare: { sil: 'расклешённый', tags: ['5 карманов', 'низкая посадка', 'клёш'], style: ['lgb', '14th', 'iswn'], level: 3 },
  skinny: { sil: 'узкий', tags: ['5 карманов', 'низкая посадка'], style: ['n9', 'balmain', 'kmrii'], level: 3 },
  stack: { sil: 'узкий', tags: ['5 карманов', 'набег у стопы', 'длинные'], style: ['rick', 'kmrii', 'lgb'], level: 3 },
  wideleg: { sil: 'оверсайз', tags: ['5 карманов', 'широкие'], style: ['yohji', 'julius'], level: 3 },
  skirt: { sil: 'расклешённый', tags: ['макси'], style: ['ann', 'yohji'], level: 1 },
  snood: { sil: 'оверсайз', tags: ['аксессуар', 'вязка'], style: ['rick', 'julius'], level: 1 },
};

/** дополнительные карточки библиотеки */
const EXTRA = [
  { id: 'L-tlong', cat: 'Верх', name: 'Футболка удлинённая, узкий рукав', gen: 'top', layer: 1, mat: 'jer180', p: { ...TOP, ease: 6, len: 88, sleeve: 23, bicep: 4, neckF: 7, hemCurve: 3, flare: 2 },
    sil: 'удлинённый', tags: ['базовая', 'для слоёв'], style: ['rick', 'julius'], level: 1, note: 'Нижний слой под распашные вещи: длина ниже бедра, узкий рукав.' },
  { id: 'L-thumb', cat: 'Верх', name: 'Лонгслив с удлинёнными рукавами, набегают на кисть', gen: 'top', layer: 1, mat: 'mod170', p: { ...TOP, ease: 4, len: 80, sleeve: 88, bicep: 3, cuff: -2, cuffEl: 1, neckF: 6, hemCurve: 6, flare: 2 },
    sil: 'удлинённый', tags: ['длинный рукав', 'резинка'], style: ['julius', 'ann'], level: 1, note: 'Рукав на 15–20 см длиннее руки собирается гармошкой у кисти.' },
  { id: 'L-zipsl', cat: 'Верх', name: 'Лонгслив с молниями у манжет', gen: 'top', layer: 1, mat: 'jer260', p: { ...TOP, ease: 8, len: 78, sleeve: 74, bicep: 4, neckF: 6, flare: 1 },
    sil: 'прямой', tags: ['молнии', 'длинный рукав'], style: ['julius', 'kmrii'], level: 2, note: 'Декоративные металлические молнии по низу рукава.',
    decor: [{ op: 'zip', piece: 'Рукав', xf: 0.32, from: 1.5, len: 13, kind: 'metal', metal: '#7d7e82' }] },
  { id: 'L-mesh', cat: 'Верх', name: 'Сетчатый лонгслив', gen: 'top', layer: 1, mat: 'mesh90', p: { ...TOP, ease: 2, len: 72, sleeve: 70, bicep: 2, neckF: 7, cuffEl: 0 },
    sil: 'узкий', tags: ['сетка', 'для слоёв', 'длинный рукав'], style: ['rick', 'kmrii'], level: 1, note: 'Прозрачный слой под майку или жилет.' },
  { id: 'L-thermal', cat: 'Верх', name: 'Облегающий лонгслив из рибаны', gen: 'top', layer: 1, mat: 'rib280', p: { ...TOP, ease: -2, len: 70, sleeve: 68, bicep: 0, neckF: 6, neckW: 0 },
    sil: 'узкий', tags: ['длинный рукав', 'для слоёв'], style: ['n9', '14th'], level: 1, note: 'Термо-слой под мохер или рубашку; ткань тянется.' },
  { id: 'L-mohair', cat: 'Верх', name: 'Свитер-мохер оверсайз, сырые края', gen: 'top', layer: 2, mat: 'mohk', p: { ...TOP, ease: 34, len: 72, sleeve: 64, drop: 9, bicep: 14, cuff: 8, neckW: 2, neckF: 7, armDrop: 6, flare: 0 },
    sil: 'оверсайз', tags: ['вязка', 'сырой край', 'спущенное плечо'], style: ['n9', 'lgb'], level: 1, note: 'Низ и рукава без подгибки — край остаётся сырым.',
    decor: [{ op: 'raw', edges: ['низ', 'низ рукава'] }] },
  { id: 'L-vest', cat: 'Верх', name: 'Кожаный жилет со шнуровкой по бокам', gen: 'top', layer: 2, mat: 'lamb06', p: { ...TOP, ease: 6, len: 60, sleeve: 0, drop: -1, neckW: 2, neckF: 12, neckB: 3, armDrop: 8, waist: 3, flare: 1 },
    sil: 'приталенный', tags: ['шнуровка', 'люверсы', 'без рукава'], style: ['ann', '14th'], level: 2, note: 'Ряд люверсов по боковым швам переда и спинки — под кожаный шнур.',
    decor: [{ op: 'row', piece: 'Перед', edge: 'бок', type: 'eyelet', step: 2.6, inset: 1.6, size: 1.0, color: '#4b4c4f' }, { op: 'row', piece: 'Спинка', edge: 'бок', type: 'eyelet', step: 2.6, inset: 1.6, size: 1.0, color: '#4b4c4f' }] },
  { id: 'L-moto', cat: 'Верхняя одежда', name: 'Кожаная куртка на молнии, стойка', gen: 'top', layer: 2, mat: 'lamb06', p: { ...TOP, ease: 14, len: 58, sleeve: 64, bicep: 7, cuff: 0, neckW: 1, neckF: 8, neckB: 2, armDrop: 2, flare: 0, waist: 2, open: 1, overlap: 0, collar: 1, collarH: 4 },
    sil: 'приталенный', tags: ['молнии', 'стойка', 'кожа', 'верхняя одежда'], style: ['rick', 'iswn', 'balmain', '14th', 'kmrii'], level: 3, note: 'Разъёмная металлическая молния по бортам и молнии у манжет. Борта встык.',
    decor: [{ op: 'zipFront', edge: 'борт', kind: 'metal', metal: '#9b9b9e' }, { op: 'zip', piece: 'Рукав', xf: 0.3, from: 1.5, len: 12, kind: 'metal', metal: '#9b9b9e' }] },
  { id: 'L-bomber', cat: 'Верхняя одежда', name: 'Бомбер оверсайз на молнии', gen: 'top', layer: 2, mat: 'rip60', p: { ...TOP, ease: 26, len: 62, sleeve: 62, drop: 6, bicep: 12, cuff: 4, neckF: 8, armDrop: 4, flare: -2, open: 1, overlap: 0, collar: 1, collarH: 5, cuffs: 1, cuffH: 7 },
    sil: 'оверсайз', tags: ['молнии', 'манжеты', 'стойка', 'верхняя одежда'], style: ['n9', 'kmrii', 'julius'], level: 3, note: 'Спиральная разъёмная молния, манжеты и стойка.',
    decor: [{ op: 'zipFront', edge: 'борт', kind: 'coil', metal: '#2a2a2b' }] },
  { id: 'L-hoodie', cat: 'Верх', name: 'Худи оверсайз с капюшоном и манжетами', gen: 'top', layer: 2, mat: 'ter320', p: { ...TOP, ease: 30, len: 72, sleeve: 66, drop: 8, bicep: 12, cuff: 2, neckW: 1, neckF: 8, armDrop: 5, flare: 0, cuffs: 1, cuffH: 7, hood: 1, hoodH: 36, hoodD: 26 },
    sil: 'оверсайз', tags: ['капюшон', 'манжеты', 'спущенное плечо'], style: ['rick', 'julius', 'n9'], level: 2, note: 'Капюшон из двух половин втачан в горловину; рукава с манжетами.' },
  { id: 'L-parka', cat: 'Верхняя одежда', name: 'Парка с капюшоном на молнии', gen: 'top', layer: 3, mat: 'wax300', p: { ...TOP, ease: 26, len: 96, sleeve: 66, drop: 5, bicep: 10, cuff: 4, neckW: 1.5, neckF: 10, armDrop: 5, flare: 6, open: 1, overlap: 0, hood: 1, hoodH: 38, hoodD: 28 },
    sil: 'удлинённый', tags: ['капюшон', 'молнии', 'верхняя одежда'], style: ['julius', 'ccp', 'kmrii'], level: 3, note: 'Разъёмная молния по бортам, большой капюшон.',
    decor: [{ op: 'zipFront', edge: 'борт', kind: 'metal', metal: '#7d7e82' }] },
  { id: 'L-duster', cat: 'Верхняя одежда', name: 'Плащ-пыльник в пол, вощёный хлопок', gen: 'top', layer: 3, mat: 'wax300', p: { ...TOP, ease: 30, len: 128, sleeve: 68, drop: 6, bicep: 12, cuff: 8, neckW: 2, neckF: 24, neckB: 2.5, armDrop: 6, flare: 12, open: 1, overlap: 3 },
    sil: 'удлинённый', tags: ['распашной', 'макси', 'верхняя одежда'], style: ['julius', 'ccp', 'rick'], level: 2, note: 'Распашной, расширен к низу, длина почти в пол.' },
  { id: 'L-cocoon', cat: 'Верхняя одежда', name: 'Пальто-кокон, мельтон', gen: 'top', layer: 3, mat: 'mel600', p: { ...TOP, ease: 42, len: 104, sleeve: 62, drop: 11, bicep: 16, cuff: 6, neckW: 2.5, neckF: 22, neckB: 2.5, armDrop: 8, hemCurve: 2, flare: -4, open: 1, overlap: 6 },
    sil: 'оверсайз', tags: ['распашной', 'объём', 'верхняя одежда'], style: ['rick', 'yohji'], level: 2, note: 'Объём у плеч, сужение к низу — силуэт кокона.' },
  { id: 'L-harem', cat: 'Брюки', name: 'Брюки-харем: мотня у колена, узкий низ', gen: 'pants', layer: 0, mat: 'jer260', p: { ...PANTS, ease: 22, rise: -2, drop: 38, knee: 46, hem: 26, len: 106, elastic: 1 },
    sil: 'заниженная мотня', tags: ['резинка', 'узкий низ'], style: ['julius', 'rick'], level: 1, note: 'Самая низкая мотня; низ собирается на щиколотке.' },
  { id: 'L-cargo', cat: 'Брюки', name: 'Карго с накладными карманами, низкая мотня', gen: 'pants', layer: 0, mat: 'can340', p: { ...PANTS, ease: 16, rise: -1, drop: 14, knee: 50, hem: 36, len: 106, elastic: 1 },
    sil: 'заниженная мотня', tags: ['карманы', 'резинка'], style: ['julius', 'n9'], level: 2, note: 'Накладные карманы на бёдрах (раскладываются отдельно).',
    decor: [{ op: 'patch', piece: 'Передняя половинка', xf: 0.56, yf: 0.58, w: 15, h: 17, name: 'Карман карго' }] },
  { id: 'L-wide', cat: 'Брюки', name: 'Широкие брюки в пол, габардин', gen: 'pants', layer: 0, mat: 'gab260', p: { ...PANTS, ease: 22, rise: 2, drop: 4, knee: 66, hem: 66, len: 112 },
    sil: 'оверсайз', tags: ['широкие', 'классика', 'длинные'], style: ['yohji', 'ann'], level: 2, note: 'Высокая посадка, прямая широкая штанина до пола.' },
  { id: 'L-lflare', cat: 'Брюки', name: 'Кожаные брюки клёш', gen: 'pants', layer: 0, mat: 'lamb06', p: { ...PANTS, ease: 3, rise: -4, knee: 37, kneeY: 6, hem: 62, hemBack: 2, len: 112 },
    sil: 'расклешённый', tags: ['кожа', 'клёш', 'низкая посадка'], style: ['iswn', '14th', 'lgb'], level: 2, note: 'Узко до колена, клёш от колена; сзади длиннее — под каблук.' },
  { id: 'L-lskinny', cat: 'Брюки', name: 'Кожаные узкие брюки, молнии у щиколотки', gen: 'pants', layer: 0, mat: 'lamb06', p: { ...PANTS, ease: 2, rise: -3, knee: 34, hem: 27, len: 106 },
    sil: 'узкий', tags: ['кожа', 'молнии'], style: ['14th', 'kmrii', 'balmain', 'iswn'], level: 2, note: 'Металлические молнии по низу у бокового шва.',
    decor: [{ op: 'zip', piece: 'Передняя половинка', xf: 0.84, from: 2.5, len: 14, kind: 'metal', metal: '#9b9b9e' }] },
  { id: 'L-biker', cat: 'Джинсы', name: 'Байкерские джинсы с рельефом у колена', gen: 'pants', layer: 0, mat: 'den11s', p: { ...PANTS, ease: 2, rise: -3, knee: 34, hem: 28, len: 106, artKnee: 2.5, jeans: 1, contour: 1 },
    sil: 'узкий', tags: ['5 карманов', 'рельеф у колена', 'низкая посадка'], style: ['balmain', '14th'], level: 3, note: 'Шов-сгиб у колена с посадкой — колено не вытягивается.' },
  { id: 'L-rawsk', cat: 'Джинсы', name: 'Узкие джинсы с сырым низом', gen: 'pants', layer: 0, mat: 'den11s', p: { ...PANTS, ease: 2, rise: -3, knee: 34, hem: 29, len: 108, jeans: 1, contour: 1 },
    sil: 'узкий', tags: ['5 карманов', 'сырой край', 'низкая посадка'], style: ['n9', 'lgb'], level: 3, note: 'Низ не подшит — даёт бахрому после стирки.',
    decor: [{ op: 'raw', edges: ['низ'] }] },
  { id: 'L-asksk', cat: 'Юбки', name: 'Асимметричная юбка, сырой низ', gen: 'skirt', layer: 0, mat: 'vis180', p: { ...SKIRT, ease: 8, len: 96, flare: 14, asym: 32, elastic: 1 },
    sil: 'расклешённый', tags: ['асимметрия', 'сырой край', 'резинка'], style: ['rick', 'ann'], level: 1, note: 'Одна сторона заметно длиннее; низ сырой.',
    decor: [{ op: 'raw', edges: ['низ'] }] },
  { id: 'L-lacesk', cat: 'Юбки', name: 'Длинная юбка со шнуровкой по бокам', gen: 'skirt', layer: 0, mat: 'wsilk', p: { ...SKIRT, ease: 6, len: 100, flare: 10 },
    sil: 'прямой', tags: ['шнуровка', 'люверсы', 'макси'], style: ['ann', '14th'], level: 2, note: 'Люверсы по обоим боковым швам — под ленту или шнур.',
    decor: [{ op: 'row', piece: 'Перед юбки', edge: 'бок', type: 'eyelet', step: 3, inset: 1.6, size: 1.0, color: '#4b4c4f' }, { op: 'row', piece: 'Спинка юбки', edge: 'бок', type: 'eyelet', step: 3, inset: 1.6, size: 1.0, color: '#4b4c4f' }] },
  { id: 'L-cowl', cat: 'Аксессуары из ткани', name: 'Высокий хомут из рибаны', gen: 'snood', layer: 3, mat: 'rib280', p: { w: 64, h: 34, y: 4 },
    sil: 'прямой', tags: ['аксессуар'], style: ['julius', 'rick'], level: 1, note: 'Плотно у шеи, выше подбородка.' },
];

/** вся библиотека: базовые пресеты + дополнительные карточки */
export const LIBRARY = [
  ...GARMENT_PRESETS.map((p) => ({ ...p, ...(BASE_META[p.id] || { sil: '', tags: [], style: [], level: 1 }) })),
  ...EXTRA,
].map((it) => ({ src: 'КРОМКА — параметрическая конструкция по меркам', ...it, cat: it.cat === 'Верх' && it.tags.includes('верхняя одежда') ? 'Верхняя одежда' : it.cat }));

export const findItem = (id) => LIBRARY.find((x) => x.id === id) || null;

/** образы: несколько вещей + обувь, «собрать на манекене» */
export const OUTFITS = [
  { id: 'O-rick', name: 'Длинный верх, низкая мотня', style: ['rick'], items: ['dropc', 'L-tlong', 'coat'], shoes: { style: 'high', toe: 'round', shaft: 18, sole: 3.6, heel: 0, flare: 0.8, laces: 1, soleColor: '#e9e5dc' } },
  { id: 'O-julius', name: 'Слои, воронка, харем', style: ['julius'], items: ['L-harem', 'funnel', 'L-cowl'], shoes: { style: 'tall', toe: 'round', shaft: 34, sole: 2.6, heel: 2, flare: 1.4, laces: 0 } },
  { id: 'O-ann', name: 'Асимметрия и длинные слои', style: ['ann', 'yohji'], items: ['L-wide', 'tunic', 'L-duster'], shoes: { style: 'boot', toe: 'point', shaft: 16, sole: 1.6, heel: 3, flare: 0.8, laces: 1 } },
  { id: 'O-iswn', name: 'Рок 70-х: кожаный клёш и куртка', style: ['iswn', '14th'], items: ['L-lflare', 'tee', 'L-moto'], shoes: { style: 'boot', toe: 'point', shaft: 15, sole: 1.4, heel: 5, flare: 0.6, laces: 0 } },
  { id: 'O-n9', name: 'Гранж: узкие джинсы, термо, мохер', style: ['n9', 'lgb'], items: ['L-rawsk', 'L-thermal', 'L-mohair'], shoes: { style: 'high', toe: 'round', shaft: 14, sole: 2.8, heel: 0, flare: 0.8, laces: 1, soleColor: '#e9e5dc' } },
  { id: 'O-14th', name: 'Клёш, сетка и шнуровка', style: ['14th', 'lgb'], items: ['flare', 'L-mesh', 'L-vest'], shoes: { style: 'boot', toe: 'square', shaft: 18, sole: 2.2, heel: 4, flare: 0.8, laces: 0 } },
  { id: 'O-kmrii', name: 'Панк: кожа, молнии, бомбер', style: ['kmrii'], items: ['L-lskinny', 'L-mesh', 'L-bomber'], shoes: { style: 'tall', toe: 'round', shaft: 26, sole: 4, heel: 1, flare: 1, laces: 1 } },
  { id: 'O-balmain', name: 'Байкер: рельефные джинсы и косуха', style: ['balmain'], items: ['L-biker', 'tee', 'L-moto'], shoes: { style: 'boot', toe: 'round', shaft: 18, sole: 2.6, heel: 2.5, flare: 0.8, laces: 1 } },
];

// ───────── поиск ─────────
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const designer = (id) => DESIGNERS.find((d) => d.id === id);
/** текст, по которому ищется карточка */
function hay(it) {
  const ds = (it.style || []).map(designer).filter(Boolean);
  return norm([it.name, it.cat, it.sil, ...(it.tags || []), it.note, matGroup(it.mat), PRESETS.find((x) => x.id === it.mat)?.name,
    ...ds.flatMap((d) => [d.n, ...d.a])].join(' '));
}
/**
 * Фильтр библиотеки: q — слова (все должны найтись), f — фасеты {cat, sil, style, mat, level}: внутри фасета «или», между фасетами «и».
 * @param {string} q @param {{cat?:string[], sil?:string[], style?:string[], mat?:string[], level?:number[], tags?:string[]}} [f]
 */
export function searchLibrary(q, f = {}) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  return LIBRARY.filter((it) => {
    if (f.cat?.length && !f.cat.includes(it.cat)) return false;
    if (f.sil?.length && !f.sil.includes(it.sil)) return false;
    if (f.style?.length && !(it.style || []).some((s) => f.style.includes(s))) return false;
    if (f.mat?.length && !f.mat.includes(matGroup(it.mat))) return false;
    if (f.level?.length && !f.level.includes(it.level)) return false;
    if (f.tags?.length && !f.tags.every((t) => (it.tags || []).includes(t))) return false;
    if (!words.length) return true;
    const h = hay(it);
    return words.every((w) => h.includes(w));
  });
}
/** значения фасетов с числом карточек (для чипов) */
export function facets() {
  const cnt = (key) => { const m = new Map(); for (const it of LIBRARY) for (const v of [].concat(key(it))) if (v !== '' && v != null) m.set(v, (m.get(v) || 0) + 1); return [...m.entries()]; };
  return {
    cat: cnt((it) => it.cat), sil: cnt((it) => it.sil), mat: cnt((it) => matGroup(it.mat)), level: cnt((it) => it.level).sort((a, b) => a[0] - b[0]),
    style: DESIGNERS.map((d) => /** @type {[string, number]} */ ([d.id, LIBRARY.filter((it) => (it.style || []).includes(d.id)).length])).filter(([, n]) => n > 0),
    tags: cnt((it) => it.tags || []).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]),
  };
}
/** образы, подходящие под фильтр по ассоциациям (или все) */
export const outfitsFor = (style = []) => OUTFITS.filter((o) => !style.length || o.style.some((s) => style.includes(s)));

// ───────── детали изделия из карточки ─────────
// правые половинки зеркальны левым (кроме рукавов: у обоих x > 0 — перед оката)
const isRight = (p) => /прав/i.test(p.name) && p.place?.kind !== 'arm';
/** горизонтальный пролёт детали на высоте y: [xmin, xmax] или null */
function spanAt(pts, y) {
  const xs = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
  }
  return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null;
}
/** точка на детали: доля ширины xf на высоте y (у правых деталей — зеркально) */
function at(p, xf, y) {
  const sp = spanAt(p.pts, y);
  if (!sp) return null;
  const f = isRight(p) ? 1 - xf : xf;
  return [sp[0] + (sp[1] - sp[0]) * f, y];
}
const matches = (p, name) => !p.inner && p.name.startsWith(name);

/**
 * Применить детали карточки к только что сгенерированному изделию. Идемпотентно для свежей генерации.
 * Новые швы (молния борт ↔ борт) получают rev = null — его досчитает вызывающий (seamRev).
 * @param {any} g @param {any[]} decor
 */
export function applyDecor(g, decor) {
  for (const d of decor || []) {
    if (d.op === 'raw') {
      for (const p of g.pieces) if (!p.inner) for (const c of p.corners) { const m = p.meta[c.id]; if (m && d.edges.includes(m.name)) { m.raw = true; } }
    } else if (d.op === 'zip') {
      for (const p of g.pieces) {
        if (!matches(p, d.piece)) continue;
        const b = bbox(p.pts), y0 = b.y0 + d.from, y1 = Math.min(b.y1 - 1, y0 + d.len);
        const pts = [];
        for (let i = 0; i <= 6; i++) { const q = at(p, d.xf, y0 + ((y1 - y0) * i) / 6); if (q) pts.push(q); }
        if (pts.length < 2 || !pts.every((q) => inside(q, p.pts))) continue;
        addDecorZip(p, pts.reverse(), { kind: d.kind, metal: d.metal, tape: d.tape }); // сверху вниз: бегунок у верхнего конца
      }
    } else if (d.op === 'zipFront') {
      const done = new Set();
      for (const p of g.pieces) {
        if (p.inner || done.has(p.id)) continue;
        const c = p.corners.find((k) => p.meta[k.id]?.name === d.edge);
        if (!c) continue;
        const pr = zipPartner(g, p, c.id);
        if (!pr) continue;
        zipEdges(g, p, c.id, pr.p, pr.e, { kind: d.kind, metal: d.metal, open: true });
        done.add(p.id); done.add(pr.p.id);
      }
    } else if (d.op === 'row') {
      for (const p of g.pieces) {
        if (!matches(p, d.piece)) continue;
        for (const c of p.corners) if (p.meta[c.id]?.name === d.edge && edgeK(p, c.id) >= 0) hardwareAlong(p, c.id, d);
      }
    } else if (d.op === 'patch') {
      for (const p of g.pieces) {
        if (!matches(p, d.piece)) continue;
        const b = bbox(p.pts), cy = b.y0 + b.h * d.yf, c = at(p, d.xf, cy);
        if (!c) continue;
        // на маленьком размере карман уменьшается, пока не поместится в деталь
        for (const k of [1, 0.9, 0.8, 0.7]) {
          const w = (d.w * k) / 2, h = (d.h * k) / 2;
          const pts = [[c[0] - w, cy - h], [c[0] + w, cy - h], [c[0] + w, cy + h], [c[0] - w, cy + h]];
          if (!pts.every((q) => inside(q, p.pts))) continue;
          (p.overlays ||= []).push({ id: uid('o'), name: d.name || 'Карман', pts, mat: p.mat, sa: 1 });
          break;
        }
      }
    }
  }
  return g;
}
