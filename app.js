import{createElement as h,useState,useCallback,useEffect,useRef,Fragment}from"https://esm.sh/react@18.2.0";
import{createRoot}from"https://esm.sh/react-dom@18.2.0/client";
import{TEAMS,tn,TK,espnSB,espnSum,parseEv,computeExc,oGrade,gradeFor,extractKP,buildBox,buildStats,buildPlayerStats,buildSummaryData,getAllPlays,getWPSeries}from"./engine.js";

const cc=c=>({s:"cs",a:"ca",b:"cb",c:"cc",d:"cd",f:"cf"}[c]||"");
const bc=c=>({s:"bs",a:"ba",b:"bbl",c:"bc",d:"bd",f:"bf2"}[c]||"");

const normTeam=(x)=>x==="LAR"?"LA":x;
const _ns=s=>(s||"").toString().replace(/\s+/g," ").trim();

function _joinSentences(parts){
  return parts.filter(Boolean).map(p=>p.replace(/\s+/g," ").trim()).filter(Boolean).join(" ");
}
function _fmtPer(per){
  if(!per) return "";
  return per<=4?`Q${per}`:"OT";
}
function _fmtDelta(d){
  const x=Math.round(Math.abs(d)*100);
  return x?`${x} pts`:"";
}
function _pick(arr,seed){
  if(!arr.length) return "";
  const i=Math.abs(seed)%arr.length;
  return arr[i];
}

function _cleanPlay(s){
  s=_ns(s);
  if(!s) return "";
  const cutMarkers=[
    "extra point", "TWO-POINT CONVERSION", "TWO POINT CONVERSION", "two-point conversion", "Penalty", "PENALTY"
  ];
  for(const m of cutMarkers){
    const i=s.toLowerCase().indexOf(m.toLowerCase());
    if(i>0){ s=s.slice(0,i).trim(); break; }
  }
  s=s.replace(/\.+$/,"").trim();
  return s;
}

function _scoreLine(sum){
  if(sum && typeof sum.awayScore==="number" && typeof sum.homeScore==="number"){
    return `${tn(sum.awayTeam)} ${sum.awayScore}, ${tn(sum.homeTeam)} ${sum.homeScore}`;
  }
  return sum?.finalScore||"";
}

function _winnerLoser(sum){
  if(sum && typeof sum.awayScore==="number" && typeof sum.homeScore==="number"){
    const aw=tn(sum.awayTeam), hm=tn(sum.homeTeam);
    if(sum.awayScore>sum.homeScore) return {w:aw,l:hm, wAb:sum.awayTeam, lAb:sum.homeTeam};
    if(sum.homeScore>sum.awayScore) return {w:hm,l:aw, wAb:sum.homeTeam, lAb:sum.awayTeam};
    return {w:hm,l:aw, wAb:sum.homeTeam, lAb:sum.awayTeam, tie:true};
  }
  return {w:sum?.matchup||"", l:""};
}

