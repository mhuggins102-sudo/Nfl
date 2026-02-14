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
    // Add 1-second gap so OT plays never overlap with Q4-end plays on the chart
    base=3601 + (p-5)*periodLengthSec(5);
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
    if(!labels)return o;
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
  const id2abbr=teamIdToAbbrMap(d);

  // Build WP map for impact scoring
  const {series:wpSeries}=computeWPSeries(d);
  const wpByKey=new Map();
  for(const s of (wpSeries||[])){
    if(s.tMin!=null) wpByKey.set(`${s.period}|${s.clock}`, s);
  }

  const cats=[];
  for(const p of plays){
    const raw=p.text||"";
    const lo=raw.toLowerCase();
    const ty=(p.type?.text||"").toLowerCase();
    const y=p.statYardage||0;
    const period=p.period?.number||0;
    const clock=p.clock?.displayValue||"";
    const down=p.start?.down??p.down??null;

    // SKIP non-plays: penalties, timeouts, two-minute warning, end-of-period markers
    if(lo.includes("no play")||ty.includes("penalty")) continue;
    if(ty.includes("timeout")||ty.includes("two-minute")||ty==="end period"||ty==="end of half"||ty==="end of game") continue;
    if(lo.includes("two-minute warning")||lo.includes("timeout")) continue;

    let tag=null;
    // Scoring plays (TD, FG, safety)
    if(lo.includes("touchdown")||lo.includes(" td ")||ty.includes("touchdown")) tag="TD";
    else if(ty.includes("field goal")&&!ty.includes("missed")&&lo.includes("good")) tag="FG";
    else if(lo.includes("safety")||ty.includes("safety")) tag="SP";
    // Two-point conversions
    else if(ty.includes("two-point")||lo.includes("two-point")||lo.includes("2-point")) tag="TD";
    // Turnovers — must verify possession actually changed
    else if(lo.includes("intercept")||ty.includes("interception")) tag="TO";
    else if(lo.includes("fumble")){
      // Only tag as turnover if recovered by a different team.
      // Use drive team ID → abbreviation mapping for reliable comparison.
      const recMatch=raw.match(/recovered\s+by\s+([A-Z]{2,4})[\s-]/i)||raw.match(/RECOVERED\s+([A-Z]{2,4})\b/i);
      const recTeamAbbr=recMatch?recMatch[1]:null;
      // Determine the offensive team: prefer drive team abbreviation, fall back to play team
      const driveAbbr=(p._driveTeamId!=null)?id2abbr.get(String(p._driveTeamId)):null;
      const offTeam=driveAbbr||p.team?.abbreviation||"";
      // Self-recovery patterns: "and recovers", "recovers at", offensive player recovering own fumble
      const selfRec=/\band\s+recovers\b|\brecovers\s+at\b|\brecovery\s+by\s+\S+\s+at\b/i.test(raw);
      if(recTeamAbbr&&offTeam&&recTeamAbbr!==offTeam&&!selfRec) tag="TO";
      // If no recovery team found or same team recovered, it's not a turnover — skip
    }
    else if(ty.includes("turnover on downs")) tag="TO";
    // Blocked kicks
    else if(lo.includes("blocked")&&(lo.includes("punt")||lo.includes("field goal")||lo.includes("kick"))) tag="SP";
    // 4th down attempts — use play metadata (down===4) OR text pattern
    else if((down===4||lo.includes("4th and"))&&!ty.includes("punt")&&!ty.includes("field goal")&&!ty.includes("penalty")) tag="4D";
    // Missed FG
    else if(ty.includes("missed field goal")||lo.includes("field goal no good")||lo.includes("missed")) tag="CL";
    // Big plays (30+ yards for scrimmage plays, not punts/kicks)
    else if(y>=30&&!lo.includes("punt")&&!lo.includes("kickoff")) tag="BG";

    if(tag){
      const hs=p.homeScore!=null?+p.homeScore:null;
      const as=p.awayScore!=null?+p.awayScore:null;
      // Find WP impact for this play
      const wpEntry=wpByKey.get(`${period}|${clock}`);
      const wpSwing=wpEntry?Math.abs(wpEntry.delta||0):0;
      cats.push({tag,text:titleizePlay(raw),period,clock,homeScore:hs,awayScore:as,wpSwing});
    }
  }
  // Deduplicate
  const uniq=[];const seen=new Set();
  for(const x of cats){
    const k=x.tag+"|"+x.period+"|"+x.clock+"|"+(x.text||"").slice(0,40);
    if(seen.has(k))continue;
    seen.add(k);uniq.push(x);
  }
  // Keep chronological order — key plays tell a story
  return uniq.slice(0,25);
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
function sameConf(a,b){
  const da=getDiv(a),db=getDiv(b);
  if(!da||!db)return false;
  return da.slice(0,3)===db.slice(0,3); // AFC_ or NFC_
}

