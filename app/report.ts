import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";

export type ReportData = {
  caseLabel: string; h: number; cover: number; bar: number; h0: number;
  cx: number; cy: number; edgeX?: number; edgeY?: number; wall: boolean;
  concrete: string; rbt: number; gamma: number; force: number; mx: number; my: number;
  hole: boolean; holeStatus: string; u: number; wx: number; wy: number; xc: number; yc: number;
  reinforced: boolean; steel: string; rsw: number; swDia: number; swStep: number;
  swOffset: number; asw: number; qsw: number; rowCount: number; zoneWidth: number;
  fb: number; fswRaw: number; fswAccepted: number; fswThreshold: number;
  forceRatio: number; rawMomentRatio: number; momentLimit: number; acceptedMomentRatio: number;
  eta: number; outerEta: number; outerU: number; outerWx: number; outerWy: number;
  outerForceRatio: number; outerMomentRatio: number; outerOffset: number; governingEta: number;
};

const ink = "1E2922", green = "2F7250", orange = "DC7B24", pale = "EEF3EF", gray = "68736B";
const mm = (v: number) => `${v.toFixed(0)} мм`;
const num = (v: number, n = 3) => Number.isFinite(v) ? v.toFixed(n) : "—";

function cell(text: string, bold = false, fill?: string, color = ink) {
  return new TableCell({
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 100, bottom: 100, left: 130, right: 130 },
    children: [new Paragraph({ children: [new TextRun({ text, bold, color, font: "Arial", size: 20 })] })],
  });
}
function table(rows: Array<[string, string]>) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3700, 5660],
    rows: rows.map((r, i) => new TableRow({ children: [cell(r[0], i === 0, i === 0 ? pale : undefined), cell(r[1], i === 0, i === 0 ? pale : undefined)] })),
  });
}
function formula(text: string, result?: string) {
  return new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 120, after: 120 },
    border: { top: { style: BorderStyle.SINGLE, color: "D9DDD6", size: 4 }, bottom: { style: BorderStyle.SINGLE, color: "D9DDD6", size: 4 } },
    shading: { fill: "F7F7F3", type: ShadingType.CLEAR },
    children: [new TextRun({ text, font: "Cambria Math", italics: true, size: 25, color: ink }), ...(result ? [new TextRun({ text: `    =    ${result}`, font: "Cambria Math", bold: true, size: 25, color: orange })] : [])],
  });
}
function heading(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 }, keepNext: true });
}
function subheading(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 210, after: 90 }, keepNext: true });
}
function reference(text: string) {
  return new Paragraph({ spacing: { before: 40, after: 100 }, children: [new TextRun({ text: `Основание: ${text}`, italics: true, size: 18, color: gray, font: "Arial" })] });
}
function explanation(text: string) {
  return new Paragraph({ spacing: { before: 50, after: 90, line: 276 }, children: [new TextRun({ text, size: 20, color: ink, font: "Arial" })] });
}