function buildRecap(sum){
  const arche=sum?.archetype?.type||"tight";
  const top=(sum?.topLeveragePlays||[]).map(x=>({...x, text:_cleanPlay(x.text)})).filter(x=>x.text);
  const wp=sum?.wpStats||null;

  const wl=_winnerLoser(sum);
  const score=_scoreLine(sum);

  const seed=(sum.excitementScore||0)*11 + (wp?.crosses50||0)*29 + (wp?.crosses4060||0)*37;
  const ledes={
    comeback:[
      `${wl.w} erased an early hole and finished it off, beating ${wl.l} ${score.split(",").slice(-1)[0].trim()}.`,
      `${wl.w} found the game late and took it, topping ${wl.l} ${score.split(",").slice(-1)[0].trim()}.`,
      `${wl.w} spent most of the day chasing, then flipped it when it mattered, winning ${score}.`
    ],
    collapse:[
      `${wl.l} led, then watched it slide away — ${wl.w} stole it, ${score}.`,
      `${wl.w} turned a game that looked settled into a win, taking it from ${wl.l}, ${score}.`,
      `${wl.w} kept hanging around until the math changed, then closed it out, ${score}.`
    ],
    seesaw:[
      `${wl.w} survived a game that kept turning over on itself, edging ${wl.l} ${score.split(",").slice(-1)[0].trim()}.`,
      `${wl.w} and ${wl.l} traded control all afternoon before ${wl.w} finally landed the last punch, ${score}.`,
      `${wl.w} outlasted ${wl.l} in a back-and-forth that never stabilized, ${score}.`
    ],
    wire:[
      `${wl.w} controlled the shape of it and never really let ${wl.l} breathe, winning ${score}.`,
      `${wl.w} played from in front and kept the answers coming, beating ${wl.l} ${score.split(",").slice(-1)[0].trim()}.`,
      `${wl.w} dictated terms for most of the day and cashed it in, ${score}.`
    ],
    tight:[
      `${wl.w} won a one-possession grinder, slipping past ${wl.l}, ${score}.`,
      `${wl.w} and ${wl.l} stayed knotted into the fourth before ${wl.w} made the final play, ${score}.`,
      `${wl.w} survived the margins and beat ${wl.l}, ${score}.`
    ],
    incomplete:[`${sum?.matchup||"The game"} finished ${score}.`]
  };

  const p1=_pick(ledes[arche]||ledes.tight, seed);

  const beats=top.slice(0,3).map((tp,i)=>{
    const when=`${_fmtPer(tp.period)} ${tp.clock}`.trim();
    const verb = i===0 ? "The swing started with" : i===1 ? "It flipped again on" : "Then it turned once more on";
    return `${verb} ${when}: ${tp.text}.`;
  });
  const p2 = beats.length ? beats.join(" ") : "";

  const ctxParts=[];
  if(sum?.rivalryNote) ctxParts.push(sum.rivalryNote);
  if(sum?.stakesNote) ctxParts.push(sum.stakesNote.trim());
  const p3 = ctxParts.length ? _joinSentences([ctxParts.join(" ")]) : "";

  const leaders=(sum?.playerLeaders||[]).slice(0,2);
  const leaderLine = leaders.length ? `Stat line: ${leaders.join("; ")}.` : "";
  const wpLine = (wp && wp.sumAbs!=null) ? `It spent about ${Math.round((wp.inDoubtFrac||0)*100)}% of snaps in the "in doubt" band (20-80% WP), with ${wp.crosses50||0} true 50/50 crossings.` : "";
  const p4 = _joinSentences([
    wpLine,
    leaderLine,
    `Excitement Index: ${sum.excitementScore} (${sum.excitementVerdict}).`
  ]);

  return [p1,p2,p3,p4].filter(p=>p && p.trim().length>0).slice(0,4);
}


