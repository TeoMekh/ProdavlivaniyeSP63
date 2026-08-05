"use client";

import { useEffect, useMemo, useState } from "react";
import { downloadPunchingReport } from "./report";

type CaseType = "columnCenter" | "columnEdge" | "columnCorner" | "wallEnd" | "wallEdge";
type Segment = { x1: number; y1: number; x2: number; y2: number };
type Hole = { enabled: boolean; x: number; y: number; w: number; h: number };

const cases: Record<CaseType, { n: string; label: string; note: string }> = {
  columnCenter: { n: "01", label: "Колонна в середине", note: "Замкнутый контур на h₀/2 от граней колонны" },
  columnEdge: { n: "02", label: "Колонна у края", note: "Контур ограничен одним свободным краем плиты" },
  columnCorner: { n: "03", label: "Колонна у угла", note: "Контур ограничен двумя свободными краями плиты" },
  wallEnd: { n: "04", label: "Торец стены", note: "П-образный контур у торца стены / пилона" },
  wallEdge: { n: "05", label: "Торец стены у края", note: "Контур торца стены ограничен свободным краем" },
};

const concreteRbt: Record<string, number> = {
  "B15": 0.75, "B20": 0.90, "B25": 1.05, "B30": 1.15, "B35": 1.30,
  "B40": 1.40, "B45": 1.50, "B50": 1.60, "B55": 1.70, "B60": 1.80,
};
const steelRsw: Record<string, number> = { "A240": 170, "A500C": 300 };

const len = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function baseContour(kind: CaseType, cx: number, cy: number, h0: number, edgeX: number, edgeY: number, offset = h0 / 2): Segment[] {
  const d = offset;
  if (kind.startsWith("column")) {
    const x = cx / 2 + d, y = cy / 2 + d;
    const rect: Segment[] = [
      { x1: -x, y1: -y, x2: x, y2: -y }, { x1: x, y1: -y, x2: x, y2: y },
      { x1: x, y1: y, x2: -x, y2: y }, { x1: -x, y1: y, x2: -x, y2: -y },
    ];
    if (kind === "columnCenter") return rect;
    const slabBottom = -cy / 2 - edgeY;
    const slabRight = cx / 2 + edgeX;
    return rect.flatMap((s) => clipToSlab(s, kind === "columnCorner" ? slabRight : Infinity, slabBottom));
  }
  const a = cy + 2*d;
  const u: Segment[] = [
    { x1: d - a, y1: -a / 2, x2: d, y2: -a / 2 },
    { x1: d, y1: -a / 2, x2: d, y2: a / 2 },
    { x1: d, y1: a / 2, x2: d - a, y2: a / 2 },
  ];
  if (kind === "wallEnd") return u;
  return u.flatMap((s) => clipToSlab(s, Infinity, -cy / 2 - edgeY));
}

function clipToSlab(s: Segment, right: number, bottom: number): Segment[] {
  const dx=s.x2-s.x1,dy=s.y2-s.y1; let t0=0,t1=1;
  if(Number.isFinite(right)){
    if(Math.abs(dx)<1e-9){if(s.x1>right+1e-6)return []}
    else {const t=(right-s.x1)/dx;if(dx>0)t1=Math.min(t1,t);else t0=Math.max(t0,t)}
  }
  if(Math.abs(dy)<1e-9){if(s.y1<bottom-1e-6)return []}
  else {const t=(bottom-s.y1)/dy;if(dy>0)t0=Math.max(t0,t);else t1=Math.min(t1,t)}
  if(t1-t0<1e-7)return [];
  return [{x1:lerp(s.x1,s.x2,t0),y1:lerp(s.y1,s.y2,t0),x2:lerp(s.x1,s.x2,t1),y2:lerp(s.y1,s.y2,t1)}];
}

function openingData(hole: Hole, cx: number, cy: number, h0: number, wall: boolean) {
  const dx = wall ? Math.max(hole.x - hole.w / 2, 0) : Math.max(Math.abs(hole.x) - hole.w / 2 - cx / 2, 0);
  const dy = Math.max(Math.abs(hole.y) - hole.h / 2 - cy / 2, 0);
  const clear = Math.hypot(dx, dy);
  const corners = [
    [hole.x-hole.w/2,hole.y-hole.h/2], [hole.x+hole.w/2,hole.y-hole.h/2],
    [hole.x+hole.w/2,hole.y+hole.h/2], [hole.x-hole.w/2,hole.y+hole.h/2],
  ];
  const angular = corners.map((point) => ({point,angle:(Math.atan2(point[1],point[0])+Math.PI*2)%(Math.PI*2)})).sort((a,b)=>a.angle-b.angle);
  let largest=-1, gapIndex=0;
  for(let i=0;i<angular.length;i++){const next=i===angular.length-1?angular[0].angle+2*Math.PI:angular[i+1].angle;if(next-angular[i].angle>largest){largest=next-angular[i].angle;gapIndex=i}}
  const startItem=angular[(gapIndex+1)%angular.length],endItem=angular[gapIndex],start=startItem.angle,span=2*Math.PI-largest;
  return { clear, active: hole.enabled && clear <= 6*h0, start, span, corners, rays:[startItem.point,endItem.point] };
}

