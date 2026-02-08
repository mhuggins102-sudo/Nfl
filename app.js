import{createElement as h,useState,useCallback,useEffect,useRef,Fragment}from"https://esm.sh/react@18.2.0";
import{createRoot}from"https://esm.sh/react-dom@18.2.0/client";
import{TEAMS,tn,TK,espnSB,espnSum,parseEv,computeExc,oGrade,gradeFor,extractKP,buildBox,buildStats,buildPlayerStats,buildSummaryData,getAllPlays,getWPSeries}from"./engine.js";

const cc=c=>({s:"cs",a:"ca",b:"cb",c:"cc",d:"cd",f:"cf"}[c]||"");
const bc=c=>({s:"bs",a:"ba",b:"bbl",c:"bc",d:"bd",f:"bf2"}[c]||"");
const normTeam=(x)=>x==="LAR"?"LA":x;
const _ns=s=>(s||"").toString().replace(/\s+/g," ").trim();

// ── Recap Helper ──
function _cleanPlay(s){
  s=_ns(s);if(!s)return"";
  const cuts=["extra point","TWO-POINT","two-point","Penalty","PENALTY","(kick failed)","(pass failed)"];
  for(const m of cuts){const i=s.toLowerCase().indexOf(m.toLowerCase());if(i>0){s=s.slice(0,i).trim();break;}}
  s=s.replace(/\(.*?shotgun.*?\)/ig,"").replace(/\(.*?no huddle.*?\)/ig,"").replace(/\s+/g," ").trim().replace(/\.+$/,"");
  if(s.length>160)s=s.slice(0,160).replace(/\s\S*$/,"")+"...";
  return s;
}
function _pick(arr,seed){if(!arr.length)return"";return arr[Math.abs(seed)%arr.length];}
function _qLabel(p){return p<=4?`Q${p}`:"OT";}

