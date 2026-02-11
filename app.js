import{createElement as h,useState,useCallback,useEffect,useRef,Fragment}from"https://esm.sh/react@18.2.0";
import{createRoot}from"https://esm.sh/react-dom@18.2.0/client";
import{TEAMS,tn,TK,espnSB,espnSum,parseEv,computeExc,oGrade,gradeFor,extractKP,buildBox,buildStats,buildPlayerStats,buildSummaryData,getAllPlays,getWPSeries}from"./engine.js";

const cc=c=>({s:"cs",a:"ca",b:"cb",c:"cc",d:"cd",f:"cf"}[c]||"");
const bc=c=>({s:"bs",a:"ba",b:"bbl",c:"bc",d:"bd",f:"bf2"}[c]||"");
const normTeam=(x)=>x==="LAR"?"LA":x;
const _ns=s=>(s||"").toString().replace(/\s+/g," ").trim();

// ── Clean ESPN play text into readable English ──
function _cleanPlay(s){
  s=_ns(s);if(!s)return"";
  // Remove everything after extra point / PAT / penalty markers
  const cuts=["extra point","TWO-POINT","two-point","Penalty","PENALTY","(kick failed)","(pass failed)","(run formation)"];
  for(const m of cuts){const i=s.toLowerCase().indexOf(m.toLowerCase());if(i>0){s=s.slice(0,i).trim();break;}}
  s=s.replace(/\(.*?shotgun.*?\)/ig,"").replace(/\(.*?no huddle.*?\)/ig,"").replace(/\s+/g," ").trim();
  s=s.replace(/\.+$/,"").trim();
  if(s.length>200)s=s.slice(0,200).replace(/\s\S*$/,"")+"...";
  return s;
}

