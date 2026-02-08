import{createElement as h,useState,useCallback,useEffect,useRef,Fragment}from"https://esm.sh/react@18.2.0";
import{createRoot}from"https://esm.sh/react-dom@18.2.0/client";
import{TEAMS,tn,TK,espnSB,espnSum,parseEv,computeExc,oGrade,gradeFor,extractKP,buildBox,buildStats,buildPlayerStats,buildSummaryData,getAllPlays,getWPSeries}from"./engine.js";

const cc=c=>({s:"cs",a:"ca",b:"cb",c:"cc",d:"cd",f:"cf"}[c]||"");
const bc=c=>({s:"bs",a:"ba",b:"bbl",c:"bc",d:"bd",f:"bf2"}[c]||"");
const normTeam=(x)=>x==="LAR"?"LA":x;
const _ns=s=>(s||"").toString().replace(/\s+/g," ").trim();

// ── Recap Generator — The Athletic style ──

function _cleanPlay(s){
  s=_ns(s);if(!s) return "";
  const cutMarkers=["extra point","TWO-POINT CONVERSION","TWO POINT CONVERSION","two-point conversion","Penalty","PENALTY"];
  for(const m of cutMarkers){const i=s.toLowerCase().indexOf(m.toLowerCase());if(i>0){s=s.slice(0,i).trim();break;}}
  s=s.replace(/\(.*?shotgun.*?\)/ig,"").replace(/\s+/g," ").trim();
  s=s.replace(/\.+$/,"").trim();
  // Shorten very long play descriptions
  if(s.length>180) s=s.slice(0,180).replace(/\s\S*$/,"")+"...";
  return s;
}
function _pick(arr,seed){if(!arr.length)return"";return arr[Math.abs(seed)%arr.length];}