function WPChart({series, mode, onModeChange, exc, topLev}){
  if(!series || series.length<2){
    return h("div",{style:{color:"var(--text-3)",fontFamily:"JetBrains Mono",fontSize:".75rem"}}, "Win probability data unavailable.");
  }

  const W=860, H=180, pad=24;
  const toX = (t)=> pad + (t/60)*(W-2*pad);
  const toY = (wp)=> pad + (1-wp)*(H-2*pad);

  const step = Math.max(1, Math.floor(series.length/450));
  const pts=[];
  for(let i=0;i<series.length;i+=step){
    const s=series[i];
    if(s && s.tMin!=null && s.wp!=null) pts.push([toX(s.tMin), toY(s.wp)]);
  }
  const path = "M " + pts.map(p=>p[0].toFixed(2)+" "+p[1].toFixed(2)).join(" L ");

  const overlays=[];
  if(mode==="Leverage"){
    const lev=(topLev||[]).slice(0,6);
    for(const tp of lev){
      const t = tp.tMin!=null ? tp.tMin : null;
      if(t==null) continue;
      overlays.push(h("circle",{cx:toX(t), cy:toY(tp.wp||0.5), r:3, fill:"var(--gold)"}));
    }
  }else if(mode==="Swings"){
    for(let i=1;i<series.length;i++){
      const a=series[i-1].wp, b=series[i].wp;
      if(a==null||b==null) continue;
      if((a<0.5 && b>=0.5) || (a>=0.5 && b<0.5)){
        overlays.push(h("circle",{cx:toX(series[i].tMin), cy:toY(series[i].wp), r:2.8, fill:"var(--blue)"}));
      }
    }
  }else if(mode==="Chaos"){
    for(const s of series){
      if(s.tag==="TO" || s.tag==="SP"){
        overlays.push(h("circle",{cx:toX(s.tMin), cy:toY(s.wp), r:2.8, fill:"var(--red)"}));
      }
    }
  }else if(mode==="Clutch"){
    overlays.push(h("rect",{x:toX(52), y:pad, width:toX(60)-toX(52), height:H-2*pad, fill:"rgba(201,162,39,.08)"}));
  }

  const opts=["Leverage","Swings","Chaos","Clutch"];

  return h("div",{className:"sec"},
    h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:"1rem",flexWrap:"wrap"}},
      h("div",{className:"sec-h",style:{borderBottom:"none",marginBottom:"0"}},"Win Probability (Home)"),
      h("div",{style:{display:"flex",alignItems:"center",gap:".5rem"}},
        h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".65rem",letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-3)"}}, "Overlay"),
        h("select",{value:mode,onChange:e=>onModeChange(e.target.value),style:{background:"var(--bg-3)",border:"1px solid var(--border-1)",color:"var(--text-1)",padding:".35rem .5rem",fontFamily:"JetBrains Mono",fontSize:".7rem"}},
          opts.map(o=>h("option",{key:o,value:o},o))))),
    h("div",{style:{border:"1px solid var(--border-1)",background:"var(--bg-2)",padding:".6rem .6rem .2rem",marginTop:".5rem"}},
      h("svg",{viewBox:`0 0 ${W} ${H}`,width:"100%",height:"auto",preserveAspectRatio:"none"},
        h("line",{x1:toX(0),y1:toY(0.5),x2:toX(60),y2:toY(0.5),stroke:"rgba(136,146,164,.35)",strokeWidth:"1",strokeDasharray:"4 4"}),
        (mode==="Clutch")?overlays.shift():null,
        h("path",{d:path,fill:"none",stroke:"rgba(232,236,240,.85)",strokeWidth:"2"}),
        ...overlays
      ),
      h("div",{style:{display:"flex",justifyContent:"space-between",fontFamily:"JetBrains Mono",fontSize:".6rem",color:"var(--text-4)",marginTop:".25rem"}},
        h("div",null,"0:00"),h("div",null,"15:00"),h("div",null,"30:00"),h("div",null,"45:00"),h("div",null,"60:00")
      )
    )
  );
}
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
      let fetchFailures=0;
      let fetchBatches=0;
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
        const r=await Promise.all(batch.map(({season,w,s})=>espnSB({dates:season,week:w,seasontype:s,limit:50}).then(ev=>ev.map(parseEv).filter(Boolean)).catch((e)=>{fetchFailures++;return []})));
        for(const x of r)res.push(...x);done+=batch.length;
        sProg({p:Math.round(done/allBatches.length*100),t:seasonsToSearch.length>1?`Searching ${seasonsToSearch.length} seasons... ${Math.round(done/allBatches.length*100)}%`:`Fetching week ${Math.min(done,allBatches.length)} of ${allBatches.length}...`})}
      if(fetchBatches>0 && fetchFailures===fetchBatches){throw new Error("ALL_FETCHES_FAILED");}
      let f=res.filter(g=>g && (g.done || (g.hs!==0 || g.as!==0)));
      if(t1){const nt=normTeam(t1);f=f.filter(g=>normTeam(g.ht)===nt||normTeam(g.at)===nt)}
      if(t2){const nt2=normTeam(t2);f=f.filter(g=>normTeam(g.ht)===nt2||normTeam(g.at)===nt2)}
      const seen=new Set();f=f.filter(g=>{if(seen.has(g.id))return false;seen.add(g.id);return true});
      console.log("[DEBUG] games after filtering:", f.length, f.slice(0,3));
      sGames(f);
    }catch(e){if(String(e&&e.message)==="ALL_FETCHES_FAILED")sErr("No games returned because every ESPN fetch failed. This usually means your /api/espn proxy functions are not deployed (or returning 404)."); else sErr("Failed to load games.")}
    sLdg(false);sProg({p:100,t:""});
  },[t1,t2,ssn,wk,st]);

  const analyze=useCallback(async g=>{
    sSelGame(g);sLdD(true);sDet(null);sErr(null);sSummary(null);
    try{
      const d=await espnSum(g.id);const exc=computeExc(g,d);const kp=extractKP(d);const wp=getWPSeries(d);
      const box=buildBox(d);const stats=buildStats(d);const pStats=buildPlayerStats(d);
      sDet({exc,kp,box,stats,pStats,d,wp});sCache(p=>({...p,[g.id]:exc.total}));sLdD(false);
      sSumLoading(true);
      const sumData=buildSummaryData(g,d,exc);
      sSumData(sumData);
      sSummary(buildRecap(sumData));
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

  function toggleDateSort(){
    if(sort==="dateDesc")sSort("dateAsc");else sSort("dateDesc");
  }

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
            h("button",{className:`sb${sort.startsWith("date")?" on":""}`,onClick:toggleDateSort},
              sort==="dateAsc"?"Date ↑":"Date ↓"),
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
              c!=null?h("span",{className:`ep ${cc(gr.c)}`,style:{borderColor:`var(--g${gr.c})`}},`${c} — ${gr.g}`):null),
            h("div",{className:"sc2"},`${hiScore}–${loScore}`),
            h("div",{className:"mc"},dateStr,h("br"),g.week?.number?(g.season?.type===3?"Playoffs":`Week ${g.week.number}`):""))})
            ):null,
      (!ldg && !err && games.length===0)?h("div",{style:{textAlign:"center",padding:"2rem",color:"var(--text-3)",fontFamily:"JetBrains Mono",fontSize:".75rem"}}, "No games matched those filters.") : null
    ):null,
    ldD?h("div",{className:"ld"},h("div",{className:"ld-r"}),h("div",{className:"ld-t"},"Analyzing play-by-play data...")):null,
    det&&selGame?h("div",{ref:detRef},h(Detail,{g:selGame,d:det,summary,sumLoading,meth,sMeth,onBack:()=>{sDet(null);sSelGame(null);sSummary(null)}})):null,
    h("div",{className:"ftr"},"NFL Game Excitement Index · Play-by-play data from ESPN · Summaries powered by Claude"));
}