// Transform ESPN raw play text into a natural-sounding description
function _humanizePlay(raw){
  if(!raw)return"";
  let s=_ns(raw);

  // Strip everything from "** Injury" onward
  s=s.replace(/\*\*\s*Injury.*/i,"").trim();
  // Strip everything from "RECOVERED by" onward (unless it's a return TD)
  if(!/return.*touchdown/i.test(s)){
    s=s.replace(/,?\s*RECOVERED by\s+[A-Z]{2,4}-\S+.*/i,"").trim();
  }
  // Strip penalty info
  s=s.replace(/\.\s*Penalty.*$/i,"").trim();
  // Remove extra point / PAT / 2pt attempt
  const patCuts=["extra point","TWO-POINT","two-point","(kick failed)","(pass failed)","(run failed)"];
  for(const m of patCuts){const i=s.toLowerCase().indexOf(m.toLowerCase());if(i>0){s=s.slice(0,i).trim();break;}}
  // Remove formation indicators
  s=s.replace(/\(.*?shotgun.*?\)/ig,"").replace(/\(.*?no huddle.*?\)/ig,"");
  // Remove defensive player brackets [K.Joseph]
  s=s.replace(/\s*\[.*?\]/g,"");
  // Remove tackler parentheses (A.Robertson) or (A.Robertson, K.Joseph)
  s=s.replace(/\s*\(([A-Z][a-z]?\.\s*[A-Za-z'-]+(?:[,;]\s*[A-Z][a-z]?\.\s*[A-Za-z'-]+)*)\)/g,"");
  // Remove "FUMBLES , " and "FUMBLES, " (we describe fumbles in our own words)
  s=s.replace(/\.\s*FUMBLES?\s*[,.]?\s*/i,". Fumble. ");
  // Expand initial-based names: "J.Goff" → "Goff", "Ja.Williams" → "Williams"
  s=s.replace(/\b[A-Z][a-z]?\.\s*([A-Z][A-Za-z'-]+)/g, "$1");
  // "pass short middle to" → "pass to"
  s=s.replace(/pass\s+(short|deep)\s+(left|right|middle)\s+to/gi, "pass to");
  // "pushed ob at MIN 25 for 14 yards" → "for 14 yards to the 25"
  s=s.replace(/pushed ob at [A-Z]{2,4}\s+(\d+)/g, "to the $1");
  s=s.replace(/ran ob at [A-Z]{2,4}\s+(\d+)/g, "to the $1");
  // "to DET 25 for 14 yards" → "for 14 yards to the 25-yard line"  
  s=s.replace(/to [A-Z]{2,4}\s+(\d+)/g, "to the $1");
  // ", TOUCHDOWN" → " for a touchdown"
  s=s.replace(/,?\s*TOUCHDOWN/gi, " for a touchdown");
  // "for no gain"
  s=s.replace(/for no gain/g,"for no gain");
  // Remove "No Play" completely
  if(/no play/i.test(s)) return"";
  // Clean up double spaces, trailing dots/commas
  s=s.replace(/\s+/g," ").replace(/[.,]\s*$/,"").trim();
  if(s.length>180)s=s.slice(0,180).replace(/\s\S*$/,"")+"...";
  return s;
}


// ── Time helpers (for turning points / clutch windows) ──
function _clockToSec(clock){
  const m=(clock||"").match(/^(\d+):(\d{2})$/);
  if(!m)return null;
  return (+m[1])*60+(+m[2]);
}
function _remSec(period, clock){
  const c=_clockToSec(clock);
  if(c==null)return null;
  if(period<=4){
    const remInReg=(4-period)*900 + c;
    return remInReg;
  }
  // Overtime: treat as 0.. (doesn't matter much for narrative)
  return c;
}
function _sortByGameTimeDesc(arr){
  return [...(arr||[])].sort((a,b)=>{
    const ra=_remSec(a.period||0,a.clock||"")??-1;
    const rb=_remSec(b.period||0,b.clock||"")??-1;
    return rb-ra;
  });
}
function _scoreAfter(p){ return `${p.awayScore}-${p.homeScore}`; }
function _leadSide(p, homeAbbr, awayAbbr){
  if(p.homeScore>p.awayScore) return homeAbbr;
  if(p.awayScore>p.homeScore) return awayAbbr;
  return "TIE";
}
function _pointsDelta(prev, cur){
  const ph=prev?.homeScore??0, pa=prev?.awayScore??0;
  const ch=cur?.homeScore??0, ca=cur?.awayScore??0;
  return (ch-ph)+(ca-pa);
}
function _leadChangesFromScoring(scoring, homeAbbr, awayAbbr){
  const s=_sortByGameTimeDesc(scoring).reverse(); // chronological
  let prev="TIE";
  const changes=[];
  let prevScore={homeScore:0,awayScore:0,period:0,clock:"15:00"};
  for(const p of s){
    const lead=_leadSide(p,homeAbbr,awayAbbr);
    if(prev!=="TIE" && lead!=="TIE" && lead!==prev){
      changes.push({at:p,from:prev,to:lead,points:_pointsDelta(prevScore,p)});
    }
    prev=lead;
    prevScore=p;
  }
  return changes;
}
// Build a natural-language description of a play for the recap/modals
// Takes the raw play text plus context (score, time, teams)
function _describePlay(raw, ctx){
  let text=_humanizePlay(raw);
  if(!text)return"";
  // ctx: {period, clock, homeScore, awayScore, homeName, awayName, absDelta}
  if(ctx){
    const per=ctx.period<=4?`Q${ctx.period}`:"OT";
    const parts=[];
    if(ctx.clock) parts.push(`with ${ctx.clock} left in the ${per}`);
    if(ctx.homeScore!=null && ctx.awayScore!=null){
      const leader=ctx.homeScore>ctx.awayScore?ctx.homeName:ctx.homeScore<ctx.awayScore?ctx.awayName:null;
      const high=Math.max(ctx.homeScore,ctx.awayScore), low=Math.min(ctx.homeScore,ctx.awayScore);
      if(leader) parts.push(`giving ${leader} a ${high}-${low} lead`);
      else if(ctx.homeScore===ctx.awayScore) parts.push(`tying the game at ${high}`);
    }
    if(parts.length) text+=`, ${parts.join(", ")}`;
  }
  return text;
}

function _pick(arr,seed){if(!arr.length)return"";return arr[Math.abs(seed)%arr.length];}
function _qLabel(p){return p<=4?`Q${p}`:"OT";}

function buildRecap(sum){
  if(!sum) return null;

  const homeAb=sum.homeTeam, awayAb=sum.awayTeam;
  const homeN=sum.homeName, awayN=sum.awayName;
  const hs=sum.homeScore, as=sum.awayScore;
  const winnerIsHome = hs>as;
  const W = winnerIsHome ? homeN : awayN;
  const L = winnerIsHome ? awayN : homeN;
  const winScore = Math.max(hs,as);
  const loseScore = Math.min(hs,as);
  const hasOT = !!sum.hasOT;
  const pRound = sum.playoffRound||"";
  const ctxPre = pRound ? (pRound==="Super Bowl" ? "In the Super Bowl, " : `In the ${pRound}, `) : "";

  const scoring = _sortByGameTimeDesc(sum.scoringPlays||[]);
  const notable = _sortByGameTimeDesc(sum.notablePlays||[]);
  const topSwings = [...(sum.enrichedPlays||[])]
    .filter(p=>p?.text && !/no play/i.test(p.text))
    .sort((a,b)=>(b.absDelta||0)-(a.absDelta||0))
    .slice(0,3)
    .map(p=>({...p, text:_humanizePlay(p.text)}))
    .filter(p=>p.text);

  const leadChanges = _leadChangesFromScoring(sum.scoringPlays||[], homeAb, awayAb);
  const lastLeadChange = leadChanges.length ? leadChanges[leadChanges.length-1].at : null;

  // Late scoring (final 2:00 of regulation)
  const lateScores = scoring.filter(p=>{
    const r=_remSec(p.period,p.clock);
    return r!=null && r<=120 && (p.period<=4);
  });
  const latePoints = lateScores.reduce((acc,p,idx)=>{
    const prev = idx===0 ? null : lateScores[idx-1];
    if(!prev) return acc + (p.homeScore+p.awayScore); // rough; replaced below
    return acc;
  },0);

  const paras=[];

  // ── Lede ──
  let lede = `${ctxPre}${W} beat ${L} ${winScore}-${loseScore}${hasOT?" in overtime":""}.`;
  const arche = sum.archetype?.type||"";
  if(arche==="wire" && (sum.finalMargin||0)>=14){
    lede += " It was largely one-way traffic.";
  } else if(arche==="seesaw" && leadChanges.length){
    lede += ` The lead changed hands ${leadChanges.length} time${leadChanges.length===1?"":"s"} on the scoring timeline.`;
  } else if(arche==="comeback" && (sum.maxWinnerDeficit||0)>=10){
    lede += ` ${W} erased a ${sum.maxWinnerDeficit}-point deficit.`;
  } else if((sum.finalMargin||0)<=3){
    lede += " It came down to the final possessions.";
  }
  paras.push(lede);

  // ── Turning points / game story ──
  // Prefer: (1) last lead change score, (2) top swing play, (3) early game breaker for blowouts
  const storyBits=[];
  if(lastLeadChange){
    storyBits.push(`The decisive turn came on ${_describePlay(_humanizePlay(lastLeadChange.text),{
      period:lastLeadChange.period, clock:lastLeadChange.clock,
      homeScore:lastLeadChange.homeScore, awayScore:lastLeadChange.awayScore,
      homeName:homeN, awayName:awayN
    })}, making it ${_scoreAfter(lastLeadChange)}.`);
  }

  // Add up to two high-leverage plays not already captured by the last lead change
  for(const p of topSwings){
    if(lastLeadChange && p.period===lastLeadChange.period && p.clock===lastLeadChange.clock) continue;
    const swingPct = Math.round((p.absDelta||0)*100);
    const desc=_describePlay(p.text,{
      period:p.period, clock:p.clock,
      homeScore:p.homeScore, awayScore:p.awayScore,
      homeName:homeN, awayName:awayN
    });
    if(desc) storyBits.push(`The biggest swing on the chart was about ${swingPct}% on ${desc}.`);
    if(storyBits.length>=3) break;
  }

  // Blowout-specific: look for defensive scores / early turnovers
  if((sum.finalMargin||0)>=21){
    const defTD = scoring.find(p=>/return|intercept|fumble/i.test(p.text||"")) || notable.find(p=>p.type==="INT"||p.type==="FUM");
    if(defTD && storyBits.length<3){
      const dsc = defTD.text ? _describePlay(_humanizePlay(defTD.text),{
        period:defTD.period, clock:defTD.clock,
        homeScore:defTD.homeScore, awayScore:defTD.awayScore,
        homeName:homeN, awayName:awayN
      }) : null;
      if(dsc) storyBits.push(`That was the moment the game broke open: ${dsc}.`);
    }
  }

  if(storyBits.length){
    paras.push(storyBits.join(" "));
  }

  // ── Finish ──
  const finishBits=[];
  if(lateScores.length>=2){
    // Points scored in the final 2:00 of regulation, computed from scoring deltas
    const allChron=_sortByGameTimeDesc(scoring).reverse(); // chronological
    let pts=0;
    for(let i=0;i<allChron.length;i++){
      const p=allChron[i];
      const r=_remSec(p.period,p.clock);
      if(r!=null && r<=120 && p.period<=4){
        const prev = i>0 ? allChron[i-1] : {homeScore:0,awayScore:0};
        pts += _pointsDelta(prev,p);
      }
    }
    finishBits.push(`There were ${pts} points scored in the final two minutes of regulation.`);
  }

  if(hasOT){
    // Try to reference OT winner play if present in scoring (often will be last TD/FG in OT)
    const otScore = _sortByGameTimeDesc(scoring).reverse().find(p=>p.period>4);
    if(otScore){
      const od=_describePlay(_humanizePlay(otScore.text),{
        period:otScore.period, clock:otScore.clock,
        homeScore:otScore.homeScore, awayScore:otScore.awayScore,
        homeName:homeN, awayName:awayN
      });
      if(od) finishBits.push(`Overtime ended on ${od}.`);
    } else {
      finishBits.push("It ended in overtime.");
    }
  } else if((sum.finalMargin||0)>=21){
    finishBits.push(`${W} was able to manage the second half without drama.`);
  } else if(lastLeadChange){
    finishBits.push(`After that final swing, ${L} couldn’t answer on the remaining possessions.`);
  }

  if(finishBits.length) paras.push(finishBits.join(" "));

  return paras;
}


// ── WP Chart: vertical line on tap, bigger dots, OT x-axis fix ──

function WPChart({series, mode, onModeChange, exc, topLev, homeTeam, awayTeam}){
  const [tooltip,setTooltip]=useState(null);
  const [vLine,setVLine]=useState(null); // {x, wp, tMin, homeScore, awayScore}

  if(!series||series.length<2){
    return h("div",{style:{color:"var(--text-3)",fontFamily:"JetBrains Mono",fontSize:".75rem"}},"Win probability data unavailable.");
  }

  // Determine max game time (OT extends past 60)
  const maxTMin=Math.max(...series.filter(s=>s.tMin!=null).map(s=>s.tMin));
  const gameMaxMin=maxTMin>60?Math.ceil(maxTMin/5)*5:60;

  const W=860,H=200,pad=28;
  const toX=t=>pad+(t/gameMaxMin)*(W-2*pad);
  const toY=wp=>pad+(1-wp)*(H-2*pad);

  const step=Math.max(1,Math.floor(series.length/500));
  const pts=[];
  for(let i=0;i<series.length;i+=step){
    const s=series[i];
    if(s&&s.tMin!=null&&s.wp!=null)pts.push([toX(s.tMin),toY(s.wp)]);
  }
  const path="M "+pts.map(p=>p[0].toFixed(2)+" "+p[1].toFixed(2)).join(" L ");

  // Axis labels
  const axisLabels=[];
  const interval=gameMaxMin>70?10:15;
  for(let m=0;m<=gameMaxMin;m+=interval) axisLabels.push({m,label:m===0?"0:00":`${m}:00`});

  // Quarter dividers
  const qDividers=[];
  for(let q=1;q<=3;q++){qDividers.push(toX(q*15));}
  if(gameMaxMin>60) qDividers.push(toX(60)); // regulation end marker for OT games

  const overlays=[];
  const hitAreas=[];

  function addDot(cx,cy,r,fill,stroke,data){
    overlays.push(h("circle",{key:`dot-${overlays.length}`,cx,cy,r,fill,stroke:stroke||"none",strokeWidth:stroke?1.5:0,style:{cursor:"pointer"}}));
    hitAreas.push({cx,cy,r:Math.max(r,12),...data});
  }

  if(mode==="Leverage"){
    (topLev||[]).slice(0,6).forEach(tp=>{
      if(tp.tMin==null)return;
      const per=tp.period<=4?`Q${tp.period}`:"OT";
      addDot(toX(tp.tMin),toY(tp.wp||0.5),6,"var(--gold)","rgba(201,162,39,.4)",{
        label:`${per} ${tp.clock}`,
        detail:_humanizePlay(tp.text)||"High leverage play",
        sub:`WP swing: ${Math.round(Math.abs(tp.delta||tp.absDelta||0)*100)}% | Score: ${tn(homeTeam)} ${tp.homeScore}, ${tn(awayTeam)} ${tp.awayScore}`,
        wp:tp.wp, tMin:tp.tMin, homeScore:tp.homeScore, awayScore:tp.awayScore
      });
    });
  }else if(mode==="Swings"){
    for(let i=1;i<series.length;i++){
      const a=series[i-1].wp,b=series[i].wp;
      if(a==null||b==null)continue;
      if((a<0.5&&b>=0.5)||(a>=0.5&&b<0.5)){
        const s=series[i];
        const per=s.period<=4?`Q${s.period}`:"OT";
        addDot(toX(s.tMin),toY(s.wp),5.5,"var(--blue)","rgba(61,142,212,.4)",{
          label:`${per} ${s.clock} — Lead change`,
          detail:_humanizePlay(s.text)||"Win probability crossed 50%",
          sub:`${tn(homeTeam)} ${s.homeScore}, ${tn(awayTeam)} ${s.awayScore}`,
          wp:s.wp, tMin:s.tMin, homeScore:s.homeScore, awayScore:s.awayScore
        });
      }
    }
  }else if(mode==="Chaos"){
    for(const s of series){
      if(s.tag==="TO"||s.tag==="SP"){
        const per=s.period<=4?`Q${s.period}`:"OT";
        const lbl=s.tag==="TO"?"Turnover":"Special teams";
        addDot(toX(s.tMin),toY(s.wp),5.5,"var(--red)","rgba(212,64,64,.4)",{
          label:`${per} ${s.clock} — ${lbl}`,
          detail:_humanizePlay(s.text)||lbl,
          sub:`WP swing: ${Math.round(s.absDelta*100)}% | Score: ${tn(homeTeam)} ${s.homeScore}, ${tn(awayTeam)} ${s.awayScore}`,
          wp:s.wp, tMin:s.tMin, homeScore:s.homeScore, awayScore:s.awayScore
        });
      }
    }
  }else if(mode==="Clutch"){
    const clutchStart=Math.max(52, gameMaxMin-8);
    overlays.push(h("rect",{key:"clutch-zone",x:toX(clutchStart),y:pad,width:toX(gameMaxMin)-toX(clutchStart),height:H-2*pad,fill:"rgba(201,162,39,.08)"}));
  }

  function handleSVGClick(e){
    const svg=e.currentTarget;
    const rect=svg.getBoundingClientRect();
    const scaleX=W/rect.width;
    const cx=(e.clientX-rect.left)*scaleX;
    const cy=(e.clientY-rect.top)*(H/rect.height);

    // Check if we hit a dot first
    let best=null,bestDist=Infinity;
    for(const ha of hitAreas){
      const dx=cx-ha.cx,dy=cy-ha.cy;
      const dist=Math.sqrt(dx*dx+dy*dy);
      if(dist<ha.r*3&&dist<bestDist){best=ha;bestDist=dist;}
    }
    if(best){
      setTooltip(best);
      setVLine({x:best.cx, wp:best.wp, tMin:best.tMin, homeScore:best.homeScore, awayScore:best.awayScore});
      return;
    }

    // Otherwise, find nearest play in time for vertical line
    const clickTMin=((cx-pad)/(W-2*pad))*gameMaxMin;
    let nearest=null,nearDist=Infinity;
    for(const s of series){
      if(s.tMin==null)continue;
      const d=Math.abs(s.tMin-clickTMin);
      if(d<nearDist){nearDist=d;nearest=s;}
    }
    if(nearest){
      setVLine({x:toX(nearest.tMin), wp:nearest.wp, tMin:nearest.tMin, homeScore:nearest.homeScore, awayScore:nearest.awayScore});
      setTooltip(null);
    }
  }

  const homeName=tn(homeTeam||"Home");
  const awayName=tn(awayTeam||"Away");

  return h("div",{className:"sec"},
    h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:"1rem",flexWrap:"wrap"}},
      h("div",{className:"sec-h",style:{borderBottom:"none",marginBottom:"0"}},`Win Probability (${homeName})`),
      h("div",{style:{display:"flex",alignItems:"center",gap:".5rem"}},
        h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".65rem",letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-3)"}},"Overlay"),
        h("select",{value:mode,onChange:e=>{onModeChange(e.target.value);setTooltip(null);setVLine(null);},style:{background:"var(--bg-3)",border:"1px solid var(--border-1)",color:"var(--text-1)",padding:".35rem .5rem",fontFamily:"JetBrains Mono",fontSize:".7rem"}},
          ["Leverage","Swings","Chaos","Clutch"].map(o=>h("option",{key:o,value:o},o))))),
    h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".6rem",color:"var(--text-4)",marginTop:".3rem",marginBottom:".2rem"}},
      mode==="Leverage"?"Gold dots = highest WP swings. Tap dots for play details, or tap anywhere for score.":
      mode==="Swings"?"Blue dots = lead changes (WP crossed 50%). Tap for details.":
      mode==="Chaos"?"Red dots = turnovers and special teams plays. Tap for details.":
      "Gold zone = final 8 min of Q4 + OT. Tap anywhere for WP at that point."),
    h("div",{style:{border:"1px solid var(--border-1)",background:"var(--bg-2)",padding:".6rem .6rem .2rem",position:"relative"}},
      h("svg",{viewBox:`0 0 ${W} ${H}`,width:"100%",height:"auto",preserveAspectRatio:"none",onClick:handleSVGClick,style:{cursor:"pointer"}},
        // Y-axis labels
        h("text",{x:pad-4,y:toY(1),fill:"var(--text-4)",fontSize:"9",textAnchor:"end",dominantBaseline:"middle"},"100%"),
        h("text",{x:pad-4,y:toY(0.5),fill:"var(--text-4)",fontSize:"9",textAnchor:"end",dominantBaseline:"middle"},"50%"),
        h("text",{x:pad-4,y:toY(0),fill:"var(--text-4)",fontSize:"9",textAnchor:"end",dominantBaseline:"middle"},"0%"),
        // Midline
        h("line",{x1:toX(0),y1:toY(0.5),x2:toX(gameMaxMin),y2:toY(0.5),stroke:"rgba(136,146,164,.35)",strokeWidth:"1",strokeDasharray:"4 4"}),
        // Quarter dividers
        ...qDividers.map((x,i)=>h("line",{key:`qd-${i}`,x1:x,y1:pad,x2:x,y2:H-pad,stroke:"rgba(136,146,164,.15)",strokeWidth:"1",strokeDasharray:"2 3"})),
        // Clutch zone (behind line)
        (mode==="Clutch"&&overlays.length)?overlays[0]:null,
        // WP line
        h("path",{d:path,fill:"none",stroke:"rgba(232,236,240,.85)",strokeWidth:"2"}),
        // Overlay dots
        ...(mode==="Clutch"?overlays.slice(1):overlays),
        // Vertical cursor line
        vLine?h("line",{x1:vLine.x,y1:pad,x2:vLine.x,y2:H-pad,stroke:"var(--gold)",strokeWidth:"1",strokeDasharray:"3 3",opacity:.7}):null,
        // WP percentage label at cursor
        vLine?h("text",{x:vLine.x+(vLine.x>W/2?-8:8),y:toY(vLine.wp)-8,fill:"var(--gold)",fontSize:"11",fontWeight:"600",textAnchor:vLine.x>W/2?"end":"start"},`${Math.round(vLine.wp*100)}%`):null
      ),
      h("div",{style:{display:"flex",justifyContent:"space-between",fontFamily:"JetBrains Mono",fontSize:".6rem",color:"var(--text-4)",marginTop:".25rem",paddingLeft:`${pad}px`,paddingRight:`${pad}px`}},
        ...axisLabels.map((l,i)=>h("div",{key:i},l.label))
      ),
      // Vertical line info bar
      vLine&&!tooltip?h("div",{style:{background:"var(--bg-3)",border:"1px solid var(--border-1)",padding:".4rem .7rem",marginTop:".4rem",display:"flex",justifyContent:"space-between",alignItems:"center",fontFamily:"JetBrains Mono",fontSize:".7rem"},onClick:()=>setVLine(null)},
        h("span",{style:{color:"var(--gold)"}},`${Math.round(vLine.wp*100)}% ${homeName}`),
        h("span",{style:{color:"var(--text-2)"}},`${tn(homeTeam)} ${vLine.homeScore}, ${tn(awayTeam)} ${vLine.awayScore}`),
        h("span",{style:{color:"var(--text-4)"}},"tap to dismiss")
      ):null,
      // Dot tooltip
      tooltip?h("div",{style:{background:"var(--bg-3)",border:"1px solid var(--border-2)",padding:".6rem .8rem",marginTop:".4rem"},onClick:()=>{setTooltip(null);setVLine(null);}},
        h("div",{style:{fontFamily:"Oswald",fontSize:".85rem",color:"var(--text-1)",marginBottom:".2rem"}},tooltip.label),
        h("div",{style:{fontSize:".8rem",color:"var(--text-2)",lineHeight:"1.5"}},tooltip.detail),
        tooltip.sub?h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".7rem",color:"var(--gold)",marginTop:".2rem"}},tooltip.sub):null,
        h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".55rem",color:"var(--text-4)",marginTop:".3rem"}},"Tap to dismiss")
      ):null
    )
  );
}