function buildRecap(sum){
  if(!sum)return null;
  const W=sum.winnerName||"", L=sum.loserName||"";
  const wAb=sum.winnerAbbr||"", lAb=sum.loserAbbr||"";
  const hN=sum.homeName, aN=sum.awayName;
  const hs=sum.homeScore, as=sum.awayScore;
  const winScore=Math.max(hs,as), loseScore=Math.min(hs,as);
  const margin=sum.finalMargin||0;
  const deficit=sum.maxWinnerDeficit||0;
  const arche=sum.archetype?.type||"tight";
  const hasOT=sum.hasOT;
  const enriched=(sum.enrichedPlays||[]).map(p=>({...p,text:_cleanPlay(p.text)})).filter(p=>p.text);
  const leaders=sum.leaders||[];
  const qNarr=sum.quarterNarrative||[];
  const wp=sum.wpStats||{};
  const notable=sum.notablePlays||[];
  const scoring=sum.scoringPlays||[];
  const pRound=sum.playoffRound||"";
  const seed=(sum.excitementScore||0)*13+(wp.crosses50||0)*7;
  const paragraphs=[];

  // ── LEDE: Set the scene ──
  let opener="";
  // Context prefix for playoff/rivalry
  let ctxPrefix="";
  if(pRound) ctxPrefix=`In a ${pRound} matchup, `;
  else if(sum.rivalryNote&&sum.stakesNote) ctxPrefix="";

  if(arche==="comeback"&&deficit>=10){
    opener=`${ctxPrefix}${W} trailed by ${deficit} and looked finished. They won anyway, ${winScore}-${loseScore}${hasOT?" in overtime":""} — the kind of result that doesn't make sense until you watch the fourth quarter unfold.`;
  } else if(arche==="comeback"){
    opener=`${ctxPrefix}${W} spent most of this one chasing. By the end, ${L} was the team scrambling, and ${W} walked away with a ${winScore}-${loseScore} win${hasOT?" that needed overtime to settle":""}.`;
  } else if(arche==="collapse"){
    opener=`${ctxPrefix}${L} had this one. They had it in a way that makes what happened next genuinely hard to explain — ${W} came from behind to win ${winScore}-${loseScore}${hasOT?" in overtime":""}.`;
  } else if(arche==="seesaw"){
    opener=`${ctxPrefix}Neither team could hold on to anything in this one. ${W} and ${L} traded the lead ${wp.crosses50>3?wp.crosses50+" times":"all afternoon"} before ${W} finally made the last stand, ${winScore}-${loseScore}${hasOT?" in overtime":""}.`;
  } else if(arche==="wire"){
    opener=`${ctxPrefix}${W} took control early and never seriously let ${L} back in, winning ${winScore}-${loseScore} in a game that was largely decided by halftime.`;
  } else if(hasOT){
    opener=`${ctxPrefix}Neither team could close it out in regulation. ${W} finally won it ${winScore}-${loseScore} in overtime, ending a game that had been tight from the opening drive.`;
  } else if(margin<=3){
    opener=`${ctxPrefix}${W} survived ${L}, ${winScore}-${loseScore}, in the kind of one-score game where a single play either way changes everything.`;
  } else {
    opener=`${ctxPrefix}${W} beat ${L}, ${winScore}-${loseScore}${margin<=7?", in a game that was tighter than the final score suggests":""}. `;
  }
  paragraphs.push(opener);

  // ── FLOW: How the game developed, with halftime score ──
  let flow="";
  if(qNarr.length>=2){
    const qH=qNarr.find(q=>q.q===2)||qNarr[1];
    const halftimeLead=qH?qH.endHS-qH.endAS:0;
    const hLeader=halftimeLead>0?hN:halftimeLead<0?aN:null;
    const hHigh=qH?Math.max(qH.endHS,qH.endAS):0;
    const hLow=qH?Math.min(qH.endHS,qH.endAS):0;

    // Find a notable early play for color
    const earlyNotable=notable.find(p=>p.period<=2&&(p.type==="INT"||p.type==="FUM"||p.type==="BIG"));
    const earlyColor=earlyNotable?` ${earlyNotable.type==="INT"?"An interception":earlyNotable.type==="FUM"?"A fumble":"A "+earlyNotable.yds+"-yard play"} in the ${_qLabel(earlyNotable.period)} helped set the tone early.`:"";

    if(hLeader&&Math.abs(halftimeLead)>=10){
      flow=`${hLeader} dominated the first half, taking a ${hHigh}-${hLow} lead into the break.${earlyColor}`;
      if(hLeader===W&&arche==="wire") flow+=` ${L} never mounted a serious threat after that.`;
      else if(hLeader!==W) flow+=` But the second half was a different story.`;
    } else if(hLeader){
      flow=`It was ${hHigh}-${hLow} at the half, with ${hLeader} holding a slim lead.${earlyColor} The game's real identity showed up in the second half.`;
    } else {
      flow=`It was knotted at ${qH?qH.endHS:0} at the break.${earlyColor} Everything after that was a fight to the finish.`;
    }
  }
  if(flow) paragraphs.push(flow);

  // ── TURNING POINTS: Specific plays with detail ──
  if(enriched.length>=1){
    const top=enriched.slice(0,3);
    let turns="";
    top.forEach((tp,i)=>{
      const per=tp.perLabel, clock=tp.clock, txt=tp.text;
      const score=`${tp.homeScore}-${tp.awayScore}`;
      if(i===0){
        turns+=`The game's biggest moment came with ${clock} left in the ${per==="OT"?"overtime":per}`;
        turns+=score?`, the score ${hN} ${tp.homeScore}, ${aN} ${tp.awayScore}`:` `;
        turns+=`: ${txt}. That play swung win probability ${tp.swingPct} percentage points in ${tp.beneficiary}'s favor.`;
      } else {
        const connector=i===1?" Before that, ":" ";
        turns+=`${connector}${_cleanPlay(tp.text)} (${per}, ${clock}) was another ${tp.swingPct>15?"massive":"key"} swing toward ${tp.beneficiary}.`;
      }
    });

    // Weave in a notable turnover or 4th down if not already covered
    const turnover=notable.find(p=>(p.type==="INT"||p.type==="FUM")&&p.period>=3&&!top.some(t=>t.text.includes(p.text.slice(0,30))));
    if(turnover){
      const tPer=_qLabel(turnover.period);
      turns+=` A ${turnover.type==="INT"?"crucial interception":"key fumble"} in the ${tPer} added another twist.`;
    }
    const fourthDown=notable.find(p=>p.type==="4TH"&&p.period>=3);
    if(fourthDown&&!turnover){
      turns+=` A fourth-down conversion in the ${_qLabel(fourthDown.period)} kept a critical drive alive.`;
    }
    paragraphs.push(turns);
  }

  // ── PERFORMERS: Natural, not a stat dump ──
  const winLeaders=[...leaders].filter(l=>l.team===wAb).sort((a,b)=>(b.yds+b.td*50)-(a.yds+a.td*50));
  const loseLeaders=[...leaders].filter(l=>l.team===lAb).sort((a,b)=>(b.yds+b.td*50)-(a.yds+a.td*50));
  let stars="";
  const bw=winLeaders[0], bw2=winLeaders[1];
  const bl=loseLeaders[0];

  if(bw){
    if(bw.type==="passing") stars+=`${bw.name} was efficient for ${W}, going ${bw.line}.`;
    else if(bw.type==="rushing") stars+=`${bw.name} carried the load for ${W} with ${bw.line}.`;
    else stars+=`${bw.name} was a problem for ${L}'s defense, finishing with ${bw.line}.`;
    if(bw2&&bw2.td>=1) stars+=` ${bw2.name} chipped in with ${bw2.line}.`;
  }
  if(bl){
    if(bl.td>=2||bl.yds>=150) stars+=` ${bl.name} had a big day for ${L} (${bl.line}) but it wasn't enough.`;
    else if(bl.type==="passing"&&bl.line.includes("INT")) stars+=` ${bl.name} had moments for ${L} (${bl.line}), though the turnovers hurt.`;
    else stars+=` ${bl.name} led ${L} with ${bl.line}.`;
  }
  if(stars) paragraphs.push(stars);

  // ── CLOSER: Context + verdict ──
  let closer="";
  if(pRound){
    closer+=`As a ${pRound} game, the stakes amplified every play. `;
  } else {
    if(sum.stakesNote) closer+=sum.stakesNote+" ";
    if(sum.rivalryNote) closer+=sum.rivalryNote+" ";
  }
  const doubtPct=wp.doubtFrac!=null?Math.round(wp.doubtFrac*100):null;
  if(doubtPct!=null&&doubtPct>45){
    closer+=`The outcome was genuinely uncertain for ${doubtPct}% of the game. `;
  }
  closer+=`Excitement Index: ${sum.excitementScore} (${sum.excitementVerdict}).`;
  paragraphs.push(closer);

  return paragraphs.filter(p=>p&&p.trim()).slice(0,5);
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
        detail:_cleanPlay(tp.text)||"High leverage play",
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
          detail:_cleanPlay(s.text)||"Win probability crossed 50%",
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
          detail:_cleanPlay(s.text)||lbl,
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


// ── Category Detail Modal — casual tone, game-specific ──
function CategoryModal({cat,k,onClose,g,wpStats,enrichedPlays}){
  const homeN=tn(g.ht),awayN=tn(g.at);
  const gr=gradeFor(cat.score,cat.max);
  const topPlay=(enrichedPlays||[]).sort((a,b)=>(b.absDelta||0)-(a.absDelta||0))[0];
  const topPlayDesc=topPlay?_cleanPlay(topPlay.text):"";
  const topPlayPer=topPlay?`${topPlay.period<=4?"Q"+topPlay.period:"OT"} ${topPlay.clock}`:"";
  let explanation="";

  if(k==="leverage"){
    const sumAbs=wpStats?.sumAbsDelta;
    const maxAbs=wpStats?.maxAbsDelta;
    if(sumAbs!=null){
      const ratio=(sumAbs/1.5).toFixed(1);
      if(sumAbs>=2.2) explanation=`This game had about ${ratio}x the total WP movement of a typical NFL game. The single largest swing was ${(maxAbs*100).toFixed(0)}%`;
      else if(sumAbs>=1.2) explanation=`Total WP movement was right around average for an NFL game. The biggest single swing was ${(maxAbs*100).toFixed(0)}%`;
      else explanation=`This was a quieter game than most — about ${ratio}x the WP movement of a typical matchup. The biggest swing was only ${(maxAbs*100).toFixed(0)}%`;
      if(topPlayDesc) explanation+=`, when ${topPlayDesc} (${topPlayPer}).`;
      else explanation+=`.`;
    }
  } else if(k==="swings"){
    const c50=wpStats?.crosses50||0;
    if(c50>=4) explanation=`The lead changed hands ${c50} times — that's a lot of back-and-forth. Neither team could get comfortable, and you could feel it flipping every few drives.`;
    else if(c50>=2) explanation=`The lead changed ${c50} times, enough to keep things interesting without being pure chaos. There were runs of control, but they never lasted long.`;
    else explanation=`Only ${c50} lead change${c50!==1?"s":""}. One team ran the show for most of the game, which made it feel more one-directional than competitive.`;
  } else if(k==="clutch"){
    const lateSum=wpStats?.lateSumAbsDelta;
    const latePeak=wpStats?.lateMaxAbsDelta;
    if(lateSum!=null&&lateSum>=0.5){
      explanation=`The final 8 minutes were electric — almost everything was still in play. Late WP movement was ${lateSum.toFixed(2)}, with a peak swing of ${(latePeak*100).toFixed(0)}%`;
      const latePlays=(enrichedPlays||[]).filter(p=>(p.period===4&&p.remSec<=480)||p.period>4).sort((a,b)=>(b.absDelta||0)-(a.absDelta||0));
      if(latePlays[0]&&_cleanPlay(latePlays[0].text)) explanation+=` on ${_cleanPlay(latePlays[0].text)}.`;
      else explanation+=`.`;
    } else if(lateSum!=null){
      explanation=`The endgame was relatively calm — only ${lateSum.toFixed(2)} total WP movement in the final 8 minutes. The outcome was mostly decided before crunch time.`;
    }
  } else if(k==="control"){
    const frac=wpStats?.doubtFrac;
    if(frac!=null&&frac>=0.65) explanation=`Win probability stayed in the uncertain zone (20-80%) for ${Math.round(frac*100)}% of the game. Neither side could feel safe at almost any point — that constant tension is what makes a game feel competitive throughout.`;
    else if(frac!=null&&frac>=0.4) explanation=`About ${Math.round(frac*100)}% of the game was genuinely in doubt. There were stretches where one team pulled ahead, but it kept coming back to competitive territory.`;
    else explanation=`Only ${Math.round((frac||0)*100)}% of the game was truly in doubt. One team was in command for most of it, which limits the drama even if there were a few exciting plays.`;
  } else if(k==="chaos"){
    const vol=wpStats?.volatility;
    if(vol!=null&&vol>=0.06) explanation=`High play-to-play volatility — turnovers, special teams, and big plays kept disrupting any sense of rhythm. This is the kind of game where you couldn't look away because anything could happen on the next snap.`;
    else if(vol!=null&&vol>=0.04) explanation=`Some chaotic moments popped up, but the game also had stretches of controlled, methodical football. A mix of order and disorder.`;
    else explanation=`A pretty orderly game. Not many sudden momentum shifts from turnovers or special teams — more of a grinding, possession-by-possession affair.`;
  } else if(k==="contextR"){
    if(cat.score>=7) explanation=`This is one of the NFL's premier rivalries — the kind where history and genuine dislike elevate routine plays into emotional moments. That edge adds something that doesn't show up in the stat sheet.`;
    else if(cat.score>=4) explanation=`These teams know each other well enough for the matchup to carry extra weight, even if it's not a top-tier rivalry. Division familiarity tends to make things chippy.`;
    else explanation=`Not a major rivalry. The drama here had to come from the game itself rather than any external history between these teams.`;
  } else if(k==="contextS"){
    if(cat.score>=8) explanation=`Huge stakes. In games with this much on the line, every mistake is magnified and every big play carries outsized emotional weight. The pressure itself becomes part of the spectacle.`;
    else if(cat.score>=5) explanation=`This game had real standings implications — the kind of game where both fan bases were scoreboard-watching. That extra layer of meaning lifts the intensity.`;
    else explanation=`Not a lot of external pressure on this one. The drama had to be earned purely on the field.`;
  }

  return h("div",{style:{position:"fixed",inset:0,background:"rgba(7,9,13,.85)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"},onClick:onClose},
    h("div",{style:{background:"var(--bg-2)",border:"1px solid var(--border-2)",padding:"1.5rem",maxWidth:"480px",width:"100%",maxHeight:"80vh",overflowY:"auto"},onClick:e=>e.stopPropagation()},
      h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".75rem"}},
        h("div",{style:{fontFamily:"Oswald",fontSize:"1.1rem",fontWeight:600,letterSpacing:".04em",color:"var(--text-1)"}},cat.name),
        h("div",{className:`${cc(gr.c)}`,style:{fontFamily:"Oswald",fontSize:"1.5rem",fontWeight:700}},`${cat.score}/${cat.max}`)
      ),
      h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".7rem",color:"var(--gold-dim)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:".5rem"}},`Grade: ${gr.g} — ${gr.l}`),
      h("div",{style:{fontSize:".88rem",color:"var(--text-2)",lineHeight:1.75,marginBottom:".75rem"}},explanation),
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
  const tags={td:["TD","t-td"],to:["TURNOVER","t-to"],bg:["BIG PLAY","t-bg"],cl:["CLUTCH","t-cl"],sp:["SPECIAL","t-sp"]};
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
    catModal?h(CategoryModal,{cat:catModal.cat,k:catModal.k,onClose:()=>setCatModal(null),g,wpStats:exc.wp,enrichedPlays:sumData?.enrichedPlays||[]}):null,
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
      kp.map((p,i)=>{const[lbl,cls]=tags[p.tag]||["",""];
        return h("div",{key:i,className:"pi"},h("div",{className:"pt2"},`${p.period>=5?"OT":`Q${p.period}`} ${p.clock}`),
          h("div",{className:"ptx"},h("span",{className:`ptg ${cls}`},lbl),p.text))})):null,
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