export async function buildPunchingReport(d: ReportData) {
  const ok = d.governingEta <= 1;
  const ab = d.u * d.h0;
  const rbtBase = Math.abs(d.gamma) > 1e-9 ? d.rbt / d.gamma : d.rbt;
  const steelStress = d.fswAccepted * 1000 / Math.max(ab, 1);
  const totalStressCapacity = d.rbt + steelStress;
  const fult = d.fb + d.fswAccepted;
  const forceStress = d.force * 1000 / Math.max(ab, 1);
  const mxStress = d.wall ? 0 : Math.abs(d.mx) * 1e6 / Math.max(d.wx * d.h0, 1);
  const myStress = Math.abs(d.my) * 1e6 / Math.max(d.wy * d.h0, 1);
  const mxUlt = totalStressCapacity * d.wx * d.h0 / 1e6;
  const myUlt = totalStressCapacity * d.wy * d.h0 / 1e6;
  const mxRatio = d.wall ? 0 : Math.abs(d.mx) / Math.max(mxUlt, 1e-9);
  const myRatio = Math.abs(d.my) / Math.max(myUlt, 1e-9);
  const outerAb = d.outerU * d.h0;
  const outerFb = d.rbt * outerAb / 1000;
  const outerMxUlt = d.rbt * d.outerWx * d.h0 / 1e6;
  const outerMyUlt = d.rbt * d.outerWy * d.h0 / 1e6;
  const outerMxRatio = d.wall ? 0 : Math.abs(d.mx) / Math.max(outerMxUlt, 1e-9);
  const outerMyRatio = Math.abs(d.my) / Math.max(outerMyUlt, 1e-9);
  const supportRows: Array<[string, string]> = [
    ["Параметр", "Принятое значение"], ["Расчётный случай", d.caseLabel],
    ["Толщина плиты h", mm(d.h)], ["Защитный слой", mm(d.cover)],
    ["Диаметр продольной арматуры", mm(d.bar)], ["Рабочая высота h₀", mm(d.h0)],
  ];
  if (d.wall) supportRows.push(["Толщина стены t", mm(d.cy)]);
  else supportRows.push(["Размер колонны cₓ × cᵧ", `${mm(d.cx)} × ${mm(d.cy)}`]);
  if (d.edgeY !== undefined) supportRows.push(["Расстояние до края yₐ", mm(d.edgeY)]);
  if (d.edgeX !== undefined) supportRows.push(["Расстояние до края xₐ", mm(d.edgeX)]);

  const children: Array<Paragraph | Table> = [
    new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "РАСЧЁТ НА ПРОДАВЛИВАНИЕ", bold: true, size: 34, color: ink, font: "Arial" })] }),
    new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: "Монолитная железобетонная плита · СП 63.13330.2018", size: 20, color: gray, font: "Arial" })] }),
    new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [7000, 2360], rows: [new TableRow({ children: [cell(ok ? "НЕСУЩАЯ СПОСОБНОСТЬ ОБЕСПЕЧЕНА" : "НЕСУЩАЯ СПОСОБНОСТЬ НЕ ОБЕСПЕЧЕНА", true, ok ? "E7F2EB" : "FBE9E5", ok ? green : "B84932"), cell(`η = ${num(d.governingEta)}`, true, ok ? "E7F2EB" : "FBE9E5", ok ? green : "B84932")] })] }),
    heading("1. Исходные данные"),
    reference("СП 63.13330.2018, п. 8.1.46 — расчёт плоских железобетонных элементов на действие сосредоточенной силы и изгибающих моментов."),
    table(supportRows),
    subheading("1.1. Рабочая высота сечения"),
    explanation("Рабочую высоту принимаем от сжатой грани плиты до центра тяжести растянутой продольной арматуры."),
    formula("h₀ = h − c − dₛ/2", `${num(d.h, 0)} − ${num(d.cover, 0)} − ${num(d.bar, 0)}/2 = ${num(d.h0, 0)} мм`),
    new Paragraph({ spacing: { before: 180, after: 80 }, children: [new TextRun({ text: "Материалы и усилия", bold: true, size: 23, color: ink, font: "Arial" })] }),
    table([["Параметр", "Принятое значение"], ["Бетон", `${d.concrete}; Rbt = ${num(d.rbt, 2)} МПа; γb = ${num(d.gamma, 2)}`], ["Продавливающая сила F", `${num(d.force, 1)} кН`], ["Изгибающие моменты Mₓ / Mᵧ", `${num(d.mx, 1)} / ${num(d.my, 1)} кН·м`]]),
    subheading("1.2. Расчётное сопротивление бетона"),
    explanation("Табличное значение Rbt для выбранного класса бетона умножаем на введённый коэффициент условий работы γb."),
    formula("Rbt = Rbt,norm · γb", `${num(rbtBase, 2)} · ${num(d.gamma, 2)} = ${num(d.rbt, 2)} МПа`),
    heading("2. Расчётный контур"),
    reference("СП 63.13330.2018, пп. 8.1.46–8.1.47, рисунки 8.11 и 8.12."),
    explanation("Расчётный контур располагают на расстоянии h₀/2 от границы площадки передачи нагрузки. Для опоры у края или угла плиты контур ограничивается свободными краями. При наличии одного или двух отверстий в зоне до 6h₀ из контура исключяется объединение участков между касательными к каждому влияющему отверстию."),
    formula("a = h₀/2", `${num(d.h0, 0)}/2 = ${num(d.h0 / 2, 1)} мм`),
    ...(d.hole ? [formula("dотв ≤ 6h₀", `${d.holeStatus}`)] : []),
    table([["Характеристика", "Значение"], ["Периметр u", `${num(d.u / 1000)} м`], ["Моменты сопротивления Wₓ / Wᵧ", `${num(d.wx / 1e6, 2)} / ${num(d.wy / 1e6, 2)} ·10⁶ мм²`], ["Центр тяжести контура", `x = ${num(d.xc, 0)} мм; y = ${num(d.yc, 0)} мм`], ["Влияние отверстий", d.hole ? d.holeStatus : "Отверстия отсутствуют"]]),
    subheading("2.1. Геометрические характеристики фактического контура"),
    explanation("Для укороченного или незамкнутого контура характеристики определяются по сумме его прямолинейных участков. Координаты относятся к системе осей, показанной на расчётной схеме."),
    formula("u = Σlᵢ", `${num(d.u, 0)} мм`),
    formula("xс = Σ(lᵢ·xᵢ)/u;    yс = Σ(lᵢ·yᵢ)/u", `xс = ${num(d.xc, 1)} мм; yс = ${num(d.yc, 1)} мм`),
    formula("Iₓ = ∫(y−yс)²dl;    Iᵧ = ∫(x−xс)²dl"),
    formula("Wₓ = Iₓ/ymax;    Wᵧ = Iᵧ/xmax", `Wₓ = ${num(d.wx, 0)} мм²; Wᵧ = ${num(d.wy, 0)} мм²`),
    subheading("2.2. Несущая способность бетона по силе"),
    explanation("Площадь расчётного поперечного сечения определяем как произведение периметра фактического контура на рабочую высоту плиты."),
    formula("Aᵦ = u · h₀    [СП 63, формула (8.89)]", `${num(d.u, 0)} · ${num(d.h0, 0)} = ${num(ab, 0)} мм²`),
    explanation("Предельное усилие, воспринимаемое бетоном, определяем по расчётному сопротивлению бетона осевому растяжению."),
    formula("Fᵦ,ult = Rbt · Aᵦ    [СП 63, формула (8.88)]", `${num(d.rbt, 2)} · ${num(ab, 0)} / 1000 = ${num(d.fb, 1)} кН`),
  ];

  if (d.reinforced) {
    children.push(
      heading("3. Поперечная арматура"),
      reference("СП 63.13330.2018, п. 8.1.48, формулы (8.90)–(8.92); конструктивные требования п. 10.3.17."),
      explanation("В пределах h₀/2 по обе стороны расчётного контура учитывается рабочая пара вертикальных стержней. Для принятой квадратной сетки площадь Asw равна площади двух стержней."),
      table([["Параметр", "Принятое значение"], ["Класс и диаметр", `${d.steel}; Ø${num(d.swDia, 0)}; Rsw = ${num(d.rsw, 0)} МПа`], ["Отступ первого ряда a₀", mm(d.swOffset)], ["Шаг квадратной сетки sw", mm(d.swStep)], ["Площадь рабочей пары Asw", `${num(d.asw, 1)} мм² = 2·AØ`], ["Зона армирования", `${d.rowCount} рядов; ширина ${mm(d.zoneWidth)} ≥ 1,5h₀`]]),
      subheading("3.1. Конструктивные требования"),
      formula("h₀/3 ≤ a₀ ≤ h₀/2", `${num(d.h0 / 3, 1)} ≤ ${num(d.swOffset, 0)} ≤ ${num(d.h0 / 2, 1)} мм`),
      formula("sw ≤ min(h₀/3; 300 мм)", `${num(d.swStep, 0)} ≤ min(${num(d.h0 / 3, 1)}; 300) = ${num(Math.min(d.h0 / 3, 300), 1)} мм`),
      formula("bzone = a₀ + (n−1)·sw ≥ 1,5h₀", `${num(d.swOffset, 0)} + (${d.rowCount}−1)·${num(d.swStep, 0)} = ${num(d.zoneWidth, 0)} мм ≥ ${num(1.5 * d.h0, 1)} мм`),
      formula("n = ceil[(1,5h₀−a₀)/sw] + 1", `ceil[(${num(1.5 * d.h0, 1)}−${num(d.swOffset, 0)})/${num(d.swStep, 0)}] + 1 = ${d.rowCount}`),
      subheading("3.2. Усилие, воспринимаемое поперечной арматурой"),
      formula("Aₛw = 2 · π · d² / 4", `2 · π · ${num(d.swDia, 0)}² / 4 = ${num(d.asw, 1)} мм²`),
      formula("qsw = Rsw · Asw / sw    [СП 63, формула (8.92)]", `${num(d.rsw, 0)} · ${num(d.asw, 1)} / ${num(d.swStep, 0)} = ${num(d.qsw, 1)} Н/мм`),
      formula("Fsw,ult = 0,8 · qsw · u    [СП 63, формула (8.91)]", `0,8 · ${num(d.qsw, 1)} · ${num(d.u, 0)} / 1000 = ${num(d.fswRaw, 1)} кН`),
      explanation("Согласно п. 8.1.48 поперечная арматура учитывается, если Fsw,ult ≥ 0,25Fb,ult. Суммарную несущую способность Fb,ult + Fsw,ult принимают не более 2Fb,ult, поэтому учитываемое Fsw,ult ограничивается значением Fb,ult."),
      formula("0,25Fᵦ,ult", `0,25 · ${num(d.fb, 1)} = ${num(d.fswThreshold, 1)} кН`),
      formula("Fsw,ult ≥ 0,25Fᵦ,ult", `${num(d.fswRaw, 1)} ${d.fswRaw >= d.fswThreshold ? "≥" : "<"} ${num(d.fswThreshold, 1)} кН`),
      formula("Fsw,ult,прин = min(Fsw,ult; Fᵦ,ult)", `min(${num(d.fswRaw, 1)}; ${num(d.fb, 1)}) = ${num(d.fswAccepted, 1)} кН`),
      table([["Проверка пункта 8.1.48", "Результат"], ["Минимальное учитываемое усилие 0,25Fb", `${num(d.fswRaw, 1)} ${d.fswRaw >= d.fswThreshold ? "≥" : "<"} ${num(d.fswThreshold, 1)} кН`], ["Ограничение Fsw ≤ Fb", `${num(d.fswAccepted, 1)} ≤ ${num(d.fb, 1)} кН`], ["Принято в расчёте", `Fsw = ${num(d.fswAccepted, 1)} кН`]]),
    );
  }

  children.push(
    heading(d.reinforced ? "4. Проверка прочности" : "3. Проверка прочности"),
    reference(d.reinforced ? "СП 63.13330.2018, п. 8.1.50, формула (8.96); ограничение несущей способности поперечной арматуры." : "СП 63.13330.2018, п. 8.1.49, формулы (8.93)–(8.95)."),
    explanation("Сначала определяем вклад сосредоточенной силы. Затем определяем полный относительный вклад моментов. По п. 8.1.46 сумму относительных вкладов моментов принимаем не более 0,5·F/Fult."),
    subheading(d.reinforced ? "4.1. Суммарная несущая способность по силе" : "3.1. Несущая способность по силе"),
    formula("Fult = Fᵦ,ult + Fsw,ult", `${num(d.fb, 1)} + ${num(d.fswAccepted, 1)} = ${num(fult, 1)} кН`),
    formula("vF = F/(u·h₀)", `${num(d.force, 1)}·1000 / (${num(d.u, 0)}·${num(d.h0, 0)}) = ${num(forceStress)} МПа`),
    formula("F / Fult", `${num(d.force, 1)} / ${num(fult, 1)} = ${num(d.forceRatio)}`),
    subheading(d.reinforced ? "4.2. Несущая способность при действии моментов" : "3.2. Несущая способность при действии моментов"),
    explanation("Предельные моменты определяются отдельно относительно осей X и Y. При наличии поперечной арматуры в расчёте используется суммарная расчётная интенсивность сопротивления бетона и принятой поперечной арматуры."),
    formula("vult = Rbt + Fsw,ult/(u·h₀)", `${num(d.rbt, 3)} + ${num(d.fswAccepted, 1)}·1000/(${num(d.u, 0)}·${num(d.h0, 0)}) = ${num(totalStressCapacity)} МПа`),
    formula("Mₓ,ult = vult · Wₓ · h₀", `${num(totalStressCapacity)}·${num(d.wx, 0)}·${num(d.h0, 0)}/10⁶ = ${num(mxUlt, 2)} кН·м`),
    formula("Mᵧ,ult = vult · Wᵧ · h₀", `${num(totalStressCapacity)}·${num(d.wy, 0)}·${num(d.h0, 0)}/10⁶ = ${num(myUlt, 2)} кН·м`),
    formula("vMx = |Mₓ|/(Wₓ·h₀)", `${num(Math.abs(d.mx), 1)}·10⁶/(${num(d.wx, 0)}·${num(d.h0, 0)}) = ${num(mxStress)} МПа`),
    formula("vMy = |Mᵧ|/(Wᵧ·h₀)", `${num(Math.abs(d.my), 1)}·10⁶/(${num(d.wy, 0)}·${num(d.h0, 0)}) = ${num(myStress)} МПа`),
    formula("ΣM/Mult = |Mₓ|/Mₓ,ult + |Mᵧ|/Mᵧ,ult", `${num(mxRatio)} + ${num(myRatio)} = ${num(d.rawMomentRatio)}`),
    subheading(d.reinforced ? "4.3. Ограничение вклада моментов и итог" : "3.3. Ограничение вклада моментов и итог"),
    formula("0,5 · F / Fult", `0,5 · ${num(d.forceRatio)} = ${num(d.momentLimit)}`),
    formula("η = F/Fult + min(ΣM/Mult; 0,5·F/Fult)    [СП 63, формулы (8.93)/(8.96)]", `${num(d.forceRatio)} + min(${num(d.rawMomentRatio)}; ${num(d.momentLimit)}) = ${num(d.eta)}`),
    table([["Составляющая", "Значение"], ["От силы F/Fult", num(d.forceRatio)], ["Полный вклад моментов", num(d.rawMomentRatio)], ["Предельный вклад 0,5·F/Fult", num(d.momentLimit)], ["Принято от моментов", num(d.acceptedMomentRatio)], ["Основной контур", `η = ${num(d.eta)}`]]),
  );
  if (d.reinforced) children.push(
    new Paragraph({ spacing: { before: 180, after: 80 }, children: [new TextRun({ text: "Проверка за границей зоны поперечной арматуры", bold: true, size: 23, color: ink, font: "Arial" })] }),
    reference("СП 63.13330.2018, п. 8.1.48: за границей расположения поперечной арматуры рассматривается контур на расстоянии h₀/2 от границы зоны армирования, без учёта поперечной арматуры."),
    explanation("Для внешнего контура повторно определяются его периметр, моменты сопротивления и коэффициент использования. В расчёте принимается только сопротивление бетона."),
    formula("aouter = bzone + h₀/2", `${num(d.zoneWidth, 0)} + ${num(d.h0 / 2, 1)} = ${num(d.outerOffset, 1)} мм от грани опоры`),
    table([["Характеристика внешнего контура", "Значение"], ["Отступ от грани опоры", mm(d.outerOffset)], ["Периметр внешнего контура", `${num(d.outerU / 1000)} м`], ["Wₓ / Wᵧ", `${num(d.outerWx / 1e6, 2)} / ${num(d.outerWy / 1e6, 2)} ·10⁶ мм²`], ["Поперечная арматура", "Не учитывается"], ["Вклад силы", num(d.outerForceRatio)], ["Принятый вклад моментов", num(d.outerMomentRatio)], ["Коэффициент использования", `η = ${num(d.outerEta)}`]]),
    formula("Aᵦ,outer = uouter · h₀", `${num(d.outerU, 0)} · ${num(d.h0, 0)} = ${num(outerAb, 0)} мм²`),
    formula("Fᵦ,ult,outer = Rbt · Aᵦ,outer", `${num(d.rbt, 2)} · ${num(outerAb, 0)} / 1000 = ${num(outerFb, 1)} кН`),
    formula("F/Fᵦ,ult,outer", `${num(d.force, 1)} / ${num(outerFb, 1)} = ${num(d.outerForceRatio)}`),
    formula("Mₓ,ult,outer = Rbt·Wₓ,outer·h₀", `${num(d.rbt, 2)}·${num(d.outerWx, 0)}·${num(d.h0, 0)}/10⁶ = ${num(outerMxUlt, 2)} кН·м`),
    formula("Mᵧ,ult,outer = Rbt·Wᵧ,outer·h₀", `${num(d.rbt, 2)}·${num(d.outerWy, 0)}·${num(d.h0, 0)}/10⁶ = ${num(outerMyUlt, 2)} кН·м`),
    formula("ΣM/Mult,outer", `${num(outerMxRatio)} + ${num(outerMyRatio)} = ${num(outerMxRatio + outerMyRatio)}`),
    formula("ηouter = F/Fᵦ,ult + min(ΣM/Mᵦ,ult; 0,5·F/Fᵦ,ult)", `${num(d.outerForceRatio)} + min(${num(outerMxRatio + outerMyRatio)}; ${num(0.5 * d.outerForceRatio)}) = ${num(d.outerEta)}`),
  );
  children.push(
    new Paragraph({ spacing: { before: 260, after: 120 }, shading: { fill: ok ? "E7F2EB" : "FBE9E5", type: ShadingType.CLEAR }, children: [new TextRun({ text: ok ? `ИТОГ: η = ${num(d.governingEta)} ≤ 1,000. Прочность обеспечена.` : `ИТОГ: η = ${num(d.governingEta)} > 1,000. Прочность не обеспечена.`, bold: true, size: 24, color: ok ? green : "B84932", font: "Arial" })] }),
    heading(d.reinforced ? "5. Расчётная основа" : "4. Расчётная основа"),
    table([
      ["Нормативная ссылка", "Что использовано в расчёте"],
      ["СП 63.13330.2018, п. 8.1.46", "Общая постановка расчёта на продавливание; совместное действие силы и моментов; ограничение вклада моментов."],
      ["СП 63.13330.2018, п. 8.1.47", "Положение и геометрия расчётного контура, учёт свободных краёв и отверстий."],
      ["СП 63.13330.2018, п. 8.1.48", "Поперечная арматура, минимальный учитываемый вклад, ограничение 2Fᵦ,ult и внешний контур."],
      ["СП 63.13330.2018, п. 8.1.49", "Проверка без поперечной арматуры, формулы (8.93)–(8.95)."],
      ["СП 63.13330.2018, п. 8.1.50", "Проверка с поперечной арматурой, формула (8.96)."],
      ["СП 63.13330.2018, п. 10.3.17", "Конструктивные требования к расположению поперечной арматуры в плите."],
    ]),
    new Paragraph({ spacing: { before: 120, after: 80 }, children: [new TextRun({ text: "Расчёт выполнен по СП 63.13330.2018, пункты 8.1.46–8.1.52 и 10.3.17. Для каждой проверки выше приведены исходная формула, числовая подстановка и полученный результат.", font: "Arial", size: 20, color: ink })] }),
    new Paragraph({ children: [new TextRun({ text: "Примечание. Отчёт сформирован инженерным калькулятором. Перед выпуском проектной документации результаты следует проверить на эталонных примерах и подтвердить применимость принятых расчётных предпосылок к объекту.", italics: true, font: "Arial", size: 18, color: gray })] }),
  );

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 20, color: ink }, paragraph: { spacing: { after: 120, line: 276 } } } }, paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial", size: 27, bold: true, color: ink }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial", size: 23, bold: true, color: green }, paragraph: { spacing: { before: 210, after: 90 }, keepNext: true } },
    ] },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134, header: 567, footer: 567 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Продавливание · СП 63     ", color: gray, size: 17 }), new TextRun({ children: [PageNumber.CURRENT], color: gray, size: 17 })] })] }) },
      children,
    }],
  });
  return Packer.toBlob(doc);
}

export async function downloadPunchingReport(d: ReportData) {
  const blob = await buildPunchingReport(d);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Расчет_на_продавливание_${d.caseLabel.replaceAll(" ", "_")}.docx`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