// ── Category Detail Modal — game-specific, natural language ──
// ── Category Detail Modal — game-specific, natural language ──
function CategoryModal({cat,k,onClose,g,wpStats,enrichedPlays,sumData,wpSeries}){
  const homeN=tn(g.ht), awayN=tn(g.at);
  const homeShort=g.ht, awayShort=g.at;
  const winnerN=g.hs>g.as?homeN:awayN;

  const scoring=sumData?.scoringPlays||[];
  const notable=sumData?.notablePlays||[];
  const series=wpSeries||[];

  let explanation="";

  // Convenience: top plays by WP swing
  const topSwings=[...(enrichedPlays||[])]
    .filter(p=>p?.text && !/no play/i.test(p.text))
    .sort((a,b)=>(b.absDelta||0)-(a.absDelta||0))
    .slice(0,3);

  if(k==="leverage"){
    const sumAbs=wpStats?.sumAbsDelta;
    const maxAbs=wpStats?.maxAbsDelta;

    if(sumAbs==null){
      explanation="Win probability movement wasn’t available for this game.";
    } else {
      if(sumAbs>=2.4) explanation="This one was extremely volatile — the win probability swung hard and often.";
      else if(sumAbs>=1.9) explanation="High‑leverage moments stacked up — the win probability kept lurching on pivotal snaps.";
      else if(sumAbs>=1.4) explanation="A fairly normal leverage profile — a few big moments, but not constant chaos.";
      else explanation="Low leverage overall — the win probability moved, but rarely in dramatic steps.";

      if(topSwings.length){
        const lines=topSwings.map(p=>{
          const swingPct=Math.round((p.absDelta||0)*100);
          const desc=_describePlay(_humanizePlay(p.text),{
            period:p.period, clock:p.clock,
            homeScore:p.homeScore, awayScore:p.awayScore,
            homeName:homeN, awayName:awayN
          });
          return desc ? `${swingPct}% on ${desc}` : `${swingPct}% swing`;
        });
        explanation += " Biggest swings: " + lines.join("; ") + ".";
      } else if(maxAbs!=null){
        explanation += ` Peak swing: ${Math.round(maxAbs*100)}%.`;
      }
    }

  } else if(k==="swings"){
    // Scoring lead changes (not just WP crossings)
    const changes=_leadChangesFromScoring(scoring, homeShort, awayShort);

    if(!changes.length){
      explanation=`There were no scoring lead changes — ${winnerN} controlled the scoreboard throughout.`;
    } else {
      explanation=`The scoring lead changed hands ${changes.length} time${changes.length===1?"":"s"}.`;
      const lastTwo=changes.slice(-2);
      const bits=lastTwo.map(ch=>{
        const p=ch.at;
        const who=(ch.to===homeShort)?homeN:(ch.to===awayShort?awayN:ch.to);
        const desc=_describePlay(_humanizePlay(p.text),{
          period:p.period, clock:p.clock,
          homeScore:p.homeScore, awayScore:p.awayScore,
          homeName:homeN, awayName:awayN
        });
        return desc?`${who} grabbed the lead on ${desc} (score ${_scoreAfter(p)})`:`Lead change to ${who}`;
      });
      explanation += " " + bits.join(". ") + ".";
    }

    const c50=wpStats?.crosses50;
    if(c50!=null){
      explanation += ` WP flipped at 50% ${c50} time${c50===1?"":"s"}.`;
    }

  } else if(k==="clutch"){
    // Final 8 minutes of regulation + OT
    const clutchScores=_sortByGameTimeDesc(scoring).filter(p=>{
      const r=_remSec(p.period,p.clock);
      return (p.period>4) || (r!=null && r<=480 && p.period<=4);
    }).reverse();

    if(!clutchScores.length && !(series||[]).some(p=>p?.remSec!=null && (p.remSec<=480 || p.period>4))){
      explanation="There wasn’t much late-game tension — the outcome was effectively decided before the final eight minutes.";
    } else {
      if(clutchScores.length){
        const last=clutchScores.slice(-3).map(p=>{
          const desc=_describePlay(_humanizePlay(p.text),{
            period:p.period, clock:p.clock,
            homeScore:p.homeScore, awayScore:p.awayScore,
            homeName:homeN, awayName:awayN
          });
          return desc||null;
        }).filter(Boolean);
        if(last.length) explanation += "Late scoring: " + last.join("; ") + ". ";
      }

      // Biggest late swing from WP series
      const clutchPlays=(series||[]).filter(p=>p?.remSec!=null && (p.remSec<=480 || p.period>4));
      const topClutch=[...clutchPlays].sort((a,b)=>(b.absDelta||0)-(a.absDelta||0))[0];
      if(topClutch?.text){
        const swingPct=Math.round((topClutch.absDelta||0)*100);
        const desc=_describePlay(_humanizePlay(topClutch.text),{
          period:topClutch.period, clock:topClutch.clock,
          homeScore:topClutch.homeScore, awayScore:topClutch.awayScore,
          homeName:homeN, awayName:awayN
        });
        if(desc) explanation += `Biggest late swing: about ${swingPct}% on ${desc}.`;
      }
      if(!explanation) explanation="There were meaningful moments late, but the biggest swings didn’t align cleanly to a single highlighted play.";
    }

  } else if(k==="control"){
    const frac=wpStats?.doubtFrac;
    if(frac==null){
      explanation="Competitiveness data wasn’t available for this game.";
    } else {
      const pct=Math.round(frac*100);
      if(frac>=0.7) explanation=`The game stayed in doubt for most of the day (${pct}% between 20% and 80% WP).`;
      else if(frac>=0.45) explanation=`A decent share of the game was competitive (${pct}% in the “in doubt” band), with swings back and forth.`;
      else explanation=`The game wasn’t in doubt very often (${pct}% in the 20–80% band); one side usually held a clear edge.`;
    }

  } else if(k==="chaos"){
    const turnovers=notable.filter(p=>p.type==="INT"||p.type==="FUM");
    const chaosMarks=(series||[]).filter(s=>s.tag==="TO"||s.tag==="SP").sort((a,b)=>(b.absDelta||0)-(a.absDelta||0));

    if(!turnovers.length && !chaosMarks.length){
      explanation="No major chaos drivers (turnovers/special teams shocks) showed up in the data.";
    } else if(!turnovers.length){
      explanation="No turnovers, but special teams and/or explosive plays still created sharp win‑probability jolts.";
    } else {
      explanation=`There ${turnovers.length===1?"was":"were"} ${turnovers.length} turnover${turnovers.length===1?"":"s"}.`;
      const top=chaosMarks[0];
      if(top?.text){
        const swingPct=Math.round((top.absDelta||0)*100);
        const per=_qLabel(top.period);
        const clock=top.clock?`with ${top.clock} left in ${per}`:`in ${per}`;
        const txt=_humanizePlay(top.text);
        if(txt) explanation += ` The biggest chaos moment came ${clock}: ${txt}${swingPct?` (${swingPct}% WP swing)`:""}.`;
      }
    }

  } else if(k==="contextR"){
    if(cat.score>=7) explanation=`This matchup carries real rivalry heat — history and familiarity add edge beyond the box score.`;
    else if(cat.score>=4) explanation=`Division familiarity adds spice: the teams know each other’s tendencies, and the margin for error feels smaller.`;
    else explanation=`Not much rivalry context here — the entertainment value depends on the game itself.`;

  } else if(k==="contextS"){
    const detail=cat.detail||"";
    if(cat.score>=8) explanation=`High stakes — this was the kind of game where every possession feels heavier.`;
    else if(cat.score>=5) explanation=`Meaningful stakes — the result mattered for postseason position or momentum.`;
    else if(/resting/i.test(detail)) explanation=`Reduced stakes — roster management context can flatten the competitive feel.`;
    else explanation=`Lower stakes on paper — drama had to come from the play on the field.`;
  }

  const gr=gradeFor(cat.score,cat.max);

  return h("div",{style:{position:"fixed",inset:0,background:"rgba(7,9,13,.85)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"},onClick:onClose},
    h("div",{style:{background:"var(--bg-2)",border:"1px solid var(--border-2)",padding:"1.5rem",maxWidth:"480px",width:"100%",maxHeight:"80vh",overflowY:"auto"},onClick:e=>e.stopPropagation()},
      h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".75rem"}},
        h("div",{style:{fontFamily:"Oswald",fontSize:"1.1rem",fontWeight:600,letterSpacing:".04em",color:"var(--text-1)"}},cat.name),
        h("div",{className:`${cc(gr.c)}`,style:{fontFamily:"Oswald",fontSize:"1.5rem",fontWeight:700}},`${cat.score}/${cat.max}`)
      ),
      h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".7rem",color:"var(--gold-dim)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:".5rem"}},`Grade: ${gr.g} — ${gr.l}`),
      h("div",{style:{fontSize:".88rem",color:"var(--text-2)",lineHeight:1.75,marginBottom:".75rem"}},explanation||""),
      h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".65rem",color:"var(--text-4)",borderTop:"1px solid var(--border-1)",paddingTop:".5rem"}},cat.detail),
      h("button",{onClick:onClose,style:{marginTop:"1rem",fontFamily:"Oswald",fontSize:".8rem",letterSpacing:".08em",textTransform:"uppercase",background:"var(--bg-3)",border:"1px solid var(--border-1)",color:"var(--text-2)",padding:".4rem 1rem",cursor:"pointer"}},"Close")
    )
  );
}