function buildRecap(sum){
  if(!sum) return null;
  const W=sum.winnerName||"Winner", L=sum.loserName||"Loser";
  const wAb=sum.winnerAbbr||"", lAb=sum.loserAbbr||"";
  const hN=sum.homeName, aN=sum.awayName;
  const hs=sum.homeScore, as=sum.awayScore;
  const margin=sum.finalMargin||0;
  const deficit=sum.maxWinnerDeficit||0;
  const arche=sum.archetype?.type||"tight";
  const hasOT=sum.hasOT;
  const enriched=(sum.enrichedPlays||[]).map(p=>({...p,text:_cleanPlay(p.text)})).filter(p=>p.text);
  const leaders=sum.leaders||[];
  const qNarr=sum.quarterNarrative||[];
  const wp=sum.wpStats||{};
  const seed=(sum.excitementScore||0)*13+(wp.crosses50||0)*7;

  const paragraphs=[];

  // ── PARAGRAPH 1: The Lede ──
  // Set the scene: who won, how it felt, what kind of game it was.
  let lede="";
  if(arche==="comeback" && deficit>=10){
    lede=_pick([
      `${W} trailed by ${deficit} and looked finished. They won anyway, ${as>hs?as:hs}-${as>hs?hs:as}${hasOT?" in overtime":""},  the kind of result that doesn't make sense until you watch the fourth quarter unfold.`,
      `Down ${deficit}, ${W} had every reason to fold. Instead they ripped off enough points to steal it from ${L}, ${as>hs?as:hs}-${as>hs?hs:as}${hasOT?" in overtime":""}, in a game that turned on its head in the final quarter.`,
    ],seed);
  } else if(arche==="comeback"){
    lede=_pick([
      `${W} dug out of an early hole and outlasted ${L}, ${as>hs?as:hs}-${as>hs?hs:as}${hasOT?" in overtime":""}, in a game that required patience and a short memory.`,
      `${W} spent the first half chasing. By the end, ${L} was the one scrambling, and ${W} walked away with a ${as>hs?as:hs}-${as>hs?hs:as} win${hasOT?" that needed overtime to settle":""}. `,
    ],seed);
  } else if(arche==="collapse"){
    lede=_pick([
      `${L} had this one. They had it in a way that makes what happened next hard to explain — ${W} came from behind to win ${as>hs?as:hs}-${as>hs?hs:as}${hasOT?" in overtime":""}, turning a comfortable lead into a collapse.`,
      `It looked like ${L}'s game for most of the afternoon. Then ${W} made it not that, pulling away late for a ${as>hs?as:hs}-${as>hs?hs:as} win${hasOT?" in overtime":""} that ${L} will have trouble explaining.`,
    ],seed);
  } else if(arche==="seesaw"){
    lede=_pick([
      `Neither team could hold on to anything in this one. ${W} and ${L} traded leads ${wp.crosses50>3?wp.crosses50+" times":"all afternoon"} before ${W} finally made the last stand, winning ${as>hs?as:hs}-${as>hs?hs:as}${hasOT?" in overtime":""}.`,
      `This was a game that refused to settle. Every time one team grabbed the lead, the other answered, and ${W} happened to be the one holding it when the clock hit zero — ${as>hs?as:hs}-${as>hs?hs:as}${hasOT?" after overtime":""}.`,
    ],seed);
  } else if(arche==="wire"){
    lede=_pick([
      `${W} took control early and never seriously let ${L} back in, cruising to a ${as>hs?as:hs}-${as>hs?hs:as} win that was about as comfortable as the score suggests.`,
      `${W} played from ahead almost the entire way and ${L} never found an answer, falling ${as>hs?as:hs}-${as>hs?hs:as} in a game that was decided long before the final whistle.`,
    ],seed);
  } else if(margin<=3 && !hasOT){
    lede=_pick([
      `${W} won by ${margin}, ${as>hs?as:hs}-${as>hs?hs:as}, in the kind of one-score game where a single play either way changes the outcome. This one came down to the margins.`,
      `${W} survived ${L}, ${as>hs?as:hs}-${as>hs?hs:as}, in a game decided by ${margin} point${margin===1?"":"s"} and probably a handful of moments that could have gone differently.`,
    ],seed);
  } else if(hasOT){
    lede=`Neither team could close it out in regulation, and it took overtime to separate ${W} from ${L}. ${W} won it ${as>hs?as:hs}-${as>hs?hs:as}, ending a game that was tight from start to finish.`;
  } else {
    lede=_pick([
      `${W} beat ${L} ${as>hs?as:hs}-${as>hs?hs:as}${margin<=7?" in a game that stayed competitive into the fourth quarter":""}.`,
      `${W} topped ${L} ${as>hs?as:hs}-${as>hs?hs:as}${margin<=7?", a game that was closer than the final score might suggest":""}.`,
    ],seed);
  }
  paragraphs.push(lede);

  // ── PARAGRAPH 2: The Flow — Quarter-by-quarter shape of the game ──
  let flow="";
  if(qNarr.length>=3){
    const q1=qNarr[0], q2=qNarr.find(q=>q.q===2), qH=qNarr.find(q=>q.q===2)||qNarr[1];
    const halftimeLead = qH ? qH.endHS - qH.endAS : 0;
    const halftimeLeader = halftimeLead>0 ? hN : halftimeLead<0 ? aN : null;
    const halftimeScore = qH ? `${Math.max(qH.endHS,qH.endAS)}-${Math.min(qH.endHS,qH.endAS)}` : "";

    if(halftimeLeader && Math.abs(halftimeLead)>=7){
      flow=`${halftimeLeader} took a ${halftimeScore} lead into halftime`;
      if(halftimeLeader===W){
        flow+=arche==="wire"?` and never looked back.`:`, but ${L} made it interesting in the second half before ${W} held on.`;
      } else {
        flow+=`, but ${W} erased that deficit in the second half${hasOT?" and eventually won in overtime":""}.`;
      }
    } else if(halftimeLeader){
      flow=`It was ${halftimeScore} at the half, with ${halftimeLeader} clinging to a slim lead. `;
      flow+=`The second half is where this game opened up.`;
    } else {
      flow=`It was knotted at ${qH?qH.endHS:0} at the break. `;
      flow+=`The game's identity didn't really reveal itself until the second half.`;
    }
  }
  if(flow) paragraphs.push(flow);

  // ── PARAGRAPH 3: Turning Points — specific plays that swung it ──
  if(enriched.length>=2){
    const top3=enriched.slice(0,3);
    let turns="";
    top3.forEach((tp,i)=>{
      const per=tp.perLabel;
      const clock=tp.clock;
      const txt=tp.text;
      const pctSwing=tp.swingPct;
      if(i===0){
        turns+=`The biggest swing came with ${clock} left in the ${per==="OT"?"overtime period":per}: ${txt}. That single play shifted win probability by ${pctSwing} percentage points`;
        turns+=tp.beneficiary?` in ${tp.beneficiary}'s favor.`:`.`;
      } else if(i===1){
        turns+=` Earlier, ${tp.beneficiary||"one side"} got a boost on ${txt.length>80?txt.slice(0,80)+"...":txt} (${per}, ${clock}).`;
      } else {
        turns+=` And ${txt.length>80?txt.slice(0,80)+"...":txt} in the ${per} added another layer.`;
      }
    });
    paragraphs.push(turns);
  }

  // ── PARAGRAPH 4: Star Performers ──
  const winLeaders=leaders.filter(l=>l.team===wAb);
  const loseLeaders=leaders.filter(l=>l.team===lAb);
  let stars="";
  const bestWin=winLeaders.sort((a,b)=>(b.yds+b.td*40)-(a.yds+a.td*40))[0];
  const bestLose=loseLeaders.sort((a,b)=>(b.yds+b.td*40)-(a.yds+a.td*40))[0];
  if(bestWin){
    stars+=`${bestWin.name} led the way for ${W}, finishing with ${bestWin.line}.`;
  }
  if(bestLose){
    stars+=` ${bestLose.name} did what he could for ${L}${bestLose.type==="passing"?` (${bestLose.line})`:`, putting up ${bestLose.line}`}.`;
  }
  if(stars) paragraphs.push(stars);

  // ── PARAGRAPH 5: Context + Excitement verdict ──
  let closer="";
  if(sum.rivalryNote) closer+=sum.rivalryNote+" ";
  if(sum.stakesNote) closer+=sum.stakesNote+" ";
  const doubtPct=wp.doubtFrac!=null?Math.round(wp.doubtFrac*100):null;
  if(doubtPct!=null && doubtPct>40){
    closer+=`The outcome was genuinely in doubt for ${doubtPct}% of the game`;
    if(wp.crosses50>2) closer+=`, crossing the 50/50 line ${wp.crosses50} times`;
    closer+=`. `;
  }
  closer+=`Excitement Index: ${sum.excitementScore} (${sum.excitementVerdict}).`;
  paragraphs.push(closer);

  return paragraphs.filter(p=>p&&p.trim()).slice(0,5);
}