function Detail({g,d,summary,sumData,sumLoading,meth,sMeth,onBack}){
  const{exc,kp,box,stats,pStats,wp}=d;const og=oGrade(exc.total);
  const date=new Date(g.date).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const tags={td:["TD","t-td"],to:["TURNOVER","t-to"],bg:["BIG PLAY","t-bg"],cl:["CLUTCH","t-cl"],sp:["SPECIAL","t-sp"]};

  const passCols=["C/ATT","YDS","AVG","TD","INT","QBR"];
  const [wpMode,setWpMode]=useState("Leverage");
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
        ...useCols.map(c=>h("td",{key:c},p[c]||"—")))));
  }

  return h("div",{className:"dv"},
    h("button",{className:"bb",onClick:onBack},"← Back to results"),
    h("div",{className:"hero an"},
      h("div",{className:"hero-ctx"},g.season?.type===3?"Playoff Game":`Week ${g.week?.number||"?"} · ${g.season?.year||""} Season`),
      h("div",{className:"hero-tm"},
        h("span",null,tn(g.at)),
        g.ar?h("span",{style:{fontSize:".5em",color:"var(--text-3)",marginLeft:".4em"}},`(${g.ar})`):null),
      h("div",{style:{fontFamily:"Oswald",fontSize:"clamp(.9rem,2vw,1.2rem)",color:"var(--text-4)",letterSpacing:".1em",margin:".15rem 0"}},"at"),
      h("div",{className:"hero-tm"},
        h("span",null,tn(g.ht)),
        g.hr?h("span",{style:{fontSize:".5em",color:"var(--text-3)",marginLeft:".4em"}},`(${g.hr})`):null),
      h("div",{className:"hero-fs"},g.as,h("span",{className:"dash"},"–"),g.hs),
      h("div",{className:"hero-m"},date),
      g.ven?h("div",{className:"hero-m",style:{marginTop:".15rem"}},g.ven):null,
      g.att?h("div",{className:"hero-m",style:{marginTop:".15rem"}},`Attendance: ${g.att.toLocaleString()}`):null,
      h("div",{className:"hero-e"},
        h("div",{className:"hero-el"},"Excitement Index"),
        h("div",{className:`hero-en ${cc(og.c)}`},exc.total),
        h("div",null,h("span",{className:`hero-eg ${cc(og.c)}`,style:{borderColor:`var(--g${og.c})`}},`${og.g} — ${og.l}`)),
        h("div",{className:"hero-eb"},h("div",{className:`hero-ebf ${bc(og.c)}`,style:{width:`${Math.min(exc.total,100)}%`}})))),

    box.length>0?h("div",{className:"sec an a1"},h("div",{className:"sec-h"},"Box Score"),
      h("table",{className:"bt"},
        h("thead",null,h("tr",null,h("th",null,""),
          ...(box[0]?.qs||[]).map((_,i)=>h("th",{key:i},i>=4?`OT${i>4?i-3:""}`:`Q${i+1}`)),
          h("th",null,"Final"))),
        h("tbody",null,box.map((r,i)=>h("tr",{key:i,className:r.win?"win":""},
          h("td",null,r.team),...r.qs.map((q,qi)=>h("td",{key:qi},q==null?"—":q)),h("td",{className:"fc"},r.total==null?"—":r.total)))))):null,

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

    h("div",{className:"sec an a4"},h("div",{className:"sec-h"},"Excitement Breakdown"),
      h("div",{className:"gg"},Object.entries(exc.scores).map(([k,v])=>{const gr=gradeFor(v.score,v.max);const pct=v.score/v.max*100;
        return h("div",{key:k,className:"gc"},
          h("div",{className:"gi"},h("h3",null,v.name),h("div",{className:"ds"},v.desc),h("div",{className:"dt"},v.detail),h("div",{className:"br"},h("div",{className:`bf ${bc(gr.c)}`,style:{width:`${pct}%`}}))),
          h("div",{className:`gbg ${cc(gr.c)}`},h("div",null,gr.g),h("div",{className:"pt"},`${v.score}/${v.max}`)))}))),

    WPChart({series:wp?.series||[], mode:wpMode, onModeChange:setWpMode, exc, topLev:(sumData?.topLeveragePlays||[])}),

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

    h("div",{className:"sec an a7"},
      h("button",{className:"mt",onClick:()=>sMeth(!meth)},meth?"▾":"▸"," Scoring Methodology"),
      meth?h("div",{className:"mb"},
        h("h4",null,"Competitiveness (0–20)"),"Measures what percentage of the game was played within one score (8 pts). Bonus for games within 3 pts. Penalized for high average margin.",
        h("h4",null,"Comeback Factor (0–15)"),"Winner's max deficit overcome + loser's best non-garbage-time swing + lead reversals. Garbage-time scoring excluded.",
        h("h4",null,"Late-Game Drama (0–15)"),"Only counts Q4 events when the game is within 2 scores AT THE TIME of the event. Scoring from 55-0 to 55-7 earns nothing. Includes clutch scores, near-misses, and OT.",
        h("h4",null,"Big Plays (0–15)"),"40+ yd gains and 25+ yd TDs on offensive/return plays. Field goals excluded. Weighted by game context: big plays in close games score higher. Penalty-nullified plays excluded.",
        h("h4",null,"Game Stakes (0–10)"),"Super Bowl/Conf Championship (10) down to early season (2). Boosted when both teams have winning records and for late-season division games.",
        h("h4",null,"Rivalry Factor (0–10)"),"Historical rivalry base + same division/conference + both teams' current quality.",
        h("h4",null,"Scoring Volume (0–10)"),"Total combined points. Bonus when both teams score 20+.",
        h("h4",null,"Turnovers & Momentum (0–15)"),"INTs, fumbles, defensive/ST TDs, blocked kicks, turnovers on downs, missed FGs, safeties.",
        h("h4",null,"Lead Changes (0–10)"),"Minute-by-minute tracking of lead swaps and ties (0-0 start excluded).",
        h("h4",null,"Overtime (0–5)"),"Bonus for OT, extra for multiple OT periods."
      ):null));
}

createRoot(document.getElementById("app")).render(h(App));