function trimByHole(segments: Segment[], hole: Hole, cx: number, cy: number, h0: number, wall: boolean) {
  const info=openingData(hole,cx,cy,h0,wall);
  if(!info.active) return { segments, info, removed: 0 };
  const kept:Segment[]=[]; let removed=0;
  for(const s of segments){
    const n=72;
    for(let i=0;i<n;i++){
      const t1=i/n,t2=(i+1)/n,tm=(t1+t2)/2;
      const x=lerp(s.x1,s.x2,tm),y=lerp(s.y1,s.y2,tm);
      const a=(Math.atan2(y,x)-info.start+Math.PI*4)%(Math.PI*2);
      const blocked=a<=info.span+1e-8;
      if(blocked) removed+=len(s)/n;
      else kept.push({x1:lerp(s.x1,s.x2,t1),y1:lerp(s.y1,s.y2,t1),x2:lerp(s.x1,s.x2,t2),y2:lerp(s.y1,s.y2,t2)});
    }
  }
  return {segments:kept,info,removed};
}

function trimByHoles(segments: Segment[], holes: Hole[], cx: number, cy: number, h0: number, wall: boolean) {
  let current=segments,removed=0;
  const results=holes.map(hole=>{
    const result=trimByHole(current,hole,cx,cy,h0,wall);
    current=result.segments;
    removed+=result.removed;
    return result;
  });
  return {segments:current,holes:results,removed};
}

function sectionProps(seg: Segment[]) {
  let u=0,sx=0,sy=0;
  seg.forEach(s=>{const l=len(s);u+=l;sx+=(s.x1+s.x2)/2*l;sy+=(s.y1+s.y2)/2*l});
  const xc=sx/u||0,yc=sy/u||0; let ix=0,iy=0,maxX=1,maxY=1;
  seg.forEach(s=>{const n=24,dl=len(s)/n;for(let i=0;i<n;i++){const t=(i+.5)/n,x=lerp(s.x1,s.x2,t)-xc,y=lerp(s.y1,s.y2,t)-yc;ix+=y*y*dl;iy+=x*x*dl;maxX=Math.max(maxX,Math.abs(x));maxY=Math.max(maxY,Math.abs(y));}});
  return {u,xc,yc,wx:ix/maxY,wy:iy/maxX};
}

function Field({label,value,setValue,unit,step=1,disabled=false}:{label:string;value:number;setValue:(v:number)=>void;unit:string;step?:number;disabled?:boolean}){
  const [draft,setDraft]=useState(String(value));
  useEffect(()=>setDraft(String(value)),[value]);
  const update=(text:string)=>{
    if(!/^-?\d*(?:[.,]\d*)?$/.test(text))return;
    setDraft(text);
    const normalized=text.replace(",",".");
    if(normalized!==""&&normalized!=="-"&&normalized!=="."&&normalized!=="-."){
      const number=Number(normalized);if(Number.isFinite(number))setValue(number);
    }
  };
  return <label className={`field ${disabled?"disabled":""}`}><span>{label}</span><div><input disabled={disabled} type="text" inputMode="decimal" value={draft} data-step={step} onChange={e=>update(e.target.value)} onBlur={()=>setDraft(String(value))}/><b>{unit}</b></div></label>;
}
function SelectField({label,value,setValue,options}:{label:string;value:string;setValue:(v:string)=>void;options:string[]}){
  return <label className="field"><span>{label}</span><div><select value={value} onChange={e=>setValue(e.target.value)}>{options.map(x=><option key={x}>{x}</option>)}</select></div></label>;
}
function Dim({x1,y1,x2,y2,label}:{x1:number;y1:number;x2:number;y2:number;label:string}){
  const mx=(x1+x2)/2,my=(y1+y2)/2,vertical=Math.abs(x2-x1)<2,w=label.length*6.1+10;
  return <g className="dimension"><line className="dimLine" x1={x1} y1={y1} x2={x2} y2={y2}/>{vertical?<><line className="dimTick" x1={x1-5} y1={y1+5} x2={x1+5} y2={y1-5}/><line className="dimTick" x1={x2-5} y1={y2+5} x2={x2+5} y2={y2-5}/><g transform={`rotate(-90 ${mx} ${my})`}><rect x={mx-w/2} y={my-8} width={w} height="16" rx="3"/><text x={mx} y={my+3}>{label}</text></g></>:<><line className="dimTick" x1={x1-5} y1={y1+5} x2={x1+5} y2={y1-5}/><line className="dimTick" x1={x2-5} y1={y2+5} x2={x2+5} y2={y2-5}/><rect x={mx-w/2} y={my-8} width={w} height="16" rx="3"/><text x={mx} y={my+3}>{label}</text></>}</g>;
}