// ── WP Chart with OT support and interactive tooltips ──

function WPChart({series, mode, onModeChange, exc, topLev, homeTeam, awayTeam}){
  const [tooltip,setTooltip]=useState(null);

  if(!series || series.length<2){
    return h("div",{style:{color:"var(--text-3)",fontFamily:"JetBrains Mono",fontSize:".75rem"}}, "Win probability data unavailable.");
  }

  // Determine max game time (support OT)
  const maxTMin=Math.max(...series.filter(s=>s.tMin!=null).map(s=>s.tMin));
  const gameMaxMin=maxTMin>60?Math.ceil(maxTMin/5)*5:60;

  const W=860, H=180, pad=24;
  const toX=(t)=>pad+(t/gameMaxMin)*(W-2*pad);
  const toY=(wp)=>pad+(1-wp)*(H-2*pad);

  const step=Math.max(1,Math.floor(series.length/450));
  const pts=[];
  for(let i=0;i<series.length;i+=step){
    const s=series[i];
    if(s&&s.tMin!=null&&s.wp!=null) pts.push([toX(s.tMin),toY(s.wp)]);
  }
  const path="M "+pts.map(p=>p[0].toFixed(2)+" "+p[1].toFixed(2)).join(" L ");

  // Generate axis labels
  const axisLabels=[];
  for(let m=0;m<=gameMaxMin;m+=15){
    axisLabels.push(m===0?"0:00":`${m}:00`);
  }

  // Build overlays with tooltip data
  const overlays=[];
  const hitAreas=[];

  function addDot(cx,cy,r,fill,data){
    overlays.push(h("circle",{key:`dot-${overlays.length}`,cx,cy,r,fill,style:{cursor:"pointer"}}));
    hitAreas.push({cx,cy,r:Math.max(r,8),...data});
  }

  if(mode==="Leverage"){
    (topLev||[]).slice(0,6).forEach(tp=>{
      if(tp.tMin==null)return;
      const per=tp.period<=4?`Q${tp.period}`:"OT";
      addDot(toX(tp.tMin),toY(tp.wp||0.5),4,"var(--gold)",{
        label:`${per} ${tp.clock}`,
        detail:_cleanPlay(tp.text)||"High leverage play",
        sub:`WP swing: ${Math.round(Math.abs(tp.delta||tp.absDelta||0)*100)}%`
      });
    });
  }else if(mode==="Swings"){
    for(let i=1;i<series.length;i++){
      const a=series[i-1].wp, b=series[i].wp;
      if(a==null||b==null) continue;
      if((a<0.5&&b>=0.5)||(a>=0.5&&b<0.5)){
        const s=series[i];
        const per=s.period<=4?`Q${s.period}`:"OT";
        addDot(toX(s.tMin),toY(s.wp),3.5,"var(--blue)",{
          label:`${per} ${s.clock} — Lead change`,
          detail:_cleanPlay(s.text)||"Win probability crossed 50%",
          sub:`${tn(homeTeam)} ${s.homeScore}, ${tn(awayTeam)} ${s.awayScore}`
        });
      }
    }
  }else if(mode==="Chaos"){
    for(const s of series){
      if(s.tag==="TO"||s.tag==="SP"){
        const per=s.period<=4?`Q${s.period}`:"OT";
        const label=s.tag==="TO"?"Turnover":"Special teams";
        addDot(toX(s.tMin),toY(s.wp),3.5,"var(--red)",{
          label:`${per} ${s.clock} — ${label}`,
          detail:_cleanPlay(s.text)||label,
          sub:`WP swing: ${Math.round(s.absDelta*100)}%`
        });
      }
    }
  }else if(mode==="Clutch"){
    const clutchX=toX(52);
    overlays.push(h("rect",{key:"clutch-zone",x:clutchX,y:pad,width:toX(gameMaxMin)-clutchX,height:H-2*pad,fill:"rgba(201,162,39,.08)"}));
  }

  function handleSVGClick(e){
    const svg=e.currentTarget;
    const rect=svg.getBoundingClientRect();
    const scaleX=W/rect.width;
    const scaleY=H/rect.height;
    const cx=(e.clientX-rect.left)*scaleX;
    const cy=(e.clientY-rect.top)*scaleY;
    let best=null, bestDist=Infinity;
    for(const ha of hitAreas){
      const dx=cx-ha.cx, dy=cy-ha.cy;
      const dist=Math.sqrt(dx*dx+dy*dy);
      if(dist<ha.r*3 && dist<bestDist){best=ha;bestDist=dist;}
    }
    setTooltip(best);
  }

  const homeName=tn(homeTeam||"Home");

  return h("div",{className:"sec"},
    h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:"1rem",flexWrap:"wrap"}},
      h("div",{className:"sec-h",style:{borderBottom:"none",marginBottom:"0"}},`Win Probability (${homeName})`),
      h("div",{style:{display:"flex",alignItems:"center",gap:".5rem"}},
        h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".65rem",letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-3)"}}, "Overlay"),
        h("select",{value:mode,onChange:e=>{onModeChange(e.target.value);setTooltip(null);},style:{background:"var(--bg-3)",border:"1px solid var(--border-1)",color:"var(--text-1)",padding:".35rem .5rem",fontFamily:"JetBrains Mono",fontSize:".7rem"}},
          ["Leverage","Swings","Chaos","Clutch"].map(o=>h("option",{key:o,value:o},o))))),
    // Overlay legend
    h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".6rem",color:"var(--text-4)",marginTop:".3rem",marginBottom:".2rem"}},
      mode==="Leverage"?"Gold dots = highest win-probability swings. Tap for details.":
      mode==="Swings"?"Blue dots = moments the lead changed (WP crossed 50%). Tap for details.":
      mode==="Chaos"?"Red dots = turnovers and special teams plays. Tap for details.":
      "Gold zone = final 8 minutes of Q4 + overtime, where leverage is highest."),
    h("div",{style:{border:"1px solid var(--border-1)",background:"var(--bg-2)",padding:".6rem .6rem .2rem",position:"relative"}},
      h("svg",{viewBox:`0 0 ${W} ${H}`,width:"100%",height:"auto",preserveAspectRatio:"none",onClick:handleSVGClick,style:{cursor:hitAreas.length?"pointer":"default"}},
        h("line",{x1:toX(0),y1:toY(0.5),x2:toX(gameMaxMin),y2:toY(0.5),stroke:"rgba(136,146,164,.35)",strokeWidth:"1",strokeDasharray:"4 4"}),
        (mode==="Clutch"&&overlays.length)?overlays[0]:null,
        h("path",{d:path,fill:"none",stroke:"rgba(232,236,240,.85)",strokeWidth:"2"}),
        ...(mode==="Clutch"?overlays.slice(1):overlays)
      ),
      h("div",{style:{display:"flex",justifyContent:"space-between",fontFamily:"JetBrains Mono",fontSize:".6rem",color:"var(--text-4)",marginTop:".25rem"}},
        ...axisLabels.map((l,i)=>h("div",{key:i},l))
      ),
      // Tooltip
      tooltip?h("div",{style:{background:"var(--bg-3)",border:"1px solid var(--border-2)",padding:".6rem .8rem",marginTop:".5rem",position:"relative"},onClick:()=>setTooltip(null)},
        h("div",{style:{fontFamily:"Oswald",fontSize:".85rem",color:"var(--text-1)",marginBottom:".2rem"}},tooltip.label),
        h("div",{style:{fontSize:".8rem",color:"var(--text-2)",lineHeight:"1.5"}},tooltip.detail),
        tooltip.sub?h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".7rem",color:"var(--gold)",marginTop:".2rem"}},tooltip.sub):null,
        h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".55rem",color:"var(--text-4)",marginTop:".3rem"}},"Tap to dismiss")
      ):null
    )
  );
}


