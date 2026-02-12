// engine.js — NFL Excitement Scoring Engine v8 (WP-based)
// Core idea: excitement correlates with game-state volatility, proxied by win probability (WP) swings.
// We compute a home-team win probability time series from play-by-play (with graceful fallbacks),
// then score categories from the WP curve. Rivalry/stakes remain as additive "Context" factors.

export const TEAMS={ARI:"Arizona Cardinals",ATL:"Atlanta Falcons",BAL:"Baltimore Ravens",BUF:"Buffalo Bills",CAR:"Carolina Panthers",CHI:"Chicago Bears",CIN:"Cincinnati Bengals",CLE:"Cleveland Browns",DAL:"Dallas Cowboys",DEN:"Denver Broncos",DET:"Detroit Lions",GB:"Green Bay Packers",HOU:"Houston Texans",IND:"Indianapolis Colts",JAX:"Jacksonville Jaguars",KC:"Kansas City Chiefs",LAC:"Los Angeles Chargers",LA:"Los Angeles Rams",LV:"Las Vegas Raiders",MIA:"Miami Dolphins",MIN:"Minnesota Vikings",NE:"New England Patriots",NO:"New Orleans Saints",NYG:"New York Giants",NYJ:"New York Jets",PHI:"Philadelphia Eagles",PIT:"Pittsburgh Steelers",SEA:"Seattle Seahawks",SF:"San Francisco 49ers",TB:"Tampa Bay Buccaneers",TEN:"Tennessee Titans",WAS:"Washington Commanders"};
export const TK=Object.keys(TEAMS);
export const tn=k=>TEAMS[k]||k;

const API="/api/espn";

export async function espnSB({dates,week,seasontype,limit=50}){
  const u=`${API}/scoreboard?dates=${dates}&week=${week||""}&seasontype=${seasontype||""}&limit=${limit}`;
  const r=await fetch(u);if(!r.ok)throw new Error("SB fail");
  return (await r.json()).events||[];
}
export async function espnSum(id){
  const r=await fetch(`${API}/summary?event=${id}`);if(!r.ok)throw new Error("SUM fail");
  return await r.json();
}

// ---------- Divisions / rivalry scaffolding ----------
const DIV={
  AFC_E:new Set(["BUF","MIA","NE","NYJ"]),
  AFC_N:new Set(["BAL","CIN","CLE","PIT"]),
  AFC_S:new Set(["HOU","IND","JAX","TEN"]),
  AFC_W:new Set(["DEN","KC","LAC","LV"]),
  NFC_E:new Set(["DAL","NYG","PHI","WAS"]),
  NFC_N:new Set(["CHI","DET","GB","MIN"]),
  NFC_S:new Set(["ATL","CAR","NO","TB"]),
  NFC_W:new Set(["ARI","LA","SF","SEA"]),
};
function getDiv(t){for(const[k,s]of Object.entries(DIV))if(s.has(t))return k;return null}
function divRivals(a,b){const da=getDiv(a),db=getDiv(b);return da&&da===db}

const RIV={
  "DAL|PHI":8,"DAL|NYG":7,"DAL|WAS":7,"PHI|NYG":7,"PHI|WAS":7,"NYG|WAS":6,
  "GB|CHI":10,"GB|MIN":7,"CHI|MIN":7,"DET|GB":6,"DET|CHI":6,
  "KC|LV":6,"KC|DEN":7,"DEN|LV":5,"LAC|LV":5,
  "PIT|BAL":9,"PIT|CLE":7,"BAL|CLE":6,"PIT|CIN":7,"BAL|CIN":7,
  "SF|SEA":8,"SF|LA":7,"SEA|LA":6,
  "NO|ATL":9,
  "NYJ|NE":7,
  "BUF|KC":6,
  "PHI|DAL":8
};
const key=(a,b)=>a<b?`${a}|${b}`:`${b}|${a}`;
function rivBase(a,b){return RIV[key(a,b)]||0}

// ---------- Helpers ----------
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const sigmoid=x=>1/(1+Math.exp(-x));

function parseClockToSeconds(clock){
  if(!clock) return null;
  const m=String(clock).match(/(\d+):(\d+)/);
  if(!m) return null;
  return (+m[1]*60 + +m[2]);
}
function periodLengthSec(period){
  if(period==null) return 900;
  return period<=4 ? 900 : 600;
}
function gameElapsedSec(period, clock){
  const p=period||1;
  const rem=parseClockToSeconds(clock);
  const len=periodLengthSec(p);
  if(rem==null) return null;
  const elIn=len-rem;
  let base=0;
  if(p<=4){
    base=(p-1)*900;
  }else{
    base=3600 + (p-5)*periodLengthSec(5);
  }
  return base + elIn;
}
function gameRemainingSec(period, clock){
  const p=period||1;
  const rem=parseClockToSeconds(clock);
  if(rem==null) return null;
  if(p<=4) return (4-p)*900 + rem;
  return rem;
}

function parseRec(r){
  if(!r) return null;
  const m=String(r).match(/(\d+)-(\d+)(?:-(\d+))?/);
  return m?{w:+m[1],l:+m[2],t:m[3]?+m[3]:0}:null;
}
function fmtRec(x){if(!x)return"";return x.t?`${x.w}-${x.l}-${x.t}`:`${x.w}-${x.l}`;}
function preRecFromPost(post,delta){
  const r=parseRec(post); if(!r) return post||"";
  r.w=Math.max(0,r.w-(delta.w||0));
  r.l=Math.max(0,r.l-(delta.l||0));
  r.t=Math.max(0,r.t-(delta.t||0));
  return fmtRec(r);
}