export default function Home(){
  const [kind,setKind]=useState<CaseType>("columnCenter"),[h,setH]=useState(220),[cover,setCover]=useState(25),[bar,setBar]=useState(12);
  const [cx,setCx]=useState(400),[cy,setCy]=useState(400),[edgeX,setEdgeX]=useState(150),[edgeY,setEdgeY]=useState(150);
  const [concrete,setConcrete]=useState("B30"),[gamma,setGamma]=useState(1),[force,setForce]=useState(650),[mx,setMx]=useState(25),[my,setMy]=useState(15);
  const [hole,setHole]=useState(false),[hx,setHx]=useState(850),[hy,setHy]=useState(0),[hw,setHw]=useState(400),[hh,setHh]=useState(500);
  const [hole2,setHole2]=useState(false),[hx2,setHx2]=useState(-850),[hy2,setHy2]=useState(0),[hw2,setHw2]=useState(400),[hh2,setHh2]=useState(500);
  const [reinforced,setReinforced]=useState(false),[steel,setSteel]=useState("A500C"),[swDia,setSwDia]=useState(10),[swStep,setSwStep]=useState(100),[swOffset,setSwOffset]=useState(60);
  const [reportBusy,setReportBusy]=useState(false);
  const h0=Math.max(1,h-cover-bar/2), rbt=concreteRbt[concrete]*gamma;
  const holeObj={enabled:hole,x:hx,y:hy,w:hw,h:hh},holeObj2={enabled:hole2,x:hx2,y:hy2,w:hw2,h:hh2};
  const holes=[holeObj,holeObj2];
  const wall=kind.startsWith("wall");
  const raw=useMemo(()=>baseContour(kind,cx,cy,h0,edgeX,edgeY),[kind,cx,cy,h0,edgeX,edgeY]);
  const cut=useMemo(()=>trimByHoles(raw,holes,cx,cy,h0,wall),[raw,hole,hx,hy,hw,hh,hole2,hx2,hy2,hw2,hh2,cx,cy,h0,wall]);
  const p=sectionProps(cut.segments), rawU=raw.reduce((a,s)=>a+len(s),0);
  const vf=force*1000/(p.u*h0);
  const aswBar=Math.PI*swDia*swDia/4, asw=2*aswBar, qsw=steelRsw[steel]*asw/Math.max(swStep,1);
  const rowCount=Math.max(1,Math.ceil(Math.max(0,1.5*h0-swOffset)/Math.max(swStep,1))+1);
  const zoneWidth=swOffset+(rowCount-1)*swStep;
  const secondRow=swOffset+swStep;
  const pairStraddles=swOffset<=h0/2&&secondRow>=h0/2&&secondRow<=h0;
  const offsetOk=swOffset>=h0/3&&swOffset<=h0/2;
  const stepAllowed=swStep<=h0/3&&swStep<=300;
  const fb=rbt*p.u*h0/1000, fswRaw=0.8*qsw*p.u/1000, fswThreshold=0.25*fb, fswCap=fb;
  const fswAccepted=reinforced&&fswRaw>=fswThreshold?Math.min(fswRaw,fswCap):0;
  const swState=fswRaw<fswThreshold?"не учитывается":fswRaw>fswCap?"ограничено значением Fb":"учитывается полностью";
  const mbx=wall?Infinity:rbt*p.wx*h0/1e6,mby=rbt*p.wy*h0/1e6;
  const mswxRaw=wall?0:0.8*qsw*p.wx/1e6,mswyRaw=0.8*qsw*p.wy/1e6;
  const mswx=wall?0:fswAccepted*p.wx/Math.max(p.u,1)/1000,mswy=fswAccepted*p.wy/Math.max(p.u,1)/1000;
  const fult=fb+fswAccepted,mxUlt=mbx+mswx,myUlt=mby+mswy;
  const forceRatio=force/Math.max(fult,1e-9),mxRatio=wall?0:Math.abs(mx)/Math.max(mxUlt,1e-9),myRatio=Math.abs(my)/Math.max(myUlt,1e-9);
  const rawMomentRatio=mxRatio+myRatio, momentRatioLimit=0.5*forceRatio;
  const acceptedMomentRatio=Math.min(rawMomentRatio,momentRatioLimit), eta=forceRatio+acceptedMomentRatio;
  const momentLimited=rawMomentRatio>momentRatioLimit;
  const outerOffset=zoneWidth+h0/2;
  const outerRaw=useMemo(()=>baseContour(kind,cx,cy,h0,edgeX,edgeY,outerOffset),[kind,cx,cy,h0,edgeX,edgeY,outerOffset]);
  const outerCut=useMemo(()=>trimByHoles(outerRaw,holes,cx,cy,h0,wall),[outerRaw,hole,hx,hy,hw,hh,hole2,hx2,hy2,hw2,hh2,cx,cy,h0,wall]);
  const outerP=sectionProps(outerCut.segments);
  const outerForceStress=force*1000/(outerP.u*h0);
  const outerMomentStress=(wall?0:Math.abs(mx)*1e6/(outerP.wx*h0))+Math.abs(my)*1e6/(outerP.wy*h0);
  const outerForceRatio=outerForceStress/rbt;
  const outerMomentRatio=Math.min(outerMomentStress/rbt,0.5*outerForceRatio);
  const outerEta=outerForceRatio+outerMomentRatio;
  const governingEta=reinforced?Math.max(eta,outerEta):eta;
  const outerGoverns=reinforced&&outerEta>eta;
  const hasBottom=kind==="columnEdge"||kind==="columnCorner"||kind==="wallEdge", hasRight=kind==="columnCorner";
  const slabBottom=-cy/2-edgeY,slabRight=cx/2+edgeX;
  const geomSize=wall?Math.max(cy+2*(reinforced?outerOffset:h0/2),500):Math.max(cx+2*(reinforced?outerOffset:h0/2),cy+2*(reinforced?outerOffset:h0/2),500);
  const scale=Math.min(0.42,205/geomSize),ox=wall?315:275,oy=210,tx=(x:number)=>ox+x*scale,ty=(y:number)=>oy-y*scale;
  const topDimY=48,bottomDimY=372,leftDimX=54,rightDimX=566;
  const supportLeft=wall?-620/scale:-cx/2;
  const holeVisible=[hole&&cut.holes[0].info.clear<=7.5*h0,hole2&&cut.holes[1].info.clear<=7.5*h0];
  const holeStatuses=cut.holes.map((result,i)=>{
    const enabled=i===0?hole:hole2;
    return !enabled?`Отверстие ${i+1}: не задано`:result.info.active?`Отверстие ${i+1}: учтено, d = ${result.info.clear.toFixed(0)} мм ≤ 6h₀ = ${(6*h0).toFixed(0)} мм; дополнительно исключено ${((result.removed/rawU)*100).toFixed(0)}% контура`:`Отверстие ${i+1}: не влияет, d = ${result.info.clear.toFixed(0)} мм > 6h₀ = ${(6*h0).toFixed(0)} мм`;
  });
  const holeStatus=holeStatuses.filter((_,i)=>i===0?hole:hole2).join("; ")||"нет";
  const makeReport=async()=>{
    setReportBusy(true);
    try{
      await downloadPunchingReport({
        caseLabel:cases[kind].label,h,cover,bar,h0,cx,cy,edgeX:hasRight?edgeX:undefined,edgeY:hasBottom?edgeY:undefined,wall,
        concrete,rbt,gamma,force,mx:wall?0:mx,my,hole:hole||hole2,holeStatus,u:p.u,wx:p.wx,wy:p.wy,xc:p.xc,yc:p.yc,
        reinforced,steel,rsw:steelRsw[steel],swDia,swStep,swOffset,asw,qsw,rowCount,zoneWidth,fb,fswRaw,fswAccepted,fswThreshold,
        forceRatio,rawMomentRatio,momentLimit:momentRatioLimit,acceptedMomentRatio,eta,outerEta,outerU:outerP.u,outerWx:outerP.wx,outerWy:outerP.wy,
        outerForceRatio,outerMomentRatio,outerOffset,governingEta,
      });
    }finally{setReportBusy(false)}
  };
  return <main>
    <header><div className="brand"><span>П</span><div><strong>ПРОДАВЛИВАНИЕ</strong><small>расчёт перекрытий по СП 63</small></div></div><div className="status">Расчётная модель · v0.2</div></header>
    <section className="hero"><div><p className="eyebrow">Железобетонные конструкции</p><h1>Проверка плиты<br/>на продавливание</h1><p>Расчёт продавливания для колонн и стен с учётом краёв плиты, отверстий и поперечной арматуры.</p></div><div className={`verdict ${governingEta<=1?"ok":"bad"}`}><small>Коэффициент использования</small><strong>{Number.isFinite(governingEta)?governingEta.toFixed(2):"—"}</strong><span>{governingEta<=1?"Несущая способность обеспечена":"Несущая способность не обеспечена"}</span></div></section>
    <nav className="caseTabs">{(Object.keys(cases) as CaseType[]).map(k=><button className={kind===k?"active":""} onClick={()=>setKind(k)} key={k}><small>{cases[k].n}</small>{cases[k].label}</button>)}</nav>
    <div className="workspace">
      <aside>
        <div className="panelHead"><b>Исходные данные</b><span>мм · кН · МПа</span></div>
        <details open><summary>Плита и опора</summary><div className="grid"><Field label="Толщина плиты h" value={h} setValue={setH} unit="мм"/><Field label="Защитный слой" value={cover} setValue={setCover} unit="мм"/><Field label="Ø продольной арматуры" value={bar} setValue={setBar} unit="мм"/>{wall?<Field label="Толщина стены t" value={cy} setValue={setCy} unit="мм"/>:<><Field label="Размер колонны cx" value={cx} setValue={setCx} unit="мм"/><Field label="Размер колонны cy" value={cy} setValue={setCy} unit="мм"/></>}{hasBottom&&<Field label="До края плиты ya" value={edgeY} setValue={setEdgeY} unit="мм"/>}{hasRight&&<Field label="До края плиты xa" value={edgeX} setValue={setEdgeX} unit="мм"/>}</div><div className="derived column"><span>Рабочая высота h₀ <b>{h0.toFixed(0)} мм</b></span>{wall&&<span>Участок контура a = t + h₀ <b>{(cy+h0).toFixed(0)} мм</b></span>}</div></details>
        <details open><summary>Материал и усилия</summary><div className="grid"><SelectField label="Класс бетона" value={concrete} setValue={setConcrete} options={Object.keys(concreteRbt)}/><Field label="Rbt по СП 63" value={concreteRbt[concrete]} setValue={()=>{}} unit="МПа" disabled/><Field label="Коэффициент γb" value={gamma} setValue={setGamma} unit="—" step={.05}/><Field label="Продольная сила F" value={force} setValue={setForce} unit="кН"/><Field label="Момент Mx" value={mx} setValue={setMx} unit="кН·м" disabled={wall}/><Field label="Момент My" value={my} setValue={setMy} unit="кН·м"/></div>{wall&&<p className="hint strong">Для торца стены по методике отчёта учитывается момент только в направлении Y.</p>}</details>
        <details open><summary>Отверстия рядом с опорой</summary><div className="holeBlock"><label className="switch"><input type="checkbox" checked={hole} onChange={e=>setHole(e.target.checked)}/><i></i><span>Учитывать отверстие 1</span></label>{hole&&<div className="grid"><Field label="Центр отверстия 1 — X" value={hx} setValue={setHx} unit="мм"/><Field label="Центр отверстия 1 — Y" value={hy} setValue={setHy} unit="мм"/><Field label="Ширина отверстия 1" value={hw} setValue={setHw} unit="мм"/><Field label="Высота отверстия 1" value={hh} setValue={setHh} unit="мм"/></div>}<div className={`holeState ${cut.holes[0].info.active?"active":""}`}><span>Влияние отверстия 1</span><b>{holeStatuses[0]}</b></div></div><div className="holeBlock second"><label className="switch"><input type="checkbox" checked={hole2} onChange={e=>setHole2(e.target.checked)}/><i></i><span>Учитывать отверстие 2</span></label>{hole2&&<div className="grid"><Field label="Центр отверстия 2 — X" value={hx2} setValue={setHx2} unit="мм"/><Field label="Центр отверстия 2 — Y" value={hy2} setValue={setHy2} unit="мм"/><Field label="Ширина отверстия 2" value={hw2} setValue={setHw2} unit="мм"/><Field label="Высота отверстия 2" value={hh2} setValue={setHh2} unit="мм"/></div>}<div className={`holeState ${cut.holes[1].info.active?"active":""}`}><span>Влияние отверстия 2</span><b>{holeStatuses[1]}</b></div></div><p className="hint">Можно учитывать одно или два отверстия. Координаты задаются от центра колонны или середины торца стены. Для каждого отверстия в пределах 6h₀ из контура исключается соответствующий участок между лучами к его крайним точкам.</p></details>
        <details open><summary>Поперечная арматура</summary><label className="switch"><input type="checkbox" checked={reinforced} onChange={e=>setReinforced(e.target.checked)}/><i></i><span>Учитывать поперечную арматуру</span></label>{reinforced&&<><div className="grid"><SelectField label="Класс арматуры" value={steel} setValue={setSteel} options={["A500C","A240"]}/><Field label="Rsw" value={steelRsw[steel]} setValue={()=>{}} unit="МПа" disabled/><Field label="Диаметр стержня" value={swDia} setValue={setSwDia} unit="мм"/><Field label="Отступ первого ряда a₀" value={swOffset} setValue={setSwOffset} unit="мм"/><Field label="Шаг сетки sₓ = sᵧ = sw" value={swStep} setValue={setSwStep} unit="мм"/></div><div className={`recommend ${offsetOk?"ok":"bad"}`}><b>Отступ первого ряда</b><span>h₀/3 ≤ a₀ ≤ h₀/2: {(h0/3).toFixed(0)}–{(h0/2).toFixed(0)} мм</span></div><div className={`recommend ${stepAllowed?"ok":"bad"}`}><b>Шаг сетки</b><span>sw ≤ min(h₀/3; 300 мм) = {Math.min(h0/3,300).toFixed(0)} мм</span></div><div className={`recommend ${pairStraddles?"ok":"warn"}`}><b>Рабочая пара у контура</b><span>{pairStraddles?`ряды ${swOffset.toFixed(0)} и ${secondRow.toFixed(0)} мм находятся по разные стороны h₀/2`:`проверьте положение двух рядов относительно h₀/2 = ${(h0/2).toFixed(0)} мм`}</span></div><div className="derived column swCalc"><section><div className="swCalcHead"><b>Размещение арматуры</b><small>СП 63 · п. 10.3.17</small></div><span>Asw = 2·AØ <b>{asw.toFixed(1)} мм²</b></span><span>Зона армирования ≥ 1,5h₀ <b>{rowCount} ряда; {zoneWidth.toFixed(0)} мм</b></span></section><section><div className="swCalcHead"><b>Расчётное усилие Fsw</b><small>СП 63 · п. 8.1.51</small></div><span>qsw = Rsw·Asw/sw <b>{qsw.toFixed(1)} Н/мм</b></span><span>Fsw,ult = 0,8·qsw·u <b>{fswRaw.toFixed(1)} кН</b></span></section><section><div className="swCalcHead"><b>Условия учёта Fsw</b><small>СП 63 · пп. 8.1.48, 8.1.50</small></div><span>Минимум 0,25Fb,ult <b>{fswThreshold.toFixed(1)} кН</b></span><span>Ограничение Fsw,ult ≤ Fb,ult <b>{fswCap.toFixed(1)} кН</b></span><span className="accepted">Принято Fsw,ult <b>{fswAccepted.toFixed(1)} кН</b></span><span>Fb,ult + Fsw,ult ≤ 2Fb,ult <b>{(fb+fswAccepted).toFixed(1)} ≤ {(2*fb).toFixed(1)} кН</b></span></section><section><div className="swCalcHead"><b>Предельные моменты Msw</b><small>СП 63 · пп. 8.1.50, 8.1.52</small></div>{!wall&&<span>Msw,x: расчётное / принятое <b>{mswxRaw.toFixed(2)} / {mswx.toFixed(2)} кН·м</b></span>}<span>Msw,y: расчётное / принятое <b>{mswyRaw.toFixed(2)} / {mswy.toFixed(2)} кН·м</b></span>{!wall&&<span className="accepted">Mbx,ult + Msw,x,ult ≤ 2Mbx,ult <b>{mxUlt.toFixed(2)} ≤ {(2*mbx).toFixed(2)} кН·м</b></span>}<span className="accepted">Mby,ult + Msw,y,ult ≤ 2Mby,ult <b>{myUlt.toFixed(2)} ≤ {(2*mby).toFixed(2)} кН·м</b></span></section></div><div className={`swCheck ${fswRaw>=fswThreshold&&fswRaw<=fswCap?"ok":"warn"}`}><b>Итог учёта арматуры:</b><span>{swState}</span></div></>}</details>
      </aside>
      <section className="results">
        <div className="drawing card"><div className="cardTitle"><div><b>Расчётная схема</b><small>{cases[kind].note}</small></div><span>вид сверху · размеры в мм</span></div>
          <svg viewBox="0 0 620 420" role="img" aria-label="Схема опоры, краёв плиты, отверстия и укороченного контрольного контура">
            <defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#aeb8b0" strokeWidth="2"/></pattern><marker id="axisArrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#809087"/></marker></defs>
            <rect x="1" y="1" width="618" height="418" rx="8" fill="#f7f7f3"/>
            <g className="axes"><line x1={tx(-Math.max(cx,cy)/2-h0)} y1={ty(0)} x2={tx(Math.max(cx,cy)/2+h0)} y2={ty(0)} markerEnd="url(#axisArrow)"/><line x1={tx(0)} y1={ty(-Math.max(cx,cy)/2-h0)} x2={tx(0)} y2={ty(Math.max(cx,cy)/2+h0)} markerEnd="url(#axisArrow)"/><text x={tx(Math.max(cx,cy)/2+h0)+8} y={ty(0)+4}>X</text><text x={tx(0)+7} y={ty(Math.max(cx,cy)/2+h0)-7}>Y</text><circle cx={tx(0)} cy={ty(0)} r="2.5"/><text x={tx(0)+7} y={ty(0)+14}>O</text></g>
            {hasBottom&&<line className="slabEdge" x1="48" y1={ty(slabBottom)} x2={hasRight?tx(slabRight):574} y2={ty(slabBottom)}/>} {hasRight&&<line className="slabEdge" x1={tx(slabRight)} y1="44" x2={tx(slabRight)} y2={ty(slabBottom)}/>} 
            <rect x={tx(supportLeft)} y={ty(cy/2)} width={(wall?Math.abs(supportLeft):cx)*scale} height={cy*scale} fill="url(#hatch)" stroke="#26342a" strokeWidth="2"/>
            {wall&&<g className="breakMark"><path d={`M${tx(supportLeft)+22},${ty(cy/2)-6} l-7,12 l14,12 l-14,12 l7,12`}/></g>}
            {holes.map((item,i)=>holeVisible[i]&&<g key={`hole-${i}`}><rect x={tx(item.x-item.w/2)} y={ty(item.y+item.h/2)} width={item.w*scale} height={item.h*scale} fill="#fff" stroke="#bc4c35" strokeWidth="2"/><text x={tx(item.x)} y={ty(item.y)+4} textAnchor="middle" className="holeLabel">Отв. {i+1}</text></g>)}
            {cut.holes.map((result,i)=>result.info.active&&holeVisible[i]&&result.info.rays&&<g className="rays" key={`rays-${i}`}><line x1={tx(0)} y1={ty(0)} x2={tx(result.info.rays[0][0])} y2={ty(result.info.rays[0][1])}/><line x1={tx(0)} y1={ty(0)} x2={tx(result.info.rays[1][0])} y2={ty(result.info.rays[1][1])}/></g>)}
            {reinforced&&outerCut.segments.map((s,i)=><line className="outerContour" strokeDasharray="10 8" key={`outer-${i}`} x1={tx(s.x1)} y1={ty(s.y1)} x2={tx(s.x2)} y2={ty(s.y2)}/>)}
            {cut.segments.map((s,i)=><line key={i} x1={tx(s.x1)} y1={ty(s.y1)} x2={tx(s.x2)} y2={ty(s.y2)} stroke="#df7c22" strokeWidth="4" strokeLinecap="round"/>)}
            <circle cx={tx(p.xc)} cy={ty(p.yc)} r="5" fill="#df7c22"/>{wall||hasRight?<g className="leaderLabel"><path className="leader" d={`M${tx(p.xc)-5},${ty(p.yc)-5} l-16,-18 h-78`}/><rect x={tx(p.xc)-108} y={ty(p.yc)-42} width="96" height="17" rx="3"/><text x={tx(p.xc)-60} y={ty(p.yc)-29} textAnchor="middle" className="svgText">Cᵤ ({p.xc.toFixed(0)}; {p.yc.toFixed(0)})</text></g>:<g className="leaderLabel"><path className="leader" d={`M${tx(p.xc)+5},${ty(p.yc)-5} l16,-18 h78`}/><rect x={tx(p.xc)+12} y={ty(p.yc)-42} width="96" height="17" rx="3"/><text x={tx(p.xc)+60} y={ty(p.yc)-29} textAnchor="middle" className="svgText">Cᵤ ({p.xc.toFixed(0)}; {p.yc.toFixed(0)})</text></g>}
            {!wall&&<><line className="extension" x1={tx(-cx/2)} y1={ty(cy/2)} x2={tx(-cx/2)} y2={topDimY}/><line className="extension" x1={tx(cx/2)} y1={ty(cy/2)} x2={tx(cx/2)} y2={topDimY}/><Dim x1={tx(-cx/2)} y1={topDimY} x2={tx(cx/2)} y2={topDimY} label={`cx = ${cx}`}/><line className="extension" x1={tx(-cx/2)} y1={ty(cy/2)} x2={leftDimX} y2={ty(cy/2)}/><line className="extension" x1={tx(-cx/2)} y1={ty(-cy/2)} x2={leftDimX} y2={ty(-cy/2)}/><Dim x1={leftDimX} y1={ty(cy/2)} x2={leftDimX} y2={ty(-cy/2)} label={`cy = ${cy}`}/></>}
            {wall&&<><line className="extension" x1={tx(h0/2-(cy+h0))} y1={ty(cy/2+h0/2)} x2={tx(h0/2-(cy+h0))} y2={topDimY}/><line className="extension" x1={tx(h0/2)} y1={ty(cy/2+h0/2)} x2={tx(h0/2)} y2={topDimY}/><Dim x1={tx(h0/2-(cy+h0))} y1={topDimY} x2={tx(h0/2)} y2={topDimY} label={`a = t + h₀ = ${(cy+h0).toFixed(0)}`}/><line className="extension" x1={tx(0)} y1={ty(cy/2)} x2={rightDimX} y2={ty(cy/2)}/><line className="extension" x1={tx(0)} y1={ty(-cy/2)} x2={rightDimX} y2={ty(-cy/2)}/><Dim x1={rightDimX} y1={ty(cy/2)} x2={rightDimX} y2={ty(-cy/2)} label={`t = ${cy}`}/></>}
            <g className="offsetDim"><line className="extension" x1={tx(wall?0:cx/2)} y1={ty(-cy/2)} x2={tx(wall?0:cx/2)} y2={bottomDimY}/><line className="extension" x1={tx((wall?0:cx/2)+h0/2)} y1={ty(-cy/2-h0/2)} x2={tx((wall?0:cx/2)+h0/2)} y2={bottomDimY}/><Dim x1={tx(wall?0:cx/2)} y1={bottomDimY} x2={tx((wall?0:cx/2)+h0/2)} y2={bottomDimY} label={`h₀/2 = ${(h0/2).toFixed(0)}`}/></g>
            {hasBottom&&<><line className="extension" x1={tx(-cx/2)} y1={ty(-cy/2)} x2={leftDimX+30} y2={ty(-cy/2)}/><line className="extension" x1={tx(-cx/2)} y1={ty(slabBottom)} x2={leftDimX+30} y2={ty(slabBottom)}/><Dim x1={leftDimX+30} y1={ty(-cy/2)} x2={leftDimX+30} y2={ty(slabBottom)} label={`ya = ${edgeY}`}/></>}
            {hasRight&&<><line className="extension" x1={tx(cx/2)} y1={ty(cy/2)} x2={tx(cx/2)} y2={topDimY+30}/><line className="extension" x1={tx(slabRight)} y1={ty(cy/2)} x2={tx(slabRight)} y2={topDimY+30}/><Dim x1={tx(cx/2)} y1={topDimY+30} x2={tx(slabRight)} y2={topDimY+30} label={`xa = ${edgeX}`}/></>}
          </svg><div className="legend"><span><i className="support"></i>опора</span><span><i className="contour"></i>основной контур</span>{reinforced&&<span><i className="outer"></i>внешний контур без Asw</span>}{hasBottom&&<span><i className="edge"></i>край плиты</span>}{(hole||hole2)&&<span><i className="opening"></i>отверстия</span>}</div>
        </div>
        <div className="metrics"><div><small>Длина контура u</small><b>{(p.u/1000).toFixed(3)} м</b><em>{cut.removed>0?`− ${(cut.removed/1000).toFixed(3)} м из-за отверстий`:"без сокращения"}</em></div><div><small>Wₓ / Wᵧ</small><b>{(p.wx/1e6).toFixed(2)} / {(p.wy/1e6).toFixed(2)} ×10⁶ мм²</b></div><div><small>Центр контура x / y</small><b>{p.xc.toFixed(0)} / {p.yc.toFixed(0)} мм</b></div></div>
        <div className="check card"><div className="cardTitle"><div><b>Проверка прочности</b><small>{outerGoverns?"Определяет внешний контур без поперечной арматуры":"Определяет основной расчётный контур"}</small></div><span className={governingEta<=1?"pill green":"pill red"}>{governingEta<=1?"выполнено":"не выполнено"}</span></div>
          <div className="formula">{fswAccepted>0?<><span>F/(Fᵦ,ult + Fsw,ult)</span><i>+</i><span>min ({!wall&&<>Mₓ/(Mᵦx,ult + Msw,x,ult) + </>}Mᵧ/(Mᵦy,ult + Msw,y,ult) ; 0,5·F/(Fᵦ,ult + Fsw,ult))</span></>:<><span>F/Fᵦ,ult</span><i>+</i><span>min ({!wall&&<>Mₓ/Mᵦx,ult + </>}Mᵧ/Mᵦy,ult ; 0,5·F/Fᵦ,ult)</span></>}<i>≤</i><span>1</span></div>
          <div className="bar"><i style={{width:`${Math.min(100,governingEta*100)}%`}} className={governingEta<=1?"safe":"danger"}></i><em style={{left:`${Math.min(96,governingEta*100)}%`}}>{(governingEta*100).toFixed(0)}%</em></div>
          <div className="breakdown"><div><span>{fswAccepted>0?"F / (Fᵦ,ult + Fsw,ult)":"F / Fᵦ,ult"}</span><b>{forceRatio.toFixed(3)}</b></div><div><span>Моменты, полный вклад</span><b>{rawMomentRatio.toFixed(3)}</b></div><div><span>Предел 0,5·F/Fult</span><b>{momentRatioLimit.toFixed(3)}</b></div><div><span>Принято от моментов</span><b>{acceptedMomentRatio.toFixed(3)}</b></div><div className="total"><span>Коэффициент использования</span><b>{eta.toFixed(3)}</b></div></div>
          {reinforced&&fswAccepted===0&&<div className="normLimit"><b>Поперечная арматура не вошла в формулу</b><span>Не выполнен минимум Fsw,ult ≥ 0,25Fᵦ,ult по п. 8.1.48; основной контур проверен только по бетону.</span></div>}
          {momentLimited&&<div className="normLimit"><b>Сработало ограничение СП 63, п. {fswAccepted>0?"8.1.50":"8.1.49"}</b><span>Полный относительный вклад моментов {rawMomentRatio.toFixed(3)} принят равным пределу {acceptedMomentRatio.toFixed(3)} = 0,5·F/Fult.</span></div>}
          {reinforced&&<div className={`outerCheck ${outerEta<=1?"ok":"bad"}`}><div><b>Внешний контур без поперечной арматуры</b><small>СП 63 · п. 8.1.48 — положение контура; п. 8.1.49 — проверка без Asw</small><span>На h₀/2 за последним рядом: отступ от грани {outerOffset.toFixed(0)} мм, u = {(outerP.u/1000).toFixed(3)} м</span></div><strong>η = {outerEta.toFixed(3)}</strong></div>}
        </div>
        <div className="reportAction"><div><b>Расчётный отчёт</b><span>Исходные данные, формулы с подстановками, проверки обоих контуров и итоговое заключение.</span></div><button onClick={makeReport} disabled={reportBusy}>{reportBusy?"Формируем…":"Скачать отчёт DOCX"}</button></div>
        <div className="method"><b>Расчётная основа</b><p>СП 63.13330.2018 с изменениями: пп. 8.1.46–8.1.50. При совместном действии силы и моментов относительный вклад моментов принимается не более 0,5·F/Fult. Специальные контуры у торцов стен — методика НИИЖБ, раздел 9. Одно или два отверстия учитываются объединённым сокращением контура и повторным вычислением его центра тяжести, Wₓ и Wᵧ.</p><strong>Инженерный прототип: перед выпуском проектной документации требуется верификация на эталонных примерах и проверка применимости коэффициентов к конкретному объекту.</strong></div>
      </section>
    </div>
  </main>;
}