function calcRivalry(g){
  const hardcoded=rivBase(g.ht,g.at);
  let rb=hardcoded;
  const isDivRival=divRivals(g.ht,g.at);
  if(isDivRival&&rb<3)rb=3;

  const hr=parseRec(g.hr),ar=parseRec(g.ar);
  let hPct=0, aPct=0;
  if(hr&&ar){
    hPct=hr.w/(hr.w+hr.l+hr.t||1);
    aPct=ar.w/(ar.w+ar.l+ar.t||1);
  }

  // Recent contenders: both teams with strong records in same conference
  // Rivalry is era-dependent — two teams may be fierce rivals one decade and
  // irrelevant to each other the next. We use current-season records as a proxy
  // for whether these teams are in each other's orbit RIGHT NOW.
  const bothStrong = hPct>=.55 && aPct>=.55;
  const bothElite = hPct>=.65 && aPct>=.65;
  const isConfMatch = sameConf(g.ht,g.at);
  let boostSource=null; // track where the score came from

  if(bothElite && isConfMatch && !isDivRival){
    rb=Math.max(rb, 5);
    rb=Math.min(rb+3, 10);
    if(hardcoded<6) boostSource="confElite";
  } else if(bothElite){
    rb=Math.min(rb+2, 10);
    if(hardcoded<6) boostSource="crossElite";
  } else if(bothStrong && isConfMatch && !isDivRival){
    rb=Math.max(rb, 4);
    rb=Math.min(rb+2, 10);
    if(hardcoded<5) boostSource="confStrong";
  } else if(bothStrong){
    rb=Math.min(rb+1, 10);
  }

  if(g.season?.type===3){ rb=Math.max(rb,5); rb=Math.min(rb+1,10); }

  const score=clamp(rb,0,10);
  // Detail label reflects the SOURCE of the rivalry — hardcoded history vs. current-era context
  let detail;
  if(hardcoded>=8) detail="Storied rivalry";
  else if(hardcoded>=6 && isDivRival) detail="Division rivalry";
  else if(hardcoded>=6) detail="Historic rivalry";
  else if(boostSource==="confElite") detail="Conference contenders — both elite teams competing for the same playoff path this season";
  else if(boostSource==="crossElite") detail="Cross-conference showdown — both among the league's best this season";
  else if(boostSource==="confStrong") detail="Emerging conference rivals — both strong teams in the same conference this season";
  else if(rb>=5 && isDivRival) detail="Division rivalry";
  else if(rb>=5) detail="Notable rivalry / high familiarity";
  else if(rb>=3 && isDivRival) detail="Division familiarity";
  else if(rb>=3 && bothStrong) detail="Competitive matchup";
  else detail="Non-rivalry";
  return{score,max:10,name:"Context: Rivalry",desc:"History, familiarity, and recent competitive overlap",detail,_boostSource:boostSource,_hardcoded:hardcoded};
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


export function playTag(text,type,driveTeamAbbr){
  const lo=(text||"").toLowerCase();
  const ty=(type||"").toLowerCase();
  if(lo.includes("intercept")||ty.includes("interception")) return "TO";
  if(lo.includes("turnover on downs")||ty.includes("turnover on downs")) return "TO";
  if(lo.includes("fumble")){
    // Only tag as turnover if recovered by a DIFFERENT team than offense.
    const selfRec = /\band\s+recovers\b|\brecovers\s+at\b/i.test(text||"");
    if(selfRec) { /* self-recovery, not a turnover */ }
    else {
      const recMatch=(text||"").match(/recovered\s+by\s+([A-Z]{2,4})[\s-]/i)||(text||"").match(/RECOVERED\s+([A-Z]{2,4})\b/i);
      const recAbbr=recMatch?recMatch[1]:null;
      if(recAbbr&&driveTeamAbbr&&recAbbr===driveTeamAbbr) { /* same team recovered, not a turnover */ }
      else if(recAbbr) return "TO"; // different team or unknown offense
    }
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
  const id2abbr=teamIdToAbbrMap(d);

  // Prefer ESPN win probability when available (0-1 home win pct)
  const wpMap=new Map();
  const wpArr=d?.winprobability||d?.winProbability||[];
  if(Array.isArray(wpArr)){
    for(const w of wpArr){
      const pid=(w?.playId!=null)?String(w.playId):null;
      const hp=w?.homeWinPercentage;
      if(pid && typeof hp==="number"){ let v=hp; if(v>1.01) v=v/100; v=Math.max(0,Math.min(1,v)); wpMap.set(pid, v); }
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
      tag:playTag(p.text||p.shortText||"", p.type?.text||"", (p._driveTeamId!=null?id2abbr.get(String(p._driveTeamId)):null)||p.team?.abbreviation||"")
    });
  }

  if(series.length<10) return {series, stats:null};
  return {series, stats: computeWPStats(series)};
}


// ── nflfastR-inspired WP model ──
// Modeled after the nflfastR XGBoost approach by Ben Baldwin (nflverse).
// Uses the same feature engineering — especially the Diff_Time_Ratio exponential
// time-amplification of score differential — to approximate XGBoost WP output
// via a calibrated multi-term logistic regression.
//
// Key insight from nflfastR: Diff_Time_Ratio = score_diff * exp(4 * elapsed_share)
// This makes a 7-point lead at game start worth ~7, but near game end worth ~382,
// capturing the nonlinear relationship between score differential and WP as time expires.
//
// Features used (matching nflfastR):
//   - score_differential (possession team perspective)
//   - Diff_Time_Ratio (exponentially time-weighted score diff)
//   - game_seconds_remaining
//   - half_seconds_remaining
//   - home (binary)
//   - yardline_100 (yards from opponent end zone, 1-99)
//   - down (1-4)
//   - ydstogo (yards to first down)
//   - posteam_timeouts_remaining (0-3)
//   - defteam_timeouts_remaining (0-3)
//   - receive_2h_ko (binary: possession team gets 2nd half kickoff)
//
// Coefficients calibrated against known NFL WP benchmarks and nflfastR output:
//   Tied at half → 50%, Up 7 at half → 73%, Up 14 at half → 89%
//   Up 7 w/ 5min left → 90%, Up 7 w/ 2min left → 96%
//   Up 3 at half → 62%, Up 3 w/ 5min left → 80%
//   1st-and-10 at opp 20 worth ~2.5 WP points more than midfield
//   Each timeout worth ~1-3 WP points late in the game
function wpNflfastR(state){
  const {homeScore, awayScore, possIsHome, period, clock,
         yardline100, down, distance,
         possTimeouts, defTimeouts, receive2hKO} = state||{};

  // Convert to possession-team perspective (nflfastR convention)
  const sd = possIsHome===true ? (homeScore||0)-(awayScore||0)
           : possIsHome===false ? (awayScore||0)-(homeScore||0)
           : (homeScore||0)-(awayScore||0); // fallback: home perspective

  const gameSecRem = gameRemainingSec(period||1, clock);
  const gsr = (gameSecRem==null) ? 1800 : Math.max(gameSecRem, 1);

  // Half seconds remaining
  const per = period||1;
  const clockSec = parseClockToSeconds(clock);
  let halfSecRem;
  if(clockSec==null) halfSecRem = 900;
  else if(per<=2) halfSecRem = (2-per)*900 + clockSec;
  else if(per<=4) halfSecRem = (4-per)*900 + clockSec;
  else halfSecRem = clockSec; // OT

  // nflfastR feature engineering
  const elapsedShare = (3600 - gsr) / 3600; // 0 at start, 1 at end

  // Home field indicator (from possession team's perspective)
  const home = possIsHome===true ? 1 : possIsHome===false ? 0 : 0.5;

  // Field position: yardline_100 = yards from opponent end zone (lower = closer to scoring)
  const yl100 = (typeof yardline100==="number" && isFinite(yardline100)) ? yardline100 : 50;

  // Down and distance
  const dn = (typeof down==="number" && down>=1 && down<=4) ? down : 1;
  const ytg = (typeof distance==="number" && isFinite(distance)) ? Math.min(30, Math.max(1, distance)) : 10;

  // Timeouts
  const posTO = (typeof possTimeouts==="number") ? clamp(possTimeouts, 0, 3) : 3;
  const defTO = (typeof defTimeouts==="number") ? clamp(defTimeouts, 0, 3) : 3;

  // Receive 2nd half kickoff (matters in 1st half only)
  const r2h = (per<=2 && receive2hKO===true) ? 1 : 0;

  // ── Calibrated logistic model ──
  // The nflfastR XGBoost uses tree ensembles that implicitly capture nonlinear
  // time-score interactions. We approximate this with a polynomial time-weighted
  // score coefficient, calibrated against known WP benchmarks:
  //   Kick → up 7 ≈ 60%, Half → up 7 ≈ 73%, 5min → up 7 ≈ 90%, 2min → up 7 ≈ 96%
  //
  // sdCoeff(es) = polynomial in elapsed_share, plus late-game urgency boost
  const es = elapsedShare;
  const es2 = es * es;
  const es4 = es2 * es2;

  // Base time-weighted score coefficient (per point of score differential)
  // Polynomial calibrated to match nflfastR output at key game states
  let sdCoeff = 0.052 + 0.048 * es + 0.155 * es2 + 0.115 * es4;

  // Extra urgency in final 5 minutes: score diffs become near-insurmountable
  if(gsr <= 300) sdCoeff += ((300 - gsr) / 300) * 0.22;
  // Final 90 seconds: kneeling scenarios make leads virtually insurmountable
  // A team leading with possession and <90 seconds can often run out the clock
  if(gsr <= 90 && sd > 0) sdCoeff += ((90 - gsr) / 90) * 0.80;
  // Trailing with possession in final 3 minutes: real comeback chance
  // XGBoost trees capture this naturally; logistic model needs an explicit adjustment
  // A team down 3 with 1 min and the ball can realistically drive for a FG
  if(gsr <= 180 && sd < 0 && sd >= -8) sdCoeff *= (0.60 + 0.40 * (gsr / 180));

  const HOME_COEFF = 0.12;    // Home field ~3% advantage

  // Field position: closer to opponent EZ = more valuable
  // Midfield (50) → 0 effect, goal-to-go (5) → +0.25, own 20 (80) → -0.17
  const FP_COEFF = -0.0056;
  const fpEffect = FP_COEFF * (yl100 - 50);

  // Down and distance: 1st-and-10 best, 4th-and-long worst
  // Effect amplified late in game (matching nflfastR monotone constraints)
  const lateAmp = 1 + 1.5 * es;
  const downPenalty = ((dn - 1) * 0.06 + (dn >= 3 ? (ytg / 10) * 0.04 : 0)) * lateAmp;

  // Timeouts: each worth ~1-3% late in the game
  // nflfastR enforces monotone constraints: more own timeouts always helps
  const toEffect = (posTO - defTO) * 0.04 * lateAmp;

  // 2nd half kickoff: worth ~1-2% in first half (deferred value)
  const r2hEffect = r2h * 0.08;

  // Combine all terms
  let logit = sdCoeff * sd
            + HOME_COEFF * home
            + fpEffect
            - downPenalty
            + toEffect
            + r2hEffect;

  // Overtime: compress toward 50% since OT rules create near-coin-flip dynamics
  if(per > 4){
    logit *= 0.55;
    // In OT, possession is crucial (coin flip winner gets first possession)
    if(possIsHome===true || possIsHome===false){
      logit += 0.25; // Having the ball in OT is a significant advantage
    }
  }

  // Apply sigmoid and convert back to home WP
  let wpPoss = 1 / (1 + Math.exp(-logit));
  wpPoss = Math.max(0.005, Math.min(0.995, wpPoss));

  // Convert from possession-team WP to home-team WP
  if(possIsHome===true) return wpPoss;
  if(possIsHome===false) return 1 - wpPoss;
  return wpPoss; // Unknown possession: treat as home
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

  // Track timeouts for nflfastR model
  let homeTimeouts=3, awayTimeouts=3;
  let lastHalfReset=0; // track which half we last reset timeouts

  // Determine which team receives 2nd half kickoff
  // The team on defense first (kickoff team) will receive in the 2nd half
  let receive2hKOTeamId=null;
  for(const p of plays){
    const ty=(p.type?.text||"").toLowerCase();
    if(ty.includes("kickoff") && p.period?.number===1){
      // The receiving team has possession; the kicking team gets 2nd half kickoff
      const kickTeamId=getPossTeamId(p);
      if(kickTeamId) receive2hKOTeamId = (kickTeamId===homeId) ? "away" : "home";
      break;
    }
  }

  let lastScore={homeScore:0,awayScore:0};
  let prevWp=0.5;
  const series=[];
  let firstSet=false;

  for(const p of plays){
    const per=p.period?.number||1;
    const clk=p.clock?.displayValue||p.clock?.value||p.clock;
    const typeText=(p.type?.text||"").toLowerCase();
    const rawText=(p.text||p.shortText||"");

    // Reset timeouts at halftime
    if(per>=3 && lastHalfReset<2){ homeTimeouts=3; awayTimeouts=3; lastHalfReset=2; }

    // Track timeout usage from play type
    if(typeText.includes("timeout")){
      const tText=(rawText||"").toLowerCase();
      // Try to determine which team called timeout
      const possTeamId=getPossTeamId(p);
      const possAbbr=possTeamId!=null?id2abbr.get(String(possTeamId)):null;
      if(possAbbr){
        // Check if the timeout text mentions a specific team
        const isHome=(possTeamId===homeId);
        if(isHome && homeTimeouts>0) homeTimeouts--;
        else if(!isHome && awayTimeouts>0) awayTimeouts--;
      }
      continue; // Skip timeout plays from WP series
    }

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

    // Determine if possession team receives 2nd half kickoff
    const possR2h = (effectivePoss===true && receive2hKOTeamId==="home")
                 || (effectivePoss===false && receive2hKOTeamId==="away");

    const wp = wpNflfastR({
      homeScore:lastScore.homeScore,
      awayScore:lastScore.awayScore,
      possIsHome:effectivePoss,
      period:per,
      clock:clk,
      yardline100: yl100,
      down: (typeof down==="number"?down:null),
      distance: (typeof distance==="number"?distance:null),
      possTimeouts: effectivePoss===true ? homeTimeouts : effectivePoss===false ? awayTimeouts : null,
      defTimeouts: effectivePoss===true ? awayTimeouts : effectivePoss===false ? homeTimeouts : null,
      receive2hKO: possR2h,
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
      tag:playTag(rawText, p.type?.text||"", possAbbr||"")
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

  // Track min WP for each side (for comeback factor)
  let minWP=series[0].wp, maxWP=series[0].wp;

  // Track turnovers and special teams plays directly
  let turnovers=0, stPlays=0, pickSixes=0, fumbleTDs=0, returnTDs=0;

  // Track final scoring plays for dramatic finish detection
  let lastScoringPlay=null;
  let prevScore={h:series[0].homeScore||0, a:series[0].awayScore||0};

  for(let i=1;i<series.length;i++){
    const cur=series[i].wp;
    const d=series[i].delta;
    const a=Math.abs(d);
    sumAbs+=a;
    sumSq+=a*a;
    maxAbs=Math.max(maxAbs,a);

    minWP=Math.min(minWP,cur);
    maxWP=Math.max(maxWP,cur);

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

    // Count turnovers and special teams directly from tags
    const tag=series[i].tag;
    const lo=(series[i].text||"").toLowerCase();
    if(tag==="TO") turnovers++;
    if(tag==="SP") stPlays++;
    // Detect pick-sixes, fumble-return TDs, kick/punt return TDs
    if(tag==="TO" && lo.includes("touchdown")) pickSixes++;
    if(lo.includes("fumble") && lo.includes("touchdown") && tag==="TO") fumbleTDs++;
    if((lo.includes("kickoff")||lo.includes("punt")) && lo.includes("touchdown") && !lo.includes("no play")) returnTDs++;

    // Track scoring changes for dramatic finish
    const curH=series[i].homeScore||0, curA=series[i].awayScore||0;
    if(curH!==prevScore.h || curA!==prevScore.a){
      lastScoringPlay={period:per, remSec:rem, homeScore:curH, awayScore:curA,
        prevHomeScore:prevScore.h, prevAwayScore:prevScore.a, text:series[i].text||"",
        wp:cur, tag, idx:i};
      prevScore={h:curH, a:curA};
    }

    prev=cur;
  }

  const volatility=Math.sqrt(sumSq/Math.max(1,series.length-1));
  const doubtFrac=inDoubt/Math.max(1,series.length);

  // Determine if game ended in OT
  const hasOT=series.some(s=>s.period>4);
  // Final score
  const lastPlay=series[series.length-1];
  const finalH=lastPlay.homeScore||0, finalA=lastPlay.awayScore||0;
  const homeWon=finalH>finalA;

  // Comeback factor: 1 / (winner's lowest WP during the game)
  // If home won, winner's lowest = minWP. If away won, winner's lowest = 1 - maxWP.
  const winnerLowestWP = homeWon ? minWP : (1 - maxWP);
  const comebackFactor = winnerLowestWP > 0.001 ? (1 / winnerLowestWP) : 100;

  // Dramatic finish: analyze how the game ended
  let dramaticFinish = {walkOff:false, goAheadFinal2Min:false, finalPlayScore:false, otWinner:false, gameEndingStop:false, margin:Math.abs(finalH-finalA)};

  // Check if the last scoring play was a dramatic go-ahead / walk-off
  if(lastScoringPlay){
    const sp=lastScoringPlay;
    const wasGoAhead = (homeWon && sp.prevHomeScore <= sp.prevAwayScore) || (!homeWon && sp.prevAwayScore <= sp.prevHomeScore);
    const inFinal2Min = sp.period===4 && sp.remSec!=null && sp.remSec<=120;
    const inFinal30Sec = sp.period===4 && sp.remSec!=null && sp.remSec<=30;
    const isOT = sp.period>4;
    if(wasGoAhead && (inFinal30Sec || isOT)) dramaticFinish.walkOff=true;
    if(wasGoAhead && inFinal2Min) dramaticFinish.goAheadFinal2Min=true;
    if(isOT && wasGoAhead) dramaticFinish.otWinner=true;
    if(sp.idx >= series.length-3) dramaticFinish.finalPlayScore=true;
  }

  // Check for game-ending defensive stops on the final plays
  // (blocked kicks, missed FGs, interceptions, failed conversions, turnover on downs)
  const margin = Math.abs(finalH-finalA);
  if(margin <= 8){ // Only check close games
    // Look at the last few plays in the series for defensive stops
    const tail = series.slice(Math.max(0, series.length-5));
    for(const tp of tail){
      const txt=(tp.text||"").toLowerCase();
      const isLateGame = (tp.period===4 && tp.remSec!=null && tp.remSec<=30) || (tp.period>4);
      if(!isLateGame) continue;
      // Blocked kick/punt that ends the game
      if(txt.includes("blocked")) { dramaticFinish.gameEndingStop=true; dramaticFinish.finalPlayScore=true; }
      // Missed field goal on potential tying/winning attempt
      else if((txt.includes("field goal") || txt.includes("extra point")) && (txt.includes("no good") || txt.includes("missed") || txt.includes("wide"))) { dramaticFinish.gameEndingStop=true; dramaticFinish.finalPlayScore=true; }
      // Interception on final drive
      else if(txt.includes("intercept") && tp.remSec!=null && tp.remSec<=15) { dramaticFinish.gameEndingStop=true; }
      // Turnover on downs on final play
      else if(txt.includes("turnover on downs")) { dramaticFinish.gameEndingStop=true; dramaticFinish.finalPlayScore=true; }
      // Failed two-point conversion
      else if(txt.includes("two-point") && (txt.includes("fail") || txt.includes("no good") || txt.includes("incomplete"))) { dramaticFinish.gameEndingStop=true; }
      // Hail mary / final play incomplete pass
      else if(tp.remSec!=null && tp.remSec<=5 && txt.includes("incomplete") && margin<=3) { dramaticFinish.gameEndingStop=true; dramaticFinish.finalPlayScore=true; }
    }
  }

  return {
    sumAbsDelta:sumAbs,
    maxAbsDelta:maxAbs,
    volatility,
    crosses50,
    crosses4060,
    lateSumAbsDelta:lateAbs,
    lateMaxAbsDelta:lateMax,
    doubtFrac,
    // New fields
    minWP, maxWP,
    comebackFactor,
    turnovers, stPlays, pickSixes, fumbleTDs, returnTDs,
    dramaticFinish,
    hasOT
  };
}

// ---------- WP-based excitement scoring ----------
function scale01(x,lo,hi){
  if(hi<=lo) return 0;
  return clamp((x-lo)/(hi-lo),0,1);
}
function scoreFrom01(frac,max){ return Math.round(clamp(frac,0,1)*max); }

function countTurnoversFromPlays(d){
  // Direct turnover/ST counting from play-by-play for Chaos category
  const plays=getAllPlays(d);
  const id2abbr=teamIdToAbbrMap(d);
  let turnovers=0, stTDs=0, pickSixes=0;
  for(const p of plays){
    const txt=(p.text||p.shortText||"").toLowerCase();
    const ty=(p.type?.text||"").toLowerCase();
    if(ty.includes("timeout")||ty.includes("two-minute")||ty==="end period") continue;
    // Interceptions
    if(txt.includes("intercept")||ty.includes("interception")){
      turnovers++;
      if(txt.includes("touchdown")) pickSixes++;
    }
    // Fumbles recovered by opponent
    else if(txt.includes("fumble")){
      const driveAbbr=(p._driveTeamId!=null)?id2abbr.get(String(p._driveTeamId)):null;
      const recMatch=txt.match(/recovered\s+by\s+([a-z]{2,4})[\s-]/i);
      const recTeam=recMatch?recMatch[1].toUpperCase():null;
      const offTeam=(driveAbbr||p.team?.abbreviation||"").toUpperCase();
      if(recTeam&&offTeam&&recTeam!==offTeam){
        turnovers++;
        if(txt.includes("touchdown")) pickSixes++;
      }
    }
    else if(ty.includes("turnover on downs")) turnovers++;
    // Special teams TDs
    if((txt.includes("kickoff")||txt.includes("punt return"))&&txt.includes("touchdown")&&!txt.includes("no play")) stTDs++;
    if(txt.includes("blocked")&&txt.includes("touchdown")) stTDs++;
  }
  return {turnovers, stTDs, pickSixes};
}

function computeExcFromWP(g,d,wpStats){
  const noData="Insufficient play-by-play";
  if(!wpStats){
    const ctxR=calcRivalry(g);
    const ctxS=calcStakes(g, d);
    const ctxScore=clamp(ctxR.score+ctxS.score,0,15);
    return {
      total:ctxScore,
      scores:{
        leverage:{score:0,max:15,name:"Leverage",desc:"How much win probability moved",detail:noData},
        swings:{score:0,max:15,name:"Momentum",desc:"How often the game flipped",detail:noData},
        clutch:{score:0,max:15,name:"Clutch Time",desc:"Late leverage and high-stakes moments",detail:noData},
        control:{score:0,max:10,name:"In Doubt",desc:"How long the outcome stayed uncertain",detail:noData},
        chaos:{score:0,max:10,name:"Chaos",desc:"Turnovers and special teams impact",detail:noData},
        comeback:{score:0,max:10,name:"Comeback Factor",desc:"How deep a hole the winner climbed out of",detail:noData},
        finish:{score:0,max:10,name:"Dramatic Finish",desc:"Walk-offs, go-ahead scores in final moments",detail:noData},
        context:{score:ctxScore,max:15,name:"Context: Rivalry & Stakes",desc:"Season meaning, playoff pressure, rivalry history",detail:[ctxS.detail,ctxR.detail].filter(Boolean).join(" · "),_rivalry:ctxR,_stakes:ctxS}
      },
      wp: null
    };
  }

  // --- Leverage (0-15) ---
  const lev01 = scale01(wpStats.sumAbsDelta, 0.8, 2.8);
  const peak01 = scale01(wpStats.maxAbsDelta, 0.04, 0.25);

  // --- Momentum (0-15, unchanged) ---
  const swing01 = scale01(wpStats.crosses50 + 1.5*wpStats.crosses4060, 1, 10);

  // --- Clutch Time (0-15, unchanged) ---
  const clutch01 = scale01(wpStats.lateSumAbsDelta + 2.0*wpStats.lateMaxAbsDelta, 0.15, 1.10);

  // --- In Doubt (0-10, unchanged) ---
  const doubt01 = scale01(wpStats.doubtFrac, 0.25, 0.85);

  // --- Chaos (0-10, now direct turnover/ST counting) ---
  const toCounts = countTurnoversFromPlays(d);
  const toBase = scale01(toCounts.turnovers, 0, 5); // 0 TOs = 0, 5+ TOs = max
  const toBonus = Math.min((toCounts.pickSixes * 0.15) + (toCounts.stTDs * 0.15), 0.3); // bonus for return TDs
  const chaos01 = clamp(toBase + toBonus, 0, 1);

  // --- Comeback Factor (0-10) ---
  const cbf = wpStats.comebackFactor || 1;
  // CBF < 1.5 = no comeback, CBF 2 = minor, CBF 4 = significant, CBF 8+ = legendary
  const cbf01 = scale01(cbf, 1.5, 10);

  // --- Dramatic Finish (0-10) ---
  // Reweighted: a game-ending defensive stop or walk-off in a close game
  // should score 9-10/10, not 5/10. Normalize to 7 so dramatic finishes
  // saturate the scale properly.
  const df = wpStats.dramaticFinish || {};
  let finishPts = 0;
  if(df.walkOff) finishPts += 4;               // Walk-off score (final 30s or OT) — peak drama
  else if(df.goAheadFinal2Min) finishPts += 3;  // Go-ahead in final 2 min
  if(df.otWinner) finishPts += 2;              // OT game-winner
  if(df.finalPlayScore) finishPts += 2;        // Score/stop on literally the final play
  if(df.gameEndingStop) finishPts += 3.5;      // Blocked kick, INT, turnover on downs on final drive
  if(df.margin != null && df.margin <= 3) finishPts += 1.5;  // Decided by a FG or less
  else if(df.margin != null && df.margin <= 8) finishPts += 0.5; // One-score game
  if(df.margin === 0 && wpStats.hasOT) finishPts += 1; // Tied at end of regulation (went to OT)
  const finish01 = clamp(finishPts / 7, 0, 1);

  const ctxR = calcRivalry(g);
  const ctxS = calcStakes(g, d);
  // Combined context score (capped at 15)
  const ctxCombinedScore = clamp(ctxR.score + ctxS.score, 0, 15);
  const ctxCombinedDetail = [ctxS.detail, ctxR.detail].filter(Boolean).join(" · ");
  const context = {
    score: ctxCombinedScore,
    max: 15,
    name: "Context: Rivalry & Stakes",
    desc: "Season meaning, playoff pressure, rivalry history, and competitive overlap",
    detail: ctxCombinedDetail,
    _rivalry: ctxR,
    _stakes: ctxS
  };

  const leverage = {
    score: scoreFrom01(0.65*lev01 + 0.35*peak01, 15),
    max:15,
    name:"Leverage",
    desc:"Total win-probability movement (Σ|ΔWP|), with extra weight for peak moments",
    detail:`Σ|ΔWP|=${wpStats.sumAbsDelta.toFixed(2)}, max |ΔWP|=${wpStats.maxAbsDelta.toFixed(2)}`
  };
  const swings = {
    score: scoreFrom01(swing01, 15),
    max:15,
    name:"Momentum",
    desc:"How often the likely winner changed and the game swung between advantage states",
    detail:`50% crossings=${wpStats.crosses50}, 40/60 band crossings=${wpStats.crosses4060}`
  };
  const clutch = {
    score: scoreFrom01(clutch01, 15),
    max:15,
    name:"Clutch Time",
    desc:"WP movement in the final 8:00 of Q4 + OT — late swings carry the most emotional weight",
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
    desc:"Turnovers and special teams impact — interceptions, fumbles, return TDs",
    detail:`${toCounts.turnovers} turnovers${toCounts.pickSixes?`, ${toCounts.pickSixes} pick-six${toCounts.pickSixes>1?"es":""}`:""}, ${toCounts.stTDs} ST TDs`
  };
  const comeback = {
    score: scoreFrom01(cbf01, 10),
    max:10,
    name:"Comeback Factor",
    desc:"How deep a hole the winner climbed out of (1/winner's lowest WP)",
    detail:`Winner's lowest WP=${Math.round((wpStats.minWP<0.5?(wpStats.minWP):(1-wpStats.maxWP))*100)}%, CBF=${cbf.toFixed(1)}`
  };
  const finish = {
    score: scoreFrom01(finish01, 10),
    max:10,
    name:"Dramatic Finish",
    desc:"Walk-off scores, game-ending stops, go-ahead TDs in the final moments, overtime winners",
    detail:[
      df.gameEndingStop?"Game-ending defensive stop":null,
      df.walkOff?"Walk-off score":df.goAheadFinal2Min?"Go-ahead in final 2:00":null,
      df.otWinner?"OT game-winner":null,
      df.finalPlayScore?"Final-play score":null,
      df.margin!=null?`Final margin: ${df.margin} pts`:null
    ].filter(Boolean).join(", ")||"Standard finish"
  };

  const coreTotal = leverage.score + swings.score + clutch.score + control.score + chaos.score + comeback.score + finish.score;
  const total = clamp(coreTotal + context.score, 0, 100);

  return {
    total,
    scores:{leverage,swings,clutch,control,chaos,comeback,finish,context},
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
  // Strip extra point / PAT info and everything after it
  const patIdx=t.toLowerCase().indexOf("extra point");
  if(patIdx>0) t=t.slice(0,patIdx).trim();
  // Strip kicker parenthetical like "(Harrison Butker Kick)"
  t=t.replace(/\s*\([^)]*\bKick\b[^)]*\)\s*$/i,"").trim();
  t=t.replace(/\s*\(\s*kick\s+is\s+(?:good|no\s+good)\s*\)\s*$/i,"").trim();
  // Strip bare kicker after TOUCHDOWN (before conversion)
  t=t.replace(/\b(TOUCHDOWN)\s*[.,]?\s+[A-Z][a-z]?\.\s*[A-Z][A-Za-z'-]+.*/i, "$1").trim();
  t=t.replace(/\bTD\b/g,"touchdown");
  t=t.replace(/TOUCHDOWN/ig,"touchdown");
  // Strip trailing kicker after "touchdown" (after conversion)
  t=t.replace(/(touchdown)\s+[A-Z][a-z]?\.\s*[A-Z][A-Za-z'-]+.*/i,"$1").trim();
  // Strip trailing bare last name after yardage — catches "for 19 Yrds Bass", "for 75 Yrds Bass"
  t=t.replace(/(\d+\s+Yrds?)\s+[A-Z][a-z]+$/i,"$1").trim();
  t=t.replace(/(for a touchdown)\s+[A-Z][A-Za-z'-]+.*/i,"$1").trim();
  // Strip Center-/Holder- info
  t=t.replace(/,?\s*Center-\S+.*/i,"").trim();
  t=t.replace(/,?\s*Holder-\S+.*/i,"").trim();
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
      // For TDs, find the actual TD play, not the extra point that follows
      let scoringPlay=null;
      if(result.includes("touchdown")){
        scoringPlay=plays.find(p=>{
          const t=(p.text||p.shortText||"").toLowerCase();
          const ty=(p.type?.text||"").toLowerCase();
          return t.includes("touchdown")||ty.includes("touchdown");
        });
      }
      // For FGs, find the actual FG play (not end-of-period markers)
      if(!scoringPlay&&result.includes("field goal")){
        scoringPlay=plays.find(p=>{
          const t=(p.text||p.shortText||"").toLowerCase();
          const ty=(p.type?.text||"").toLowerCase();
          return t.includes("field goal")||ty.includes("field goal");
        });
      }
      // Fallback to last non-marker play
      let lastReal=null;
      for(let i=plays.length-1;i>=0;i--){
        const ty=(plays[i].type?.text||"").toLowerCase();
        if(ty!=="end period"&&ty!=="end of half"&&ty!=="end of game"&&!ty.includes("timeout")&&!ty.includes("two-minute")){lastReal=plays[i];break;}
      }
      const last=scoringPlay||lastReal||plays[plays.length-1];
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

  const ctxR = exc?.scores?.context?._rivalry || exc?.scores?.contextR;
  const ctxS = exc?.scores?.context?._stakes || exc?.scores?.contextS;

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
  const notId2abbr=teamIdToAbbrMap(d);
  const notablePlays=[];
  for(const p of allPlays){
    const txt=normSpace(p.text||p.shortText||"");
    const lo=txt.toLowerCase();
    const ty=(p.type?.text||"").toLowerCase();
    if(lo.includes("(no play)")) continue;
    // Skip non-plays
    if(ty.includes("timeout")||ty.includes("two-minute")||ty==="end period"||ty==="end of half"||ty==="end of game") continue;
    const yds=p.statYardage||0;
    const per=p.period?.number||0;
    const clk=p.clock?.displayValue||"";
    // Resolve drive team abbreviation reliably
    const driveAbbr=(p._driveTeamId!=null)?notId2abbr.get(String(p._driveTeamId)):null;
    const team=driveAbbr||p.team?.abbreviation||"";
    if(lo.includes("intercept")||ty.includes("interception")){
      notablePlays.push({type:"INT",text:txt,period:per,clock:clk,team,yds});
    } else if(lo.includes("fumble")){
      // Only treat as a turnover if the recovery team is different than the offense team.
      const mrec = txt.match(/recovered\s+by\s+([A-Z]{2,4})[\s-]/i) || txt.match(/RECOVERED\s+([A-Z]{2,4})\b/i);
      const rec = mrec ? mrec[1] : null;
      const selfRec = /\band\s+recovers\b|\brecovers\s+at\b/i.test(txt);
      if(rec && team && rec !== team && !selfRec){
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
  const stakesDetail=exc?.scores?.context?._stakes?.detail||exc?.scores?.contextS?.detail||"";

  return{
    matchup:`${tn(g.at)} at ${tn(g.ht)}`,
    awayTeam:g.at,homeTeam:g.ht,
    homeDivision:getDiv(g.ht),awayDivision:getDiv(g.at),
    homeTeamId:homeId,
    awayTeamId:(()=>{const comp=d?.header?.competitions?.[0];const away=comp?.competitors?.find(c=>c.homeAway==="away");return away?.team?.id;})(),
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