// ── Excitement Category Detail Modal ──
function CategoryModal({cat,k,onClose,g,wpStats}){
  // Generate game-specific elaboration for each category
  const homeN=tn(g.ht), awayN=tn(g.at);
  const gr=gradeFor(cat.score,cat.max);
  let explanation="";

  if(k==="leverage"){
    const sumAbs=wpStats?.sumAbsDelta;
    const maxAbs=wpStats?.maxAbsDelta;
    if(sumAbs!=null){
      if(sumAbs>=2.5) explanation=`This game had massive total WP movement (${sumAbs.toFixed(2)}), meaning every few plays the outlook was shifting significantly. A typical NFL game sees around 1.5. The single largest swing was ${(maxAbs*100).toFixed(0)}% — a play that dramatically altered who was likely to win.`;
      else if(sumAbs>=1.5) explanation=`Total WP movement was ${sumAbs.toFixed(2)}, right around the NFL average. The game had some meaningful swings but wasn't exceptionally volatile. The biggest single play shifted things by ${(maxAbs*100).toFixed(0)}%.`;
      else explanation=`Total WP movement was only ${sumAbs.toFixed(2)}, well below the NFL average of ~1.5. One team controlled the game without many dramatic shifts. The peak single-play swing was just ${(maxAbs*100).toFixed(0)}%.`;
    }
  } else if(k==="swings"){
    const c50=wpStats?.crosses50||0, c46=wpStats?.crosses4060||0;
    if(c50>=4) explanation=`The lead changed hands ${c50} times, which is a lot of back-and-forth for an NFL game. On top of that, win probability crossed between the 40% and 60% bands ${c46} times, meaning neither team could establish comfortable control.`;
    else if(c50>=2) explanation=`The lead changed ${c50} times. Not a constant seesaw, but enough swings to keep things interesting. The game had ${c46} crossings between the 40-60% WP band.`;
    else explanation=`With only ${c50} lead change${c50!==1?"s":""}, this game didn't flip much. One team controlled the flow for most of the contest.`;
  } else if(k==="clutch"){
    const lateSum=wpStats?.lateSumAbsDelta;
    const latePeak=wpStats?.lateMaxAbsDelta;
    if(lateSum!=null && lateSum>=0.5) explanation=`The final 8 minutes of regulation and overtime were electric. Late-game WP movement totaled ${lateSum.toFixed(2)}, with a single play swinging things by ${(latePeak*100).toFixed(0)}%. This is where the game earned its drama.`;
    else if(lateSum!=null && lateSum>=0.2) explanation=`There was some late tension — WP moved ${lateSum.toFixed(2)} in the final 8 minutes — but it wasn't a full-on clutch thriller. The peak late swing was ${(latePeak*100).toFixed(0)}%.`;
    else explanation=`The final 8 minutes were relatively calm (only ${lateSum?.toFixed(2)||0} total WP movement). The game's outcome was largely decided before crunch time.`;
  } else if(k==="control"){
    const frac=wpStats?.doubtFrac;
    if(frac!=null && frac>=0.7) explanation=`Win probability stayed between 20% and 80% for ${Math.round(frac*100)}% of the game — meaning neither team could ever feel safe. This was a contest that stayed genuinely uncertain almost the entire way.`;
    else if(frac!=null && frac>=0.4) explanation=`The game was "in doubt" (WP between 20-80%) for ${Math.round(frac*100)}% of plays. There were stretches where one team seemed in control, but it kept coming back to competitive territory.`;
    else explanation=`Only ${Math.round((frac||0)*100)}% of the game was truly in doubt. One team was in command for long stretches, making it hard for the trailing team to generate real tension.`;
  } else if(k==="chaos"){
    const vol=wpStats?.volatility;
    if(vol!=null && vol>=0.07) explanation=`High play-to-play volatility (${vol.toFixed(3)}) suggests turnovers, special teams surprises, or big plays were regularly disrupting momentum. These chaotic swings make games unpredictable and exciting.`;
    else if(vol!=null && vol>=0.04) explanation=`Moderate volatility (${vol.toFixed(3)}). Some disruptive plays popped up, but the game also had stretches of methodical football.`;
    else explanation=`Low volatility (${(vol||0).toFixed(3)}). This was a more controlled, possession-by-possession game without many sudden momentum shifts from turnovers or special teams.`;
  } else if(k==="contextR"){
    explanation=cat.detail||"";
    if(cat.score>=7) explanation+=` This is one of the NFL's premier rivalries. History, familiarity, and genuine dislike elevate these games beyond what the standings alone would suggest.`;
    else if(cat.score>=4) explanation+=` These teams know each other well enough for the matchup to carry extra weight, even if it doesn't top the list of the NFL's most heated rivalries.`;
  } else if(k==="contextS"){
    explanation=cat.detail||"";
    if(cat.score>=8) explanation+=` In games with this much on the line, every mistake is magnified and every big play carries outsized emotional weight. The stakes themselves become part of the excitement.`;
    else if(cat.score>=5) explanation+=` This game had real standings implications, which tends to sharpen play and raise the emotional stakes for fans tracking the playoff picture.`;
  }

  return h("div",{style:{position:"fixed",inset:0,background:"rgba(7,9,13,.85)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"},onClick:onClose},
    h("div",{style:{background:"var(--bg-2)",border:"1px solid var(--border-2)",padding:"1.5rem",maxWidth:"480px",width:"100%",maxHeight:"80vh",overflowY:"auto"},onClick:e=>e.stopPropagation()},
      h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".75rem"}},
        h("div",{style:{fontFamily:"Oswald",fontSize:"1.1rem",fontWeight:600,letterSpacing:".04em",color:"var(--text-1)"}},cat.name),
        h("div",{className:`${cc(gr.c)}`,style:{fontFamily:"Oswald",fontSize:"1.5rem",fontWeight:700}},`${cat.score}/${cat.max}`)
      ),
      h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".7rem",color:"var(--gold-dim)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:".5rem"}},`Grade: ${gr.g} — ${gr.l}`),
      h("div",{style:{fontSize:".85rem",color:"var(--text-2)",lineHeight:1.7,marginBottom:".75rem"}},explanation),
      h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".7rem",color:"var(--text-3)",borderTop:"1px solid var(--border-1)",paddingTop:".5rem"}},cat.detail),
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
    sLdg(true);sGames([]);sDet(null);sSummary(null);sErr(null);sCache({});sProg({p:0,t:"Searching..."});sSelGame(null);
    sSort("dateDesc");
    try{
      let fetchFailures=0;let fetchBatches=0;
      const res=[];let seasonsToSearch=ssn?[ssn]:[];
      if(!ssn)for(let y=2024;y>=2015;y--)seasonsToSearch.push(""+y);
      const types=st?[st]:["2","3"];const allBatches=[];
      for(const season of seasonsToSearch){
        if(wk){for(const s of types)allBatches.push({season,w:wk,s})}
        else{for(const s of types){const mx=s==="3"?5:18;for(let w=1;w<=mx;w++)allBatches.push({season,w:""+w,s})}}}
      let done=0;
      for(let i=0;i<allBatches.length;i+=8){
        const batch=allBatches.slice(i,i+8);
        fetchBatches+=batch.length;
        const r=await Promise.all(batch.map(({season,w,s})=>espnSB({dates:season,week:w,seasontype:s,limit:50}).then(ev=>ev.map(parseEv).filter(Boolean)).catch(()=>{fetchFailures++;return []})));
        for(const x of r)res.push(...x);done+=batch.length;
        sProg({p:Math.round(done/allBatches.length*100),t:seasonsToSearch.length>1?`Searching ${seasonsToSearch.length} seasons... ${Math.round(done/allBatches.length*100)}%`:`Fetching week ${Math.min(done,allBatches.length)} of ${allBatches.length}...`})}
      if(fetchBatches>0&&fetchFailures===fetchBatches)throw new Error("ALL_FETCHES_FAILED");
      let f=res.filter(g=>g&&(g.done||(g.hs!==0||g.as!==0)));
      if(t1){const nt=normTeam(t1);f=f.filter(g=>normTeam(g.ht)===nt||normTeam(g.at)===nt)}
      if(t2){const nt2=normTeam(t2);f=f.filter(g=>normTeam(g.ht)===nt2||normTeam(g.at)===nt2)}
      const seen=new Set();f=f.filter(g=>{if(seen.has(g.id))return false;seen.add(g.id);return true});
      sGames(f);
    }catch(e){if(String(e&&e.message)==="ALL_FETCHES_FAILED")sErr("No games returned because every ESPN fetch failed. Make sure the Netlify Functions are deployed.");else sErr("Failed to load games.")}
    sLdg(false);sProg({p:100,t:""});
  },[t1,t2,ssn,wk,st]);

  const analyze=useCallback(async g=>{
    sSelGame(g);sLdD(true);sDet(null);sErr(null);sSummary(null);sSumData(null);
    try{
      const d=await espnSum(g.id);const exc=computeExc(g,d);const kp=extractKP(d);const wp=getWPSeries(d);
      const box=buildBox(d);const stats=buildStats(d);const pStats=buildPlayerStats(d);
      sDet({exc,kp,box,stats,pStats,d,wp});sCache(p=>({...p,[g.id]:exc.total}));sLdD(false);
      sSumLoading(true);
      const sd=buildSummaryData(g,d,exc);
      sSumData(sd);
      sSummary(buildRecap(sd));
      sSumLoading(false);
    }catch(e){sErr("Failed to analyze. ESPN data may not be available.");sLdD(false)}
  },[]);

  const batchAn=useCallback(async()=>{
    sBatching(true);const unc=games.filter(g=>!(g.id in cache));let done=0;
    for(let i=0;i<unc.length;i+=4){
      const b=unc.slice(i,i+4);
      const r=await Promise.all(b.map(async g=>{try{const d=await espnSum(g.id);return{id:g.id,sc:computeExc(g,d).total}}catch{return{id:g.id,sc:0}}}));
      const u={};for(const x of r)u[x.id]=x.sc;sCache(p=>({...p,...u}));
      done+=b.length;sProg({p:Math.round(done/unc.length*100),t:`Analyzing ${done} of ${unc.length}...`})}
    sBatching(false);sSort("exc");
  },[games,cache]);

  function toggleDateSort(){if(sort==="dateDesc")sSort("dateAsc");else sSort("dateDesc");}

  const sorted=[...games].sort((a,b)=>{
    if(sort==="exc"){const sa=cache[a.id]??-1,sb=cache[b.id]??-1;return sb-sa}
    if(sort==="dateAsc")return new Date(a.date)-new Date(b.date);
    return new Date(b.date)-new Date(a.date);
  });

  return h("div",{className:"app"},
    h("div",{className:"hdr"},h("div",{className:"hdr-tag"},"1970 — Present"),h("h1",null,"NFL Excitement Index"),h("div",{className:"sub"},"Quantifying what makes football unforgettable")),
    !det?h(Fragment,null,
      h("div",{className:"sp"},
        h("div",{className:"sr"},
          h("div",{className:"fld"},h("label",null,"Team 1"),h("select",{value:t1,onChange:e=>sT1(e.target.value)},h("option",{value:""},"Any Team"),TK.map(k=>h("option",{key:k,value:k},TEAMS[k])))),
          h("div",{className:"fld"},h("label",null,"Team 2"),h("select",{value:t2,onChange:e=>sT2(e.target.value)},h("option",{value:""},"Any Team"),TK.map(k=>h("option",{key:k,value:k},TEAMS[k])))),
          h("div",{className:"fld"},h("label",null,"Season"),h("select",{value:ssn,onChange:e=>sSsn(e.target.value)},h("option",{value:""},"Last 10 Years"),seasons.map(s=>h("option",{key:s,value:s},s)))),
          h("div",{className:"fld-row"},
            h("div",{className:"fld fld-sm"},h("label",null,"Week"),h("select",{value:wk,onChange:e=>sWk(e.target.value)},h("option",{value:""},"All"),weeks.map(w=>h("option",{key:w,value:w},`Wk ${w}`)))),
            h("div",{className:"fld fld-sm"},h("label",null,"Type"),h("select",{value:st,onChange:e=>sSt(e.target.value)},h("option",{value:"2"},"Regular"),h("option",{value:"3"},"Playoffs"),h("option",{value:""},"Both")))
          ),
          h("button",{className:"btn btn-p",onClick:search,disabled:ldg},ldg?"...":"Search")),
        h("div",{className:"hints"},!ssn&&t1?"Will search 2015-2024. Select a season for faster results.":"Set a team + season to see all their games.")),
      ldg?h("div",{className:"ld"},h("div",{className:"ld-r"}),h("div",{className:"ld-t"},prog.t),prog.p>0&&prog.p<100?h("div",{className:"pw"},h("div",{className:"pb"},h("div",{className:"pf",style:{width:`${prog.p}%`}}))):null):null,
      err&&!det?h("div",{style:{textAlign:"center",padding:"2rem"}},h("div",{style:{color:"var(--red)",fontFamily:"Oswald",fontSize:"1.1rem"}},"Error"),h("div",{style:{color:"var(--text-3)",fontSize:".85rem"}},err)):null,
      games.length>0&&!ldg?h("div",{className:"rl"},
        h("div",{className:"rl-hdr"},
          h("div",{className:"rl-cnt"},`${games.length} game${games.length!==1?"s":""} found`),
          h("div",{className:"sc"},
            h("button",{className:`sb${sort.startsWith("date")?" on":""}`,onClick:toggleDateSort},sort==="dateAsc"?"Date \u2191":"Date \u2193"),
            games.every(g=>g.id in cache)?h("button",{className:`sb${sort==="exc"?" on":""}`,onClick:()=>sSort("exc")},"By Excitement"):h("button",{className:"sb",onClick:batchAn,disabled:batching},batching?"Analyzing...":"Rank by Excitement"))),
        batching?h("div",{className:"pw"},h("div",{className:"pb"},h("div",{className:"pf",style:{width:`${prog.p}%`}})),h("div",{className:"pl"},prog.t)):null,
        sorted.map(g=>{const c=cache[g.id];const gr=c!=null?oGrade(c):null;
          const hw=g.hs>g.as;const aw=g.as>g.hs;
          const hiScore=Math.max(g.hs,g.as);const loScore=Math.min(g.hs,g.as);
          const dateStr=new Date(g.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
          return h("div",{key:g.id,className:"gr",onClick:()=>analyze(g)},
            h("div",null,
              h("span",{className:"mu"},
                h("span",{className:aw?"wt":""},g.at),
                h("span",{className:"at"}," @ "),
                h("span",{className:hw?"wt":""},g.ht)),
              c!=null?h("span",{className:`ep ${cc(gr.c)}`,style:{borderColor:`var(--g${gr.c})`}},`${c} \u2014 ${gr.g}`):null),
            h("div",{className:"sc2"},`${hiScore}\u2013${loScore}`),
            h("div",{className:"mc"},dateStr,h("br"),g.week?.number?(g.season?.type===3?"Playoffs":`Week ${g.week.number}`):""))})
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
  const [wpMode,setWpMode]=useState("Leverage");
  const [catModal,setCatModal]=useState(null); // {k, cat}
  const rushCols=["CAR","YDS","AVG","TD","LONG"];
  const recCols=["REC","YDS","AVG","TD","LONG","TGTS"];

  function pTable(label,players,cols){
    if(!players||players.length===0)return null;
    const useCols=cols.filter(c=>players.some(p=>p[c]!=null&&p[c]!==""));
    return h(Fragment,null,
      h("tr",null,h("td",{className:"pst-cat",colSpan:useCols.length+1},label)),
      h("tr",null,h("th",null,"Player"),...useCols.map(c=>h("th",{key:c},c))),
      players.map((p,i)=>h("tr",{key:i},
        h("td",null,p.name,h("span",{className:"tm-tag"},p.team)),
        ...useCols.map(c=>h("td",{key:c},p[c]||"\u2014")))));
  }

  return h("div",{className:"dv"},
    // Category detail modal
    catModal?h(CategoryModal,{cat:catModal.cat,k:catModal.k,onClose:()=>setCatModal(null),g,wpStats:exc.wp}):null,

    h("button",{className:"bb",onClick:onBack},"\u2190 Back to results"),
    h("div",{className:"hero an"},
      h("div",{className:"hero-ctx"},g.season?.type===3?"Playoff Game":`Week ${g.week?.number||"?"} \u00b7 ${g.season?.year||""} Season`),
      h("div",{className:"hero-tm"},
        h("span",null,tn(g.at)),
        g.ar?h("span",{style:{fontSize:".5em",color:"var(--text-3)",marginLeft:".4em"}},`(${g.ar})`):null),
      h("div",{style:{fontFamily:"Oswald",fontSize:"clamp(.9rem,2vw,1.2rem)",color:"var(--text-4)",letterSpacing:".1em",margin:".15rem 0"}},"at"),
      h("div",{className:"hero-tm"},
        h("span",null,tn(g.ht)),
        g.hr?h("span",{style:{fontSize:".5em",color:"var(--text-3)",marginLeft:".4em"}},`(${g.hr})`):null),
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
      h("table",{className:"bt"},
        h("thead",null,h("tr",null,h("th",null,""),
          ...(box[0]?.qs||[]).map((_,i)=>h("th",{key:i},i>=4?`OT${i>4?i-3:""}`:`Q${i+1}`)),
          h("th",null,"Final"))),
        h("tbody",null,box.map((r,i)=>h("tr",{key:i,className:r.win?"win":""},
          h("td",null,r.team),...r.qs.map((q,qi)=>h("td",{key:qi},q==null?"\u2014":q)),h("td",{className:"fc"},r.total==null?"\u2014":r.total)))))):null,

    stats.length>0?h("div",{className:"sec an a2"},h("div",{className:"sec-h"},"Team Statistics"),
      h("table",{className:"st"},
        h("thead",null,h("tr",null,h("th",{style:{textAlign:"right",width:"35%"}},box[0]?.team||"Away"),h("th",{style:{textAlign:"center",width:"30%"}},""),h("th",{style:{textAlign:"left",width:"35%"}},box[1]?.team||"Home"))),
        h("tbody",null,stats.map((s,i)=>h("tr",{key:i},h("td",{style:{textAlign:"right"}},s.away),h("td",{className:"sn"},s.label),h("td",{style:{textAlign:"left"}},s.home)))))):null,

    pStats&&(pStats.passing.length>0||pStats.rushing.length>0||pStats.receiving.length>0)?
      h("div",{className:"sec an a3"},h("div",{className:"sec-h"},"Player Statistics"),
        h("table",{className:"pst"},h("tbody",null,
          pTable("Passing",pStats.passing,passCols),
          pTable("Rushing",pStats.rushing,rushCols),
          pTable("Receiving",pStats.receiving,recCols)))):null,

    // Fix #4: Excitement Breakdown cards are now clickable
    h("div",{className:"sec an a4"},h("div",{className:"sec-h"},"Excitement Breakdown"),
      h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".6rem",color:"var(--text-4)",marginBottom:".4rem",marginTop:"-.4rem"}},"Tap any category for details"),
      h("div",{className:"gg"},Object.entries(exc.scores).map(([k,v])=>{const gr=gradeFor(v.score,v.max);const pct=v.score/v.max*100;
        return h("div",{key:k,className:"gc",onClick:()=>setCatModal({k,cat:v}),style:{cursor:"pointer"}},
          h("div",{className:"gi"},h("h3",null,v.name),h("div",{className:"ds"},v.desc),h("div",{className:"dt"},v.detail),h("div",{className:"br"},h("div",{className:`bf ${bc(gr.c)}`,style:{width:`${pct}%`}}))),
          h("div",{className:`gbg ${cc(gr.c)}`},h("div",null,gr.g),h("div",{className:"pt"},`${v.score}/${v.max}`)))}))),

    // Fix #5: WP Chart with team name, OT support, tooltips
    WPChart({series:wp?.series||[], mode:wpMode, onModeChange:setWpMode, exc, topLev:(sumData?.enrichedPlays||sumData?.topLeveragePlays||[]), homeTeam:g.ht, awayTeam:g.at}),

    // Fix #2: Much better game recap
    h("div",{className:"sec an a5"},h("div",{className:"sec-h"},"Game Recap"),
      h("div",{className:"wb"},
        sumLoading?h("p",{style:{fontStyle:"italic",color:"var(--text-3)"}},"Generating game recap..."):
        summary?summary.map((p,i)=>h("p",{key:i},p)):
        h("p",{style:{color:"var(--text-3)"}},"Recap unavailable."))),

    kp.length>0?h("div",{className:"sec an a6"},h("div",{className:"sec-h"},"Key Plays"),
      kp.map((p,i)=>{const[lbl,cls]=tags[p.tag]||["",""];
        return h("div",{key:i,className:"pi"},
          h("div",{className:"pt2"},`${p.period>=5?"OT":`Q${p.period}`} ${p.clock}`),
          h("div",{className:"ptx"},h("span",{className:`ptg ${cls}`},lbl),p.text))})):null,

    // Fix #3: Updated methodology to match actual WP-based scoring
    h("div",{className:"sec an a7"},
      h("button",{className:"mt",onClick:()=>sMeth(!meth)},meth?"\u25be":"\u25b8"," Scoring Methodology"),
      meth?h("div",{className:"mb"},
        h("h4",null,"How It Works"),"The Excitement Index is built entirely on win probability (WP). We compute a home-team WP estimate for every play using score differential, time remaining, and possession, then measure how much that WP line moves throughout the game. Volatile, uncertain, late-swinging games score highest.",
        h("h4",null,"Leverage (0\u201335)"),"Total absolute WP movement (\u03a3|\u0394WP|) across all plays, with extra weight for the single largest swing. A typical NFL game totals around 1.5 in \u03a3|\u0394WP|; classics push above 2.5.",
        h("h4",null,"Swings (0\u201315)"),"Counts how often win probability crossed the 50% midline (true lead changes) and how often it crossed between the 40% and 60% bands (meaningful advantage shifts).",
        h("h4",null,"Clutch Time (0\u201315)"),"WP movement in the final 8 minutes of the 4th quarter and all of overtime. Late swings carry more emotional weight, and this category isolates that tension.",
        h("h4",null,"In Doubt (0\u201310)"),"What percentage of the game was WP between 20% and 80%? Games that stay in the uncertain zone longer feel more competitive throughout.",
        h("h4",null,"Chaos (0\u201310)"),"Play-to-play volatility (standard deviation of WP changes), which captures the disruptive effect of turnovers, special teams, and big plays without relying on text parsing.",
        h("h4",null,"Context: Stakes (0\u201310)"),"Playoff rounds score highest (Super Bowl = 10). Regular season is weighted by week number and both teams' records \u2014 late-season games between winning teams score higher.",
        h("h4",null,"Context: Rivalry (0\u201310)"),"Historical rivalry intensity plus division familiarity. Boosted when both teams are competitive and in the playoffs. Context categories are capped at 16 combined to prevent them from inflating a boring game."
      ):null));
}

createRoot(document.getElementById("app")).render(h(App));