// ── Main App ──
function App(){
  const[t1,sT1]=useState("");const[t2,sT2]=useState("");const[ssn,sSsn]=useState("2024");const[wk,sWk]=useState("");const[st,sSt]=useState("2");
  const[games,sGames]=useState([]);const[ldg,sLdg]=useState(false);const[prog,sProg]=useState({p:0,t:""});
  const[sort,sSort]=useState("dateDesc");
  const[det,sDet]=useState(null);const[ldD,sLdD]=useState(false);const[err,sErr]=useState(null);
  const[meth,sMeth]=useState(false);const[cache,sCache]=useState({});const[batching,sBatching]=useState(false);
  const[summary,sSummary]=useState(null);const[sumData,sSumData]=useState(null);const[sumLoading,sSumLoading]=useState(false);const[selGame,sSelGame]=useState(null);
  const detRef=useRef(null);

  const seasons=[];for(let y=2024;y>=1970;y--)seasons.push(""+y);
  const weeks=[];for(let w=1;w<=18;w++)weeks.push(""+w);

  useEffect(()=>{if(det&&detRef.current)detRef.current.scrollIntoView({behavior:'smooth',block:'start'})},[det]);

  const search=useCallback(async()=>{
    if(!ssn&&!t1){sErr("Select at least a season or team.");return}
    sLdg(true);sGames([]);sDet(null);sSummary(null);sErr(null);sCache({});sProg({p:0,t:"Searching..."});sSelGame(null);sSort("dateDesc");
    try{
      let fetchFailures=0,fetchBatches=0;
      const res=[];let seasonsToSearch=ssn?[ssn]:[];
      if(!ssn)for(let y=2024;y>=2015;y--)seasonsToSearch.push(""+y);
      const types=st?[st]:["2","3"];const allBatches=[];
      for(const season of seasonsToSearch){if(wk){for(const s of types)allBatches.push({season,w:wk,s})}else{for(const s of types){const mx=s==="3"?5:18;for(let w=1;w<=mx;w++)allBatches.push({season,w:""+w,s})}}}
      let done=0;
      for(let i=0;i<allBatches.length;i+=8){
        const batch=allBatches.slice(i,i+8);fetchBatches+=batch.length;
        const r=await Promise.all(batch.map(({season,w,s})=>espnSB({dates:season,week:w,seasontype:s,limit:50}).then(ev=>ev.map(parseEv).filter(Boolean)).catch(()=>{fetchFailures++;return[]})));
        for(const x of r)res.push(...x);done+=batch.length;
        sProg({p:Math.round(done/allBatches.length*100),t:seasonsToSearch.length>1?`Searching ${seasonsToSearch.length} seasons... ${Math.round(done/allBatches.length*100)}%`:`Fetching week ${Math.min(done,allBatches.length)} of ${allBatches.length}...`})}
      if(fetchBatches>0&&fetchFailures===fetchBatches)throw new Error("ALL_FETCHES_FAILED");
      let f=res.filter(g=>g&&(g.done||(g.hs!==0||g.as!==0)));
      if(t1){const nt=normTeam(t1);f=f.filter(g=>normTeam(g.ht)===nt||normTeam(g.at)===nt)}
      if(t2){const nt2=normTeam(t2);f=f.filter(g=>normTeam(g.ht)===nt2||normTeam(g.at)===nt2)}
      const seen=new Set();f=f.filter(g=>{if(seen.has(g.id))return false;seen.add(g.id);return true});
      sGames(f);
    }catch(e){if(String(e&&e.message)==="ALL_FETCHES_FAILED")sErr("ESPN fetch failed. Make sure Netlify Functions are deployed.");else sErr("Failed to load games.")}
    sLdg(false);sProg({p:100,t:""});
  },[t1,t2,ssn,wk,st]);

  const analyze=useCallback(async g=>{
    sSelGame(g);sLdD(true);sDet(null);sErr(null);sSummary(null);sSumData(null);
    try{
      const d=await espnSum(g.id);const exc=computeExc(g,d);const kp=extractKP(d);const wp=getWPSeries(d);
      const box=buildBox(d);const stats=buildStats(d);const pStats=buildPlayerStats(d);
      sDet({exc,kp,box,stats,pStats,d,wp});sCache(p=>({...p,[g.id]:exc.total}));sLdD(false);
      sSumLoading(true);
      const sd=buildSummaryData(g,d,exc);sSumData(sd);sSummary(buildRecap(sd));sSumLoading(false);
    }catch(e){sErr("Failed to analyze. ESPN data may not be available.");sLdD(false)}
  },[]);

  const batchAn=useCallback(async()=>{
    sBatching(true);const unc=games.filter(g=>!(g.id in cache));let done=0;
    for(let i=0;i<unc.length;i+=4){
      const b=unc.slice(i,i+4);
      const r=await Promise.all(b.map(async g=>{try{const d=await espnSum(g.id);return{id:g.id,sc:computeExc(g,d).total}}catch{return{id:g.id,sc:0}}}));
      const u={};for(const x of r)u[x.id]=x.sc;sCache(p=>({...p,...u}));done+=b.length;
      sProg({p:Math.round(done/unc.length*100),t:`Analyzing ${done} of ${unc.length}...`})}
    sBatching(false);sSort("exc");
  },[games,cache]);

  function toggleDateSort(){if(sort==="dateDesc")sSort("dateAsc");else sSort("dateDesc");}
  const sorted=[...games].sort((a,b)=>{
    if(sort==="exc"){const sa=cache[a.id]??-1,sb=cache[b.id]??-1;return sb-sa}
    if(sort==="dateAsc")return new Date(a.date)-new Date(b.date);return new Date(b.date)-new Date(a.date);
  });

  return h("div",{className:"app"},
    h("div",{className:"hdr"},h("div",{className:"hdr-tag"},"1970 \u2014 Present"),h("h1",null,"NFL Excitement Index"),h("div",{className:"sub"},"Quantifying what makes football unforgettable")),
    !det?h(Fragment,null,
      h("div",{className:"sp"},
        h("div",{className:"sr"},
          h("div",{className:"fld"},h("label",null,"Team 1"),h("select",{value:t1,onChange:e=>sT1(e.target.value)},h("option",{value:""},"Any Team"),TK.map(k=>h("option",{key:k,value:k},TEAMS[k])))),
          h("div",{className:"fld"},h("label",null,"Team 2"),h("select",{value:t2,onChange:e=>sT2(e.target.value)},h("option",{value:""},"Any Team"),TK.map(k=>h("option",{key:k,value:k},TEAMS[k])))),
          h("div",{className:"fld"},h("label",null,"Season"),h("select",{value:ssn,onChange:e=>sSsn(e.target.value)},h("option",{value:""},"Last 10 Years"),seasons.map(s=>h("option",{key:s,value:s},s)))),
          h("div",{className:"fld-row"},
            h("div",{className:"fld fld-sm"},h("label",null,"Week"),h("select",{value:wk,onChange:e=>sWk(e.target.value)},h("option",{value:""},"All"),weeks.map(w=>h("option",{key:w,value:w},`Wk ${w}`)))),
            h("div",{className:"fld fld-sm"},h("label",null,"Type"),h("select",{value:st,onChange:e=>sSt(e.target.value)},h("option",{value:"2"},"Regular"),h("option",{value:"3"},"Playoffs"),h("option",{value:""},"Both")))),
          h("button",{className:"btn btn-p",onClick:search,disabled:ldg},ldg?"...":"Search")),
        h("div",{className:"hints"},!ssn&&t1?"Will search 2015-2024. Select a season for faster results.":"Set a team + season to see all their games.")),
      ldg?h("div",{className:"ld"},h("div",{className:"ld-r"}),h("div",{className:"ld-t"},prog.t),prog.p>0&&prog.p<100?h("div",{className:"pw"},h("div",{className:"pb"},h("div",{className:"pf",style:{width:`${prog.p}%`}}))):null):null,
      err&&!det?h("div",{style:{textAlign:"center",padding:"2rem"}},h("div",{style:{color:"var(--red)",fontFamily:"Oswald",fontSize:"1.1rem"}},"Error"),h("div",{style:{color:"var(--text-3)",fontSize:".85rem"}},err)):null,
      games.length>0&&!ldg?h("div",{className:"rl"},
        h("div",{className:"rl-hdr"},h("div",{className:"rl-cnt"},`${games.length} game${games.length!==1?"s":""} found`),
          h("div",{className:"sc"},h("button",{className:`sb${sort.startsWith("date")?" on":""}`,onClick:toggleDateSort},sort==="dateAsc"?"Date \u2191":"Date \u2193"),
            games.every(g=>g.id in cache)?h("button",{className:`sb${sort==="exc"?" on":""}`,onClick:()=>sSort("exc")},"By Excitement"):h("button",{className:"sb",onClick:batchAn,disabled:batching},batching?"Analyzing...":"Rank by Excitement"))),
        batching?h("div",{className:"pw"},h("div",{className:"pb"},h("div",{className:"pf",style:{width:`${prog.p}%`}})),h("div",{className:"pl"},prog.t)):null,
        sorted.map(g=>{const c=cache[g.id];const gr=c!=null?oGrade(c):null;
          const hw=g.hs>g.as;const aw=g.as>g.hs;const hi=Math.max(g.hs,g.as);const lo=Math.min(g.hs,g.as);
          const ds=new Date(g.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
          return h("div",{key:g.id,className:"gr",onClick:()=>analyze(g)},
            h("div",null,h("span",{className:"mu"},h("span",{className:aw?"wt":""},g.at),h("span",{className:"at"}," @ "),h("span",{className:hw?"wt":""},g.ht)),
              c!=null?h("span",{className:`ep ${cc(gr.c)}`,style:{borderColor:`var(--g${gr.c})`}},`${c} \u2014 ${gr.g}`):null),
            h("div",{className:"sc2"},`${hi}\u2013${lo}`),
            h("div",{className:"mc"},ds,h("br"),g.week?.number?(g.season?.type===3?"Playoffs":`Week ${g.week.number}`):""))})
      ):null,
      (!ldg&&!err&&games.length===0)?h("div",{style:{textAlign:"center",padding:"2rem",color:"var(--text-3)",fontFamily:"JetBrains Mono",fontSize:".75rem"}},"No games matched those filters."):null
    ):null,
    ldD?h("div",{className:"ld"},h("div",{className:"ld-r"}),h("div",{className:"ld-t"},"Analyzing play-by-play data...")):null,
    det&&selGame?h("div",{ref:detRef},h(Detail,{g:selGame,d:det,summary,sumData,sumLoading,meth,sMeth,onBack:()=>{sDet(null);sSelGame(null);sSummary(null);sSumData(null);}})):null,
    h("div",{className:"ftr"},"NFL Game Excitement Index \u00b7 Play-by-play data from ESPN"));
}

function Detail({g,d,summary,sumData,sumLoading,meth,sMeth,onBack}){
  const{exc,kp,box,stats,pStats,wp}=d;const og=oGrade(exc.total);
  const date=new Date(g.date).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const tags={td:["TD","t-td"],fg:["FG","t-cl"],to:["TURNOVER","t-to"],bg:["BIG PLAY","t-bg"],cl:["CLUTCH","t-cl"],sp:["SPECIAL","t-sp"],"4d":["4TH DOWN","t-bg"]};
  const passCols=["C/ATT","YDS","AVG","TD","INT","QBR"];
  const[wpMode,setWpMode]=useState("Leverage");
  const[catModal,setCatModal]=useState(null);
  const rushCols=["CAR","YDS","AVG","TD","LONG"];
  const recCols=["REC","YDS","AVG","TD","LONG","TGTS"];

  function pTable(label,players,cols){
    if(!players||players.length===0)return null;
    const useCols=cols.filter(c=>players.some(p=>p[c]!=null&&p[c]!==""));
    return h(Fragment,null,
      h("tr",null,h("td",{className:"pst-cat",colSpan:useCols.length+1},label)),
      h("tr",null,h("th",null,"Player"),...useCols.map(c=>h("th",{key:c},c))),
      players.map((p,i)=>h("tr",{key:i},h("td",null,p.name,h("span",{className:"tm-tag"},p.team)),...useCols.map(c=>h("td",{key:c},p[c]||"\u2014")))));
  }

  return h("div",{className:"dv"},
    catModal?h(CategoryModal,{cat:catModal.cat,k:catModal.k,onClose:()=>setCatModal(null),g,wpStats:exc.wp,enrichedPlays:sumData?.enrichedPlays||[],sumData,wpSeries:d.wp?.series||[]}):null,
    h("button",{className:"bb",onClick:onBack},"\u2190 Back to results"),
    h("div",{className:"hero an"},
      h("div",{className:"hero-ctx"},g.season?.type===3?"Playoff Game":`Week ${g.week?.number||"?"} \u00b7 ${g.season?.year||""} Season`),
      h("div",{className:"hero-tm"},h("span",null,tn(g.at)),g.ar?h("span",{style:{fontSize:".5em",color:"var(--text-3)",marginLeft:".4em"}},`(${g.ar})`):null),
      h("div",{style:{fontFamily:"Oswald",fontSize:"clamp(.9rem,2vw,1.2rem)",color:"var(--text-4)",letterSpacing:".1em",margin:".15rem 0"}},"at"),
      h("div",{className:"hero-tm"},h("span",null,tn(g.ht)),g.hr?h("span",{style:{fontSize:".5em",color:"var(--text-3)",marginLeft:".4em"}},`(${g.hr})`):null),
      h("div",{className:"hero-fs"},g.as,h("span",{className:"dash"},"\u2013"),g.hs),
      h("div",{className:"hero-m"},date),
      g.ven?h("div",{className:"hero-m",style:{marginTop:".15rem"}},g.ven):null,
      g.att?h("div",{className:"hero-m",style:{marginTop:".15rem"}},`Attendance: ${g.att.toLocaleString()}`):null,
      h("div",{className:"hero-e"},
        h("div",{className:"hero-el"},"Excitement Index"),
        h("div",{className:`hero-en ${cc(og.c)}`},exc.total),
        h("div",null,h("span",{className:`hero-eg ${cc(og.c)}`,style:{borderColor:`var(--g${og.c})`}},`${og.g} \u2014 ${og.l}`)),
        h("div",{className:"hero-eb"},h("div",{className:`hero-ebf ${bc(og.c)}`,style:{width:`${Math.min(exc.total,100)}%`}})))),
    box.length>0?h("div",{className:"sec an a1"},h("div",{className:"sec-h"},"Box Score"),
      h("table",{className:"bt"},h("thead",null,h("tr",null,h("th",null,""),
        ...(box[0]?.qs||[]).map((_,i)=>h("th",{key:i},i>=4?`OT${i>4?i-3:""}`:`Q${i+1}`)),h("th",null,"Final"))),
        h("tbody",null,box.map((r,i)=>h("tr",{key:i,className:r.win?"win":""},h("td",null,r.team),...r.qs.map((q,qi)=>h("td",{key:qi},q==null?"\u2014":q)),h("td",{className:"fc"},r.total==null?"\u2014":r.total)))))):null,
    stats.length>0?h("div",{className:"sec an a2"},h("div",{className:"sec-h"},"Team Statistics"),
      h("table",{className:"st"},h("thead",null,h("tr",null,h("th",{style:{textAlign:"right",width:"35%"}},box[0]?.team||"Away"),h("th",{style:{textAlign:"center",width:"30%"}},""),h("th",{style:{textAlign:"left",width:"35%"}},box[1]?.team||"Home"))),
        h("tbody",null,stats.map((s,i)=>h("tr",{key:i},h("td",{style:{textAlign:"right"}},s.away),h("td",{className:"sn"},s.label),h("td",{style:{textAlign:"left"}},s.home)))))):null,
    pStats&&(pStats.passing.length>0||pStats.rushing.length>0||pStats.receiving.length>0)?
      h("div",{className:"sec an a3"},h("div",{className:"sec-h"},"Player Statistics"),h("table",{className:"pst"},h("tbody",null,
        pTable("Passing",pStats.passing,passCols),pTable("Rushing",pStats.rushing,rushCols),pTable("Receiving",pStats.receiving,recCols)))):null,
    h("div",{className:"sec an a4"},h("div",{className:"sec-h"},"Excitement Breakdown"),
      h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".6rem",color:"var(--text-4)",marginBottom:".4rem",marginTop:"-.4rem"}},"Tap any category for game-specific details"),
      h("div",{className:"gg"},Object.entries(exc.scores).map(([k,v])=>{const gr=gradeFor(v.score,v.max);const pct=v.score/v.max*100;
        return h("div",{key:k,className:"gc",onClick:()=>setCatModal({k,cat:v}),style:{cursor:"pointer"}},
          h("div",{className:"gi"},h("h3",null,v.name),h("div",{className:"ds"},v.desc),h("div",{className:"dt"},v.detail),h("div",{className:"br"},h("div",{className:`bf ${bc(gr.c)}`,style:{width:`${pct}%`}}))),
          h("div",{className:`gbg ${cc(gr.c)}`},h("div",null,gr.g),h("div",{className:"pt"},`${v.score}/${v.max}`)))}))),
    WPChart({series:wp?.series||[],mode:wpMode,onModeChange:setWpMode,exc,topLev:(sumData?.enrichedPlays||sumData?.topLeveragePlays||[]),homeTeam:g.ht,awayTeam:g.at}),
    h("div",{className:"sec an a5"},h("div",{className:"sec-h"},"Game Recap"),
      h("div",{className:"wb"},sumLoading?h("p",{style:{fontStyle:"italic",color:"var(--text-3)"}},"Generating game recap..."):
        summary?summary.map((p,i)=>h("p",{key:i},p)):h("p",{style:{color:"var(--text-3)"}},"Recap unavailable."))),
    kp.length>0?h("div",{className:"sec an a6"},h("div",{className:"sec-h"},"Key Plays"),
      kp.map((p,i)=>{const tl=p.tag?.toLowerCase();const[lbl,cls]=tags[tl]||[p.tag||"",""];
        const playText=_humanizePlay(p.text)||p.text;
        const scoreText=p.homeScore!=null&&p.awayScore!=null?` (${tn(g.ht)} ${p.homeScore}, ${tn(g.at)} ${p.awayScore})`:"";
        return h("div",{key:i,className:"pi"},h("div",{className:"pt2"},`${p.period>=5?"OT":`Q${p.period}`} ${p.clock}`),
          h("div",{className:"ptx"},h("span",{className:`ptg ${cls}`},lbl),playText,h("span",{style:{color:"var(--text-3)",fontSize:".8em"}},scoreText)))})):null,
    h("div",{className:"sec an a7"},
      h("button",{className:"mt",onClick:()=>sMeth(!meth)},meth?"\u25be":"\u25b8"," Scoring Methodology"),
      meth?h("div",{className:"mb"},
        h("h4",null,"How It Works"),"The Excitement Index is built on win probability (WP). We estimate home-team WP for every play using score differential, time remaining, and possession, then measure how much that line moves throughout the game. Games with volatile, uncertain, late-swinging WP curves score highest.",
        h("h4",null,"Leverage (0\u201335)"),"Total absolute WP movement (\u03a3|\u0394WP|) across all plays, weighted toward the single largest swing. A typical NFL game totals ~1.5; classics push above 2.5.",
        h("h4",null,"Swings (0\u201315)"),"How often WP crossed the 50% midline (true lead changes) and the 40/60% bands (meaningful advantage shifts).",
        h("h4",null,"Clutch Time (0\u201315)"),"WP movement in the final 8 min of Q4 and all OT. Late swings carry more emotional weight.",
        h("h4",null,"In Doubt (0\u201310)"),"Percentage of the game where WP was between 20% and 80%. Longer uncertainty = more competitive feel.",
        h("h4",null,"Chaos (0\u201310)"),"Play-to-play WP volatility, capturing turnovers, special teams, and big plays without fragile text parsing.",
        h("h4",null,"Context: Stakes (0\u201310)"),"Playoffs score highest (Super Bowl = 10). Regular season weighted by week + both teams' records.",
        h("h4",null,"Context: Rivalry (0\u201310)"),"Historical rivalry intensity + division familiarity. Context categories capped at 16 combined to prevent them from inflating a boring game."
      ):null));
}

createRoot(document.getElementById("app")).render(h(App));