// ---------- parseEv (scoreboard -> game row) ----------
export const parseEv = (ev) => {
  const c = ev.competitions?.[0];
  if (!c) return null;

  const hm = c.competitors?.find((x) => x.homeAway === "home");
  const aw = c.competitors?.find((x) => x.homeAway === "away");

  const hs = parseInt(hm?.score) || 0;
  const as = parseInt(aw?.score) || 0;

  const st = c.status?.type || {};
  const done = !!(
    st.completed ||
    st.state === "post" ||
    st.name === "STATUS_FINAL" ||
    String(st.description || "").toLowerCase() === "final"
  );

  const parseRecord = (s) => {
    if (!s) return null;
    const m = String(s).match(/^(\d+)-(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    return { w: +m[1], l: +m[2], t: m[3] ? +m[3] : 0 };
  };
  const fmtRecord = (r) => (r ? (r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`) : "");
  const backUp = (post, delta) => {
    const r = parseRecord(post);
    if (!r) return post || "";
    r.w = Math.max(0, r.w - (delta.w || 0));
    r.l = Math.max(0, r.l - (delta.l || 0));
    r.t = Math.max(0, r.t - (delta.t || 0));
    return fmtRecord(r);
  };

  const hrPost = hm?.records?.[0]?.summary || "";
  const arPost = aw?.records?.[0]?.summary || "";
  let hr = hrPost;
  let ar = arPost;

  if (done) {
    if (hs > as) {
      hr = backUp(hrPost, { w: 1 });
      ar = backUp(arPost, { l: 1 });
    } else if (as > hs) {
      hr = backUp(hrPost, { l: 1 });
      ar = backUp(arPost, { w: 1 });
    } else {
      hr = backUp(hrPost, { t: 1 });
      ar = backUp(arPost, { t: 1 });
    }
  }

  return {
    id: ev.id,
    date: ev.date,
    season: ev.season,
    week: ev.week,
    ht: (hm?.team?.abbreviation==="LAR"?"LA":(hm?.team?.abbreviation||"???")),
    at: (aw?.team?.abbreviation==="LAR"?"LA":(aw?.team?.abbreviation||"???")),
    hs,
    as,
    hr,
    ar,
    ven: c.venue?.fullName || "",
    att: c.attendance,
    done,
  };
};

// ---------- Grades ----------
export function gradeFor(score,max){
  const pct=max?score/max:0;
  if(pct>=.9)return{c:"s",g:"S",l:"Elite"};
  if(pct>=.75)return{c:"a",g:"A",l:"Great"};
  if(pct>=.6)return{c:"b",g:"B",l:"Good"};
  if(pct>=.45)return{c:"c",g:"C",l:"Average"};
  if(pct>=.3)return{c:"d",g:"D",l:"Weak"};
  return{c:"f",g:"F",l:"Flat"};
}
export function oGrade(total){
  if(total>=90)return{c:"s",g:"S",l:"Instant Classic"};
  if(total>=78)return{c:"a",g:"A",l:"Great"};
  if(total>=64)return{c:"b",g:"B",l:"Good"};
  if(total>=50)return{c:"c",g:"C",l:"Decent"};
  if(total>=36)return{c:"d",g:"D",l:"Meh"};
  return{c:"f",g:"F",l:"Dud"};
}

// ---------- Box score / stats ----------
function getHomeTeamId(d){
  const comp=d?.header?.competitions?.[0];
  const home=comp?.competitors?.find(c=>c.homeAway==="home");
  return home?.team?.id;
}
export function buildBox(d){
  const comp=d?.header?.competitions?.[0];
  const cs=comp?.competitors||[];
  const away=cs.find(x=>x.homeAway==="away");
  const home=cs.find(x=>x.homeAway==="home");
  const lines=[];
  for(const c of [away,home]){
    const team=c?.team?.abbreviation||"";
    const qs=(c?.linescores||[]).map(x=>{if(!x)return"0";if(x.displayValue!=null&&x.displayValue!=="")return String(x.displayValue);if(x.value!=null)return String(x.value);return"0"});
    const total=String((c&&c.score!=null)?c.score:"");
    lines.push({team,qs,total,win:c?.winner});
  }
  return lines;
}
export function buildStats(d){
  const t=d?.boxscore?.teams||[];
  if(t.length<2)return[];
  const a=t[0],h=t[1];
  const rows=[];
  const amap=new Map((a.statistics||[]).map(s=>[s.name,s.displayValue]));
  const hmap=new Map((h.statistics||[]).map(s=>[s.name,s.displayValue]));
  const labels=[
    ["totalYards","Total Yards"],
    ["netPassingYards","Passing Yards"],
    ["rushingYards","Rushing Yards"],
    ["turnovers","Turnovers"],
    ["possessionTime","Possession"],
    ["thirdDownEff","3rd Down"],
    ["fourthDownEff","4th Down"],
    ["sacksYardsLost","Sacks-Yds Lost"],
    ["penaltiesYards","Penalties"],
  ];
  for(const [k,label] of labels){
    if(amap.has(k)||hmap.has(k))rows.push({label,away:amap.get(k)||"—",home:hmap.get(k)||"—"});
  }
  return rows;
}
export function buildPlayerStats(d){
  const players=d?.boxscore?.players||[];
  const out={passing:[],rushing:[],receiving:[]};
  for(const team of players){
    const ab=team.team?.abbreviation||"";
    for(const cat of (team.statistics||[])){
      const name=(cat.name||"").toLowerCase();
      const ath=cat.athletes||[];
      if(name.includes("passing")){
        for(const a of ath.slice(0,2)){
          out.passing.push({team:ab,name:a.athlete?.displayName||"",...objFromLabels(cat.labels,a.stats)});
        }
      }else if(name.includes("rushing")){
        for(const a of ath.slice(0,2)){
          out.rushing.push({team:ab,name:a.athlete?.displayName||"",...objFromLabels(cat.labels,a.stats)});
        }
      }else if(name.includes("receiving")){
        for(const a of ath.slice(0,3)){
          out.receiving.push({team:ab,name:a.athlete?.displayName||"",...objFromLabels(cat.labels,a.stats)});
        }
      }
    }
  }
  function objFromLabels(labels,stats){
    const o={};
    for(let i=0;i<labels.length;i++)o[labels[i]]=stats?.[i]??"";
    return o;
  }
  return out;
}

// ---------- Plays ----------
export function getAllPlays(d){
  const drives=d?.drives?.previous||[];
  const arr=[];
  for(const dr of drives){
    const teamId=dr?.team?.id;
    for(const p of (dr.plays||[])){
      arr.push({...p,_driveTeamId:teamId});
    }
  }
  return arr;
}
function normSpace(s){return String(s||"").replace(/\s+/g," ").trim();}

export function extractKP(d){
  const plays=getAllPlays(d);
  const homeId=getHomeTeamId(d);
  const cats=[];
  for(const p of plays){
    const raw=p.text||"";
    const lo=raw.toLowerCase();
    const ty=(p.type?.text||"").toLowerCase();
    const y=p.statYardage||0;
    const period=p.period?.number||0;
    const clock=p.clock?.displayValue||"";

    // SKIP plays with "No Play" (penalty nullified)
    if(lo.includes("no play")||ty.includes("penalty")) continue;

    let tag=null;
    // Scoring plays (TD, FG, safety)
    if(lo.includes("touchdown")||lo.includes(" td ")||ty.includes("touchdown")) tag="TD";
    else if(ty.includes("field goal")&&!ty.includes("missed")&&lo.includes("good")) tag="FG";
    else if(lo.includes("safety")||ty.includes("safety")) tag="SP";
    // Turnovers
    else if(lo.includes("intercept")||ty.includes("interception")) tag="TO";
    else if(lo.includes("fumble")&&(lo.includes("recovered")||lo.includes("forced")||lo.includes("fumbles"))) tag="TO";
    else if(ty.includes("turnover on downs")) tag="TO";
    // Blocked kicks
    else if(lo.includes("blocked")&&(lo.includes("punt")||lo.includes("field goal")||lo.includes("kick"))) tag="SP";
    // 4th down attempts (success or failure)
    else if(lo.includes("4th")&&(lo.includes("pass complete")||lo.includes("rush"))) tag="4D";
    // Missed FG
    else if(ty.includes("missed field goal")||lo.includes("field goal no good")||lo.includes("missed")) tag="CL";
    // Big plays (40+ yards, not punts/kicks)
    else if(y>=40&&!lo.includes("punt")&&!lo.includes("kickoff")) tag="BG";

    if(tag){
      // Get score after play
      const hs=p.homeScore!=null?+p.homeScore:null;
      const as=p.awayScore!=null?+p.awayScore:null;
      cats.push({tag,text:titleizePlay(raw),period,clock,homeScore:hs,awayScore:as});
    }
  }
  const uniq=[];const seen=new Set();
  for(const x of cats){
    const k=x.tag+"|"+x.period+"|"+x.clock+"|"+(x.text||"").slice(0,40);
    if(seen.has(k))continue;
    seen.add(k);uniq.push(x);
  }
  return uniq.slice(0,20);
}

// ---------- Context scoring (rivalry / stakes) ----------
function winPct(recStr){
  const r=parseRec(recStr); if(!r) return null;
  const gp=(r.w+r.l+r.t)||0;
  return gp ? (r.w/gp) : null;
}
function calcStakes(g, d){
  const wk=g.week?.number||0;
  const st=g.season?.type;
  if(st===3){
    if(wk===5||wk===4)return{score:10,max:10,name:"Context: Stakes",desc:"Playoff importance and elimination pressure",detail:"Super Bowl / Conference Championship"};
    if(wk===3)return{score:9,max:10,name:"Context: Stakes",desc:"Playoff importance and elimination pressure",detail:"Divisional Round"};
    return{score:8,max:10,name:"Context: Stakes",desc:"Playoff importance and elimination pressure",detail:"Wild Card Round"};
  }

  const hPct=winPct(g.hr),aPct=winPct(g.ar);

  let base=2;
  if(wk>=17)base=5; else if(wk>=15)base=4; else if(wk>=12)base=3; else if(wk>=8)base=2;

  let boost=0;
  if(hPct!=null&&aPct!=null){
    if(hPct>=.60&&aPct>=.60)boost+=3;
    else if(hPct>=.50&&aPct>=.50)boost+=2;
    else if(hPct>=.50||aPct>=.50)boost+=1;
  }
  if(divRivals(g.ht,g.at)&&wk>=12)boost+=1;

  if(hPct!=null&&aPct!=null&&hPct<.40&&aPct<.40){
    base=Math.min(base,2);
    boost=Math.min(boost,1);
  }

  // Detect resting starters / clinched scenarios
  let contextNote="";
  let restingPenalty=0;

  if(d && wk>=16){
    const pStats=buildPlayerStats(d);
    const passers=pStats?.passing||[];
    // If top passer has very low attempts (< 15), likely pulled early or resting
    // Week 17-18 with a top team is suspicious
    if(passers.length>=1){
      const topPasser=passers[0];
      const attMatch=(topPasser["C/ATT"]||"").match(/(\d+)\/(\d+)/);
      if(attMatch){
        const att=+attMatch[2];
        if(att<12 && wk>=17){
          // Very low attempts in a late-season game = likely resting
          if(hPct!=null&&hPct>=.70){
            contextNote=`${tn(g.ht)} may have rested starters (${topPasser.name}: ${topPasser["C/ATT"]})`;
            restingPenalty=3;
          } else if(aPct!=null&&aPct>=.70){
            contextNote=`${tn(g.at)} may have rested starters (${topPasser.name}: ${topPasser["C/ATT"]})`;
            restingPenalty=3;
          }
        }
      }
    }
    // Check if both passers have low attempts (both resting)
    if(passers.length>=2){
      const att1=((passers[0]["C/ATT"]||"").match(/\d+\/(\d+)/)||[])[1];
      const att2=((passers[1]["C/ATT"]||"").match(/\d+\/(\d+)/)||[])[1];
      if(att1&&att2&&+att1<15&&+att2<15&&wk>=17){
        contextNote="Both teams may have been resting starters";
        restingPenalty=4;
      }
    }
  }

  const score=clamp(base+boost-restingPenalty,0,10);
  let detail=`Week ${wk||"?"}`;
  if(g.ar&&g.hr)detail+=` — pregame ${g.at} ${g.ar}, ${g.ht} ${g.hr}`;
  if(contextNote) detail+=` · ${contextNote}`;
  else if(hPct!=null&&aPct!=null&&hPct<.40&&aPct<.40)detail+=" (low-stakes matchup)";
  else if(hPct!=null&&aPct!=null&&hPct>=.50&&aPct>=.50)detail+=" (both in the mix)";
  return{score,max:10,name:"Context: Stakes",desc:"Season meaning: division races, playoff pressure",detail};
}
function calcRivalry(g){
  let rb=rivBase(g.ht,g.at);
  if(divRivals(g.ht,g.at)&&rb<3)rb=3;
  const hr=parseRec(g.hr),ar=parseRec(g.ar);
  if(hr&&ar){
    const hPct=hr.w/(hr.w+hr.l+hr.t||1);
    const aPct=ar.w/(ar.w+ar.l+ar.t||1);
    if(hPct>=.65&&aPct>=.65)rb=Math.min(rb+2,10);
    else if(hPct>=.55&&aPct>=.55)rb=Math.min(rb+1,10);
  }
  if(g.season?.type===3){ rb=Math.max(rb,5); rb=Math.min(rb+1,10); }
  const score=clamp(rb,0,10);
  let detail=rb>=8?"Storied rivalry":rb>=5?"Notable rivalry / high familiarity":rb>=3?"Division familiarity":"Non-rivalry";
  return{score,max:10,name:"Context: Rivalry",desc:"History and familiarity (kept separate from leverage)",detail};
}

// ---------- Win probability model (home team) ----------
// Calibrated against known NFL WP benchmarks:
//   Tied at half ≈ 50%, Up 7 at half ≈ 73%, Up 14 at half ≈ 89%
//   Up 7 with 5min left ≈ 90%, Up 7 with 2min left ≈ 96%
//   Up 3 at half ≈ 62%, Up 3 with 5min left ≈ 80%
function wpHomeFromState({homeScore,awayScore,possIsHome,period,clock}){
  const sd=(homeScore||0)-(awayScore||0);
  const rem=gameRemainingSec(period,clock);
  const remSafe=(rem==null)?1800:Math.max(rem,1);

  // Time factor: score matters more as game progresses
  // Use inverse-sqrt scaling — gentle early, steep late
  // At 3600s left (game start): factor ≈ 1.0
  // At 1800s left (halftime): factor ≈ 1.41
  // At 300s left (5 min Q4): factor ≈ 3.46
  // At 120s left (2 min Q4): factor ≈ 5.48
  const timeFactor = Math.sqrt(3600 / remSafe);

  // Base coefficient: tuned so up-7-at-halftime ≈ 73%
  // 0.10 * 7 * 1.41 = 0.99 → sigmoid(0.99) = 0.729 ✓
  const scoreCoeff = 0.10;

  // Possession bump: worth ~3% at midgame, ~6% late
  const poss = possIsHome==null ? 0 : (possIsHome ? 1 : -1);
  const possCoeff = 0.15;

  let x = scoreCoeff * sd * timeFactor + possCoeff * poss;

  // 2-minute drill urgency: trailing team's WP drops faster
  if(remSafe <= 120 && period <= 4 && sd !== 0){
    const urgency = clamp((120 - remSafe) / 120, 0, 1);
    x += Math.sign(sd) * 0.5 * urgency;
  }

  return clamp(sigmoid(x), 0.01, 0.99);
}

function getPossTeamId(play){
  return play?.team?.id || play?._driveTeamId || null;
}
function getScoresFromPlay(play, last){
  const hs=play?.homeScore;
  const as=play?.awayScore;
  if(hs!=null && as!=null) return {homeScore:+hs, awayScore:+as};
  return last;
}

function sortPlaysChrono(plays){
  const withKey = plays.map(p=>{
    const per=p.period?.number||1;
    const clk=p.clock?.displayValue||p.clock?.value||p.clock;
    const el=gameElapsedSec(per, clk);
    // sequenceNumber is monotonic within ESPN pbp and helps order edge cases (OT vs late Q4, null clocks)
    const seq = (p.sequenceNumber!=null)? Number(p.sequenceNumber) : (p.sequence!=null?Number(p.sequence):0);
    const base = (el==null? 1e12 : el);
    return {p, k: base, seq: (isFinite(seq)?seq:0)};
  });
  withKey.sort((a,b)=>{
    if(a.k!==b.k) return a.k-b.k;
    return a.seq-b.seq;
  });
  return withKey.map(x=>x.p);
}


export function playTag(text,type){
  const lo=(text||"").toLowerCase();
  const ty=(type||"").toLowerCase();
  if(lo.includes("intercept")||ty.includes("interception")) return "TO";
  if(lo.includes("turnover on downs")||ty.includes("turnover on downs")) return "TO";
  if(lo.includes("fumble")){
    // Only tag as turnover if it likely changed possession.
    // ESPN play text often includes "RECOVERED by <TEAM>-<PLAYER>" for true changes.
    const recBy = lo.includes("recovered by");
    const selfRec = /\band\s+recovers\b|\brecovers\s+at\b/i.test(text||"");
    if(recBy && !selfRec) return "TO";
  }
  if(lo.includes("blocked")&&(lo.includes("punt")||lo.includes("field goal"))) return "SP";
  if(lo.includes("safety")||ty.includes("safety")) return "SP";
  if(ty.includes("missed field goal")||lo.includes("missed")) return "CL";
  return "";
}

function computeWPSeries(d){
  const homeId=getHomeTeamId(d);
  const playsRaw=getAllPlays(d);
  if(!playsRaw.length || !homeId) return {series:[], stats:null};

  const plays=sortPlaysChrono(playsRaw);

  // Prefer ESPN win probability when available (0-1 home win pct)
  const wpMap=new Map();
  const wpArr=d?.winprobability||d?.winProbability||[];
  if(Array.isArray(wpArr)){
    for(const w of wpArr){
      const pid=(w?.playId!=null)?String(w.playId):null;
      const hp=w?.homeWinPercentage;
      if(pid && typeof hp==="number") let v=hp; if(v>1.01) v=v/100; v=Math.max(0,Math.min(1,v)); wpMap.set(pid, v);
    }
  }

  // Plays to skip entirely (they don't affect game state)
  const SKIP_TYPES=new Set([
    "timeout","end period","end of half","end of game","coin toss",
    "two-minute warning","official timeout","tv timeout"
  ]);

  let lastScore={homeScore:0,awayScore:0};
  let prevWp=0.5;
  const series=[];
  let firstSet=false;

  for(const p of plays){
    const per=p.period?.number||1;
    const clk=p.clock?.displayValue||p.clock?.value||p.clock;
    const typeText=(p.type?.text||"").toLowerCase();
    const rawText=(p.text||p.shortText||"");
    // Skip plays nullified/aborted so they don't create phantom WP swings
    if(typeText.includes("aborted")) continue;
    if(/\bpenalty\b/i.test(rawText) && !/declined/i.test(rawText) && !/offsetting/i.test(rawText) && !/no play/i.test(rawText)) continue;
    if(/\(\s*no play\s*\)/i.test(rawText) || typeText.includes("no play")) continue;

    // Skip non-game events
    if(SKIP_TYPES.has(typeText)) continue;

    const sc=getScoresFromPlay(p,lastScore);
    if(sc) lastScore=sc;

    const possTeamId=getPossTeamId(p);
    const possIsHome=(possTeamId==null)?null:(possTeamId===homeId);

    // For kickoffs/punts/PATs, nullify possession to prevent artificial swings
    const isNeutral=typeText.includes("kickoff")||typeText.includes("extra point")||
      typeText.includes("two-point");
    const effectivePoss=isNeutral?null:possIsHome;

    const pid = (p.id!=null)?String(p.id):null;
    const espnWp = pid? wpMap.get(pid) : null;
    const wp = (typeof espnWp==="number") ? espnWp : wpHomeFromState({
      homeScore:lastScore.homeScore,
      awayScore:lastScore.awayScore,
      possIsHome:effectivePoss,
      period:per,
      clock:clk
    });
    if(!firstSet){prevWp=wp;firstSet=true;}

    const delta=wp-prevWp;
    const absDelta=Math.abs(delta);
    prevWp=wp;

    const rem=gameRemainingSec(per, clk);
    const elapsed=gameElapsedSec(per, clk);
    const text=normSpace(p.text||p.shortText||p.type?.text||"");

    series.push({
      wp, delta, absDelta,
      period:per,
      clock:clk,
      remSec:rem,
      tMin:(elapsed!=null?elapsed/60:null),
      text,
      teamId:possTeamId,
      homeScore:lastScore.homeScore,
      awayScore:lastScore.awayScore,
      type:(p.type?.text||""),
      tag:playTag(p.text||p.shortText||"", p.type?.text||"")
    });
  }

  if(series.length<10) return {series, stats:null};
  return {series, stats: computeWPStats(series)};
}


// Alternative WP model (heuristic+) that uses additional state when available.
// This is NOT ESPN/nflfastR; it's a more realistic fallback than score/time/possession alone.
function wpHomeFromStatePlus(state){
  const {homeScore, awayScore, possIsHome, period, clock, yardline100, down, distance} = state||{};
  const sd = (homeScore||0) - (awayScore||0); // home score diff
  const rem = gameRemainingSec(period||1, clock);
  const remFrac = (rem==null)?0.5:Math.max(0, Math.min(1, rem/3600)); // 1 early, 0 late
  // As time runs out, each point matters more.
  const timeScale = 1.0 + 2.2*(1-remFrac);

  // Base score effect (roughly: 7 pts ~ big shift late, modest early)
  let logit = (sd/7)*1.15*timeScale;

  // Possession effect (small early, larger late)
  if(possIsHome===true) logit += 0.20*timeScale;
  else if(possIsHome===false) logit -= 0.20*timeScale;

  // Field position: yardline_100 is distance from opponent endzone (0 at goal line, 100 at own goal line)
  if(typeof yardline100==="number" && isFinite(yardline100)){
    const inOppTerr = (100-yardline100); // higher is better
    // Normalize: midfield ~50, goal-to-go ~90
    const fp = (inOppTerr-50)/50; // -1..+1
    logit += 0.35*fp*timeScale;
  }

  // Down & distance: worse situations reduce WP a bit
  if(typeof down==="number" && down>=3 && down<=4 && typeof distance==="number" && isFinite(distance)){
    const d = Math.min(20, Math.max(0, distance));
    const downPenalty = (down===3?0.10:0.18) * (d/10);
    // apply to offense; flip by possession
    if(possIsHome===true) logit -= downPenalty*timeScale;
    else if(possIsHome===false) logit += downPenalty*timeScale;
  }

  // Overtime: treat as tighter (closer to 50) unless big score diff (rare)
  if((period||1)>4){
    logit *= 0.70;
  }

  const wp = 1/(1+Math.exp(-logit));
  return Math.max(0, Math.min(1, wp));
}

function teamIdToAbbrMap(d){
  const m=new Map();
  const comps=d?.header?.competitions?.[0]?.competitors||d?.competitions?.[0]?.competitors||[];
  for(const c of comps){
    const id=c?.team?.id;
    const ab=c?.team?.abbreviation;
    if(id!=null && ab) m.set(String(id), ab);
  }
  return m;
}

function parseYardline100(yardLine, possAbbr){
  // yardLine like "KC 40" or "BUF 25"
  if(!yardLine || typeof yardLine!=="string" || !possAbbr) return null;
  const m=yardLine.trim().match(/^([A-Z]{2,3})\s+(\d{1,2})$/);
  if(!m) return null;
  const side=m[1], y=parseInt(m[2],10);
  if(!isFinite(y)) return null;
  // Convert to yards from opponent endzone (yardline_100)
  // If ball is on offense side: distance to opponent endzone = 100 - y
  // If ball is on opponent side: distance to opponent endzone = y
  return (side===possAbbr) ? (100 - y) : y;
}

function computeWPSeriesPlus(d){
  const homeId=getHomeTeamId(d);
  const playsRaw=getAllPlays(d);
  if(!playsRaw.length || !homeId) return {series:[], stats:null};

  const plays=sortPlaysChrono(playsRaw);
  const id2abbr=teamIdToAbbrMap(d);

  const SKIP_TYPES=new Set([
    "timeout","end period","end of half","end of game","coin toss",
    "two-minute warning","official timeout","tv timeout"
  ]);

  let lastScore={homeScore:0,awayScore:0};
  let prevWp=0.5;
  const series=[];
  let firstSet=false;

  for(const p of plays){
    const per=p.period?.number||1;
    const clk=p.clock?.displayValue||p.clock?.value||p.clock;
    const typeText=(p.type?.text||"").toLowerCase();
    const rawText=(p.text||p.shortText||"");
    // Skip plays nullified/aborted so they don't create phantom WP swings
    if(typeText.includes("aborted")) continue;
    if(/\bpenalty\b/i.test(rawText) && !/declined/i.test(rawText) && !/offsetting/i.test(rawText) && !/no play/i.test(rawText)) continue;
    if(/\(\s*no play\s*\)/i.test(rawText) || typeText.includes("no play")) continue;
    if(SKIP_TYPES.has(typeText)) continue;

    const sc=getScoresFromPlay(p,lastScore);
    if(sc) lastScore=sc;

    const possTeamId=getPossTeamId(p);
    const possIsHome=(possTeamId==null)?null:(possTeamId===homeId);
    const isNeutral=typeText.includes("kickoff")||typeText.includes("extra point")||typeText.includes("two-point");
    const effectivePoss=isNeutral?null:possIsHome;

    const possAbbr = possTeamId!=null ? id2abbr.get(String(possTeamId)) : null;
    const yardLine = p?.start?.yardLine || p?.start?.text || p?.start?.yardline;
    const yl100 = parseYardline100(yardLine, possAbbr);

    const down = p?.start?.down ?? p?.down ?? null;
    const distance = p?.start?.distance ?? p?.start?.yardsToGo ?? p?.distance ?? null;

    const wp = wpHomeFromStatePlus({
      homeScore:lastScore.homeScore,
      awayScore:lastScore.awayScore,
      possIsHome:effectivePoss,
      period:per,
      clock:clk,
      yardline100: yl100,
      down: (typeof down==="number"?down:null),
      distance: (typeof distance==="number"?distance:null),
    });

    if(!firstSet){prevWp=wp;firstSet=true;}
    const delta=wp-prevWp;
    const absDelta=Math.abs(delta);
    prevWp=wp;

    const rem=gameRemainingSec(per, clk);
    const elapsed=gameElapsedSec(per, clk);
    const text=normSpace(p.text||p.shortText||p.type?.text||"");

    series.push({
      wp, delta, absDelta,
      period:per,
      clock:clk,
      remSec:rem,
      tMin:(elapsed!=null?elapsed/60:null),
      text,
      teamId:possTeamId,
      homeScore:lastScore.homeScore,
      awayScore:lastScore.awayScore,
      type:(p.type?.text||""),
      tag:playTag(rawText, p.type?.text||"")
    });
  }

  if(series.length<10) return {series, stats:null};
  return {series, stats: computeWPStats(series)};
}

export function getWPSeriesPlus(d){
  return computeWPSeriesPlus(d);
}

// Compute statistics from WP series
function computeWPStats(series){
  let sumAbs=0, maxAbs=0, sumSq=0, crosses50=0, crosses4060=0, inDoubt=0;
  let lateAbs=0, lateMax=0;
  let prev=series[0].wp;
  const band=x=>x<0.4?-1:(x>0.6?1:0);
  let prevBand=band(prev);

  for(let i=1;i<series.length;i++){
    const cur=series[i].wp;
    const d=series[i].delta;
    const a=Math.abs(d);
    sumAbs+=a;
    sumSq+=a*a;
    maxAbs=Math.max(maxAbs,a);

    if((prev<0.5 && cur>=0.5) || (prev>0.5 && cur<=0.5)) crosses50++;

    const b=band(cur);
    if(b!==prevBand && (b===1 || b===-1) && (prevBand===1 || prevBand===-1)) crosses4060++;
    prevBand=b;

    if(cur>=0.2 && cur<=0.8) inDoubt++;

    const per=series[i].period;
    const rem=series[i].remSec;
    const isLate = (per===4 && rem!=null && rem<=480) || (per>4);
    if(isLate){
      lateAbs+=a;
      lateMax=Math.max(lateMax,a);
    }

    prev=cur;
  }

  const volatility=Math.sqrt(sumSq/Math.max(1,series.length-1));
  const doubtFrac=inDoubt/Math.max(1,series.length);

  return {
    sumAbsDelta:sumAbs,
    maxAbsDelta:maxAbs,
    volatility,
    crosses50,
    crosses4060,
    lateSumAbsDelta:lateAbs,
    lateMaxAbsDelta:lateMax,
    doubtFrac
  };
}

// ---------- WP-based excitement scoring ----------
function scale01(x,lo,hi){
  if(hi<=lo) return 0;
  return clamp((x-lo)/(hi-lo),0,1);
}
function scoreFrom01(frac,max){ return Math.round(clamp(frac,0,1)*max); }

function computeExcFromWP(g,d,wpStats){
  if(!wpStats){
    const ctxR=calcRivalry(g);
    const ctxS=calcStakes(g, d);
    const total=ctxR.score+ctxS.score;
    return {
      total,
      scores:{
        leverage:{score:0,max:35,name:"Leverage",desc:"How much win probability moved",detail:"Insufficient play-by-play"},
        swings:{score:0,max:15,name:"Swings",desc:"How often the game flipped",detail:"Insufficient play-by-play"},
        clutch:{score:0,max:15,name:"Clutch Time",desc:"Late leverage and high-stakes moments",detail:"Insufficient play-by-play"},
        control:{score:0,max:10,name:"In Doubt",desc:"How long the outcome stayed uncertain",detail:"Insufficient play-by-play"},
        chaos:{score:0,max:10,name:"Chaos",desc:"Turnovers/special teams that actually swung WP",detail:"Insufficient play-by-play"},
        contextR:ctxR,
        contextS:ctxS
      },
      wp: null
    };
  }

  const lev01 = scale01(wpStats.sumAbsDelta, 0.8, 2.8);
  const peak01 = scale01(wpStats.maxAbsDelta, 0.04, 0.25);
  const vol01  = scale01(wpStats.volatility, 0.02, 0.10);

  const swing01 = scale01(wpStats.crosses50 + 1.5*wpStats.crosses4060, 1, 10);

  const clutch01 = scale01(wpStats.lateSumAbsDelta + 2.0*wpStats.lateMaxAbsDelta, 0.15, 1.10);

  const doubt01 = scale01(wpStats.doubtFrac, 0.25, 0.85);

  const chaos01 = clamp(0.55*peak01 + 0.45*vol01, 0, 1);

  const ctxR = calcRivalry(g);
  const ctxS = calcStakes(g, d);

  const leverage = {
    score: scoreFrom01(0.65*lev01 + 0.35*peak01, 35),
    max:35,
    name:"Leverage",
    desc:"Total win-probability movement (|ΔWP|), with extra weight for peak moments",
    detail:`Σ|ΔWP|=${wpStats.sumAbsDelta.toFixed(2)}, max |ΔWP|=${wpStats.maxAbsDelta.toFixed(2)}`
  };
  const swings = {
    score: scoreFrom01(swing01, 15),
    max:15,
    name:"Swings",
    desc:"How often the game crossed the midline and swung between advantage states",
    detail:`50% crossings=${wpStats.crosses50}, 40/60 crossings=${wpStats.crosses4060}`
  };
  const clutch = {
    score: scoreFrom01(clutch01, 15),
    max:15,
    name:"Clutch Time",
    desc:"Late leverage (final 8:00 of 4Q + OT), where changes are most meaningful",
    detail:`Late Σ|ΔWP|=${wpStats.lateSumAbsDelta.toFixed(2)}, late peak=${wpStats.lateMaxAbsDelta.toFixed(2)}`
  };
  const control = {
    score: scoreFrom01(doubt01, 10),
    max:10,
    name:"In Doubt",
    desc:"How long the outcome stayed between 20% and 80% win probability",
    detail:`In-doubt share=${Math.round(wpStats.doubtFrac*100)}%`
  };
  const chaos = {
    score: scoreFrom01(chaos01, 10),
    max:10,
    name:"Chaos",
    desc:"Turnovers/special teams style volatility (proxied by peak+volatility)",
    detail:`Volatility=${wpStats.volatility.toFixed(3)}`
  };

  const coreTotal = leverage.score + swings.score + clutch.score + control.score + chaos.score;
  const ctxTotal  = clamp(ctxR.score + ctxS.score, 0, 16);
  const total = clamp(coreTotal + ctxTotal, 0, 100);

  return {
    total,
    scores:{leverage,swings,clutch,control,chaos,contextR:ctxR,contextS:ctxS},
    wp: wpStats
  };
}

export function computeExc(g,d){
  const {stats} = computeWPSeries(d);
  return computeExcFromWP(g,d,stats);
}

export function getWPSeries(d){
  return computeWPSeries(d);
}


// ---------- Summary data for recap generation ----------
function titleizePlay(t){
  t=normSpace(t);
  if(!t) return t;
  t=t.replace(/\(.*?shotgun.*?\)/ig,"").replace(/\s+/g," ").trim();
  t=t.replace(/\bTD\b/g,"touchdown");
  t=t.replace(/TOUCHDOWN/ig,"touchdown");
  return t;
}
function classifyArchetype(wpSeries){
  if(!wpSeries || wpSeries.length<10) return {type:"incomplete", label:"data-light"};
  const wps=wpSeries.map(x=>x.wp);
  const min=Math.min(...wps), max=Math.max(...wps);
  const end=wps[wps.length-1];
  const start=wps[0];

  const homeWins=end>=0.5;
  if(homeWins){
    if(min>=0.55) return {type:"wire", label:"wire-to-wire"};
    if(min<=0.25) return {type:"comeback", label:"comeback"};
  }else{
    if(max<=0.45) return {type:"wire", label:"wire-to-wire (away)"};
    if(max>=0.75) return {type:"collapse", label:"collapse"};
  }

  const crossings = wps.reduce((acc,cur,i)=>i?acc+(((wps[i-1]<0.5&&cur>=0.5)||(wps[i-1]>0.5&&cur<=0.5))?1:0):0,0);
  if(crossings>=4) return {type:"seesaw", label:"seesaw"};
  return {type:"tight", label:"tight finish"};
}

function getTopLeveragePlays(wpSeries, n=6){
  if(!wpSeries || wpSeries.length<2) return [];
  const scored = wpSeries
    .map((x,i)=>({...x, idx:i}))
    .filter(x=>x.absDelta!=null && x.text)
    .sort((a,b)=>b.absDelta-a.absDelta)
    .slice(0, n);
  scored.sort((a,b)=>a.idx-b.idx);
  return scored.map(x=>({
    period:x.period,
    clock:x.clock,
    tMin:x.tMin,
    absDelta:x.absDelta,
    delta:x.delta,
    wp:x.wp,
    homeScore:x.homeScore,
    awayScore:x.awayScore,
    text:titleizePlay(x.text),
    type:x.type||"",
    tag:x.tag||""
  }));
}

function inferRivalryNote(ctxR){
  if(!ctxR) return "";
  if(ctxR.score>=8) return "It had real rivalry electricity, the kind that turns routine plays into small arguments.";
  if(ctxR.score>=5) return "There was a familiar edge to it — not pure hate, but definitely not friendly.";
  if(ctxR.score>=3) return "A division matchup tends to bring a little extra, even when it's not a headline rivalry.";
  return "";
}
function inferStakesNote(ctxS){
  if(!ctxS) return "";
  if(ctxS.score>=8) return "The context made every mistake feel expensive, the way elimination games do.";
  if(ctxS.score>=6) return "It played like a game with actual standings weight, not just a Sunday result.";
  if(ctxS.score<=2) return "It didn't carry much external pressure — the drama had to be earned on the field.";
  return "";
}

// Build quarter-by-quarter scoring narrative from WP series
function buildQuarterNarrative(wpSeries, homeTeam, awayTeam){
  if(!wpSeries || wpSeries.length<10) return [];
  const quarters=[];
  for(let q=1;q<=4;q++){
    const qPlays=wpSeries.filter(s=>s.period===q);
    if(!qPlays.length) continue;
    const startWP=qPlays[0].wp;
    const endWP=qPlays[qPlays.length-1].wp;
    const shift=endWP-startWP;
    const startScore=qPlays[0];
    const endScore=qPlays[qPlays.length-1];
    const bigSwing=qPlays.reduce((mx,s)=>Math.abs(s.delta)>Math.abs(mx.delta)?s:mx,{delta:0});
    quarters.push({q,startWP,endWP,shift,
      startHS:startScore.homeScore,startAS:startScore.awayScore,
      endHS:endScore.homeScore,endAS:endScore.awayScore,
      bigSwing:bigSwing.absDelta>0.03?bigSwing:null});
  }
  // OT
  const otPlays=wpSeries.filter(s=>s.period>4);
  if(otPlays.length>2){
    const startWP=otPlays[0].wp;
    const endWP=otPlays[otPlays.length-1].wp;
    quarters.push({q:5,startWP,endWP,shift:endWP-startWP,
      startHS:otPlays[0].homeScore,startAS:otPlays[0].awayScore,
      endHS:otPlays[otPlays.length-1].homeScore,endAS:otPlays[otPlays.length-1].awayScore,
      bigSwing:null});
  }
  return quarters;
}

// Build richer top leverage plays with team attribution
function enrichTopPlays(topLev, homeTeam, awayTeam, homeId){
  return topLev.map(tp=>{
    const favoredHome=tp.delta>=0;
    const beneficiary=favoredHome?tn(homeTeam):tn(awayTeam);
    const victim=favoredHome?tn(awayTeam):tn(homeTeam);
    const per=tp.period<=4?`Q${tp.period}`:"OT";
    const wpPct=Math.round(tp.wp*100);
    const swingPct=Math.round(tp.absDelta*100);
    return {...tp, beneficiary, victim, perLabel:per, wpPct, swingPct};
  });
}

// Extract scoring plays from drives for narrative color
function extractScoringPlays(d){
  const drives=d?.drives?.previous||[];
  const scores=[];
  for(const dr of drives){
    const team=dr?.team?.abbreviation||"";
    const result=(dr.displayResult||dr.result||"").toLowerCase();
    if(result.includes("touchdown")||result.includes("field goal")){
      const plays=dr.plays||[];
      const last=plays[plays.length-1];
      if(last){
        scores.push({
          team,
          type:result.includes("touchdown")?"TD":"FG",
          text:normSpace(last.text||last.shortText||""),
          period:last.period?.number||0,
          clock:last.clock?.displayValue||"",
          homeScore:last.homeScore,
          awayScore:last.awayScore
        });
      }
    }
  }
  return scores;
}

export function buildSummaryData(g,d,exc){
  const homeId=getHomeTeamId(d);
  const {series:wpSeries, stats:wpStats} = computeWPSeries(d);
  const archetype = classifyArchetype(wpSeries);
  const topLev = getTopLeveragePlays(wpSeries, 6);

  const box=buildBox(d);
  const pStats=buildPlayerStats(d);

  const leaders=[];
  for(const p of(pStats.passing||[]))leaders.push({name:p.name,team:p.team,line:`${p["C/ATT"]||"?"} for ${p.YDS||0} yards, ${p.TD||0} TD, ${p.INT||0} INT`,type:"passing",yds:+(p.YDS||0),td:+(p.TD||0)});
  for(const p of(pStats.rushing||[]).slice(0,2))leaders.push({name:p.name,team:p.team,line:`${p.CAR||"?"} carries, ${p.YDS||0} yards, ${p.TD||0} TD`,type:"rushing",yds:+(p.YDS||0),td:+(p.TD||0)});
  for(const p of(pStats.receiving||[]).slice(0,3))leaders.push({name:p.name,team:p.team,line:`${p.REC||"?"} catches, ${p.YDS||0} yards, ${p.TD||0} TD`,type:"receiving",yds:+(p.YDS||0),td:+(p.TD||0)});

  // Legacy format for backward compat
  const leaderStrings=leaders.map(l=>`${l.name} (${l.team}): ${l.line}`);

  const enrichedPlays = enrichTopPlays(topLev, g.ht, g.at, homeId);
  const quarterNarr = buildQuarterNarrative(wpSeries, g.ht, g.at);
  const scoringPlays = extractScoringPlays(d);

  // Compute margin trajectory: who led at end of each quarter
  const marginByQ=quarterNarr.map(q=>({q:q.q, lead:q.endHS-q.endAS, hs:q.endHS, as:q.endAS}));

  // Max deficit for winner
  const winner = g.hs>g.as ? "home" : "away";
  let maxWinnerDeficit=0;
  for(const s of (wpSeries||[])){
    const diff=s.homeScore-s.awayScore;
    if(winner==="home" && diff<0) maxWinnerDeficit=Math.max(maxWinnerDeficit, Math.abs(diff));
    if(winner==="away" && diff>0) maxWinnerDeficit=Math.max(maxWinnerDeficit, diff);
  }

  const ctxR = exc?.scores?.contextR;
  const ctxS = exc?.scores?.contextS;

  const rivalryNote = inferRivalryNote(ctxR);
  const stakesNote  = inferStakesNote(ctxS);

  // Did the game have OT?
  const hasOT = (wpSeries||[]).some(s=>s.period>4);
  // Final margin
  const finalMargin = Math.abs(g.hs-g.as);

  // Playoff round label
  let playoffRound="";
  if(g.season?.type===3){
    const pwk=g.week?.number||0;
    if(pwk===1)playoffRound="Wild Card";
    else if(pwk===2)playoffRound="Wild Card";
    else if(pwk===3)playoffRound="Divisional Round";
    else if(pwk===4)playoffRound="Conference Championship";
    else if(pwk===5)playoffRound="Super Bowl";
  }

  // Extract notable non-scoring plays: turnovers, 4th downs, sacks, big gains
  const allPlays=getAllPlays(d);
  const notablePlays=[];
  for(const p of allPlays){
    const txt=normSpace(p.text||p.shortText||"");
    const lo=txt.toLowerCase();
    const ty=(p.type?.text||"").toLowerCase();
    if(lo.includes("(no play)")) continue;
    const yds=p.statYardage||0;
    const per=p.period?.number||0;
    const clk=p.clock?.displayValue||"";
    const team=p.team?.abbreviation||p._driveTeamId||"";
    if(lo.includes("intercept")||ty.includes("interception")){
      notablePlays.push({type:"INT",text:txt,period:per,clock:clk,team,yds});
    } else if(lo.includes("fumble")){
      // Only treat as a turnover if the recovery team is different than the offense team.
      const mrec = txt.match(/recovered by\s+([A-Z]{2,4})\b/i);
      const rec = mrec ? mrec[1] : null;
      if(rec && team && rec !== team){
        notablePlays.push({type:"FUM",text:txt,period:per,clock:clk,team,yds,recoveredBy:rec});
      }
    } else if(/4th\s+and/i.test(lo) && !ty.includes("punt") && !ty.includes("field goal")){
      // Include all 4th-down attempts; success/fail is inferred later.
      notablePlays.push({type:"4TH_ATT",text:txt,period:per,clock:clk,team,yds});
    } else if(ty.includes("turnover on downs")||lo.includes("turnover on downs")){
      notablePlays.push({type:"4TH_FAIL",text:txt,period:per,clock:clk,team,yds});
    } else if(lo.includes("sacked")&&(lo.includes("3rd")||per>=4)){
      notablePlays.push({type:"SACK",text:txt,period:per,clock:clk,team,yds});
    } else if(yds>=40&&!lo.includes("punt")&&!lo.includes("kickoff")){
      notablePlays.push({type:"BIG",text:txt,period:per,clock:clk,team,yds});
    }
  }

  // Performance analysis — identify standouts and disappointments
  const performanceNotes=[];
  for(const l of leaders){
    if(l.type==="passing"){
      if(l.td>=3&&l.yds>=300) performanceNotes.push({name:l.name,team:l.team,note:"dominant",line:l.line});
      else if(l.td===0&&l.line.includes("INT")&&+(l.line.match(/(\d+) INT/)||[])[1]>=2)
        performanceNotes.push({name:l.name,team:l.team,note:"struggled",line:l.line});
    }
    if(l.type==="rushing"&&l.yds>=120) performanceNotes.push({name:l.name,team:l.team,note:"standout",line:l.line});
    if(l.type==="receiving"&&l.yds>=120) performanceNotes.push({name:l.name,team:l.team,note:"standout",line:l.line});
  }

  // Context stakes detail from engine
  const stakesDetail=exc?.scores?.contextS?.detail||"";

  return{
    matchup:`${tn(g.at)} at ${tn(g.ht)}`,
    awayTeam:g.at,homeTeam:g.ht,
    awayName:tn(g.at),homeName:tn(g.ht),
    winnerName: g.hs>g.as ? tn(g.ht) : tn(g.at),
    loserName: g.hs>g.as ? tn(g.at) : tn(g.ht),
    winnerAbbr: g.hs>g.as ? g.ht : g.at,
    loserAbbr: g.hs>g.as ? g.at : g.ht,
    finalScore:`${tn(g.at)} ${g.as}, ${tn(g.ht)} ${g.hs}`,
    awayScore:g.as, homeScore:g.hs,
    awayRecord:g.ar,homeRecord:g.hr,
    finalMargin,
    maxWinnerDeficit,
    hasOT,
    date:new Date(g.date).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}),
    venue:g.ven,attendance:g.att,
    context:g.season?.type===3?"Playoff game":`${g.season?.year} Season, Week ${g.week?.number}`,
    boxScore:box.map(r=>`${r.team}: ${r.qs.join(" | ")} = ${r.total}`).join("\n"),
    playerLeaders:leaderStrings,
    leaders,
    archetype,
    topLeveragePlays: topLev,
    enrichedPlays,
    quarterNarrative: quarterNarr,
    marginByQ,
    scoringPlays,
    notablePlays,
    performanceNotes,
    stakesDetail,
    playoffRound,
    rivalryNote,
    stakesNote,
    wpStats,
    excitementScore:exc.total,
    excitementVerdict:oGrade(exc.total).l,
  };
}
