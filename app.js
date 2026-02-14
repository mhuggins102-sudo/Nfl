import{createElement as h,useState,useCallback,useEffect,useRef,Fragment}from"https://esm.sh/react@18.2.0";
import{createRoot}from"https://esm.sh/react-dom@18.2.0/client";
import{TEAMS,tn,TK,espnSB,espnSum,parseEv,computeExc,oGrade,gradeFor,extractKP,buildBox,buildStats,buildPlayerStats,buildSummaryData,getAllPlays,getWPSeries,getWPSeriesPlus}from"./engine.js";

const cc=c=>({s:"cs",a:"ca",b:"cb",c:"cc",d:"cd",f:"cf"}[c]||"");
const bc=c=>({s:"bs",a:"ba",b:"bbl",c:"bc",d:"bd",f:"bf2"}[c]||"");
const normTeam=(x)=>x==="LAR"?"LA":x;
// Short team name: just the mascot (last word of full name), e.g. "KC" → "Chiefs"
const shortName=(abbr)=>{const full=TEAMS[abbr];if(!full)return abbr;const parts=full.split(" ");return parts[parts.length-1];};
const _ns=s=>(s||"").toString().replace(/\s+/g," ").trim();

// ── Clean ESPN play text into readable English ──
function _cleanPlay(s){
  s=_ns(s);if(!s)return"";
  // Remove everything after extra point / PAT / penalty markers
  const cuts=["extra point","TWO-POINT","two-point","Penalty","PENALTY","(kick failed)","(pass failed)","(run formation)","kick is good","kick is no good"];
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
  // Remove kicker XP parenthetical like "(Harrison Butker Kick)" or "(kick is good)"
  s=s.replace(/\s*\([^)]*\bKick\b[^)]*\)\s*$/i,"").trim();
  s=s.replace(/\s*\(\s*kick\s+is\s+(?:good|no\s+good)\s*\)\s*$/i,"").trim();
  // Remove bare kicker name/info after TOUCHDOWN before it gets converted
  // Catches: "TOUCHDOWN H.Butker kick", "TOUCHDOWN Butker", "TOUCHDOWN. H.Butker extra point"
  s=s.replace(/\b(TOUCHDOWN)\s*[.,]?\s+[A-Z][a-z]?\.\s*[A-Z][A-Za-z'-]+.*/i, "$1").trim();
  // Remove trailing "Center-..." or "Holder-..." (snapper/holder info)
  s=s.replace(/,?\s*Center-\S+.*/i,"").trim();
  s=s.replace(/,?\s*Holder-\S+.*/i,"").trim();

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
  // Strip trailing kicker/holder after "for a touchdown" — catches "for a touchdown Butker" or "for a touchdown Bass"
  s=s.replace(/(for a touchdown)\s+[A-Z][A-Za-z'-]+.*/i, "$1");
  // Strip trailing bare last name after yardage — catches "for 19 Yrds Bass", "for 75 Yrds Bass"
  s=s.replace(/(\d+\s+Yrds?)\s+[A-Z][a-z]+$/i,"$1");
  // "for no gain"
  s=s.replace(/for no gain/g,"for no gain");
  // Remove "No Play" completely
  if(/no play/i.test(s)) return"";
  // Clean up double spaces, trailing dots/commas
  s=s.replace(/\s+/g," ").replace(/[.,]\s*$/,"").trim();
  if(s.length>180)s=s.slice(0,180).replace(/\s\S*$/,"")+"...";
  return s;
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
  const leaders=sum.leaders||[];
  const qNarr=sum.quarterNarrative||[];
  const notable=sum.notablePlays||[];
  const scoring=sum.scoringPlays||[];
  const pRound=sum.playoffRound||"";
  const paragraphs=[];
  const scoreStr=`${winScore}-${loseScore}`;
  const totalPts=winScore+loseScore;

  // ── Helpers ──
  function _pq(l){
    if(!l||l.type!=="passing")return"ok";
    const m=(l.line||"").match(/(\d+)\/(\d+)/);if(!m)return"ok";
    const comp=+m[1],att=+m[2],pct=att>0?comp/att:0,ypa=att>0?l.yds/att:0;
    const intM=l.line.match(/(\d+)\s*INT/),ints=intM?+intM[1]:0;
    if(l.td>=3&&pct>=.60&&ypa>=7)return"dominant";if(l.td>=2&&pct>=.65)return"sharp";
    if(pct>=.65&&l.td>=1)return"efficient";if(ints>=2&&l.td<=1)return"mistake-prone";
    if(pct<.50||ypa<5)return"poor";return"ok";
  }
  // Proper capitalization for player names
  function _capName(n){
    if(!n)return"";
    return n.split(/\s+/).map(w=>{
      if(w.length<=1)return w.toUpperCase();
      // Handle hyphenated names like "Smith-Schuster"
      return w.split("-").map(p=>p.charAt(0).toUpperCase()+p.slice(1).toLowerCase()).join("-");
    }).join(" ");
  }
  // Describe a scoring play with context (score, time, down/distance when noteworthy)
  function _scoreLine(sp){
    if(!sp)return"";
    let txt=_humanizePlay(sp.text);
    if(!txt)return"";
    const per=sp.period<=4?`Q${sp.period}`:"OT";
    const parts=[];
    if(sp.clock) parts.push(`${sp.clock} ${per}`);
    if(sp.homeScore!=null&&sp.awayScore!=null){
      const hLead=sp.homeScore>sp.awayScore;
      const aLead=sp.awayScore>sp.homeScore;
      const tied=sp.homeScore===sp.awayScore;
      const high=Math.max(sp.homeScore,sp.awayScore), low=Math.min(sp.homeScore,sp.awayScore);
      const leader=hLead?hN:aLead?aN:null;
      if(tied) parts.push(`tying it ${high}-all`);
      else if(leader) parts.push(`${leader} ${high}-${low}`);
    }
    if(parts.length) txt+=` (${parts.join(", ")})`;
    return txt;
  }

  // ── Performers across both teams ──
  const wAll=leaders.filter(l=>l.team===wAb).sort((a,b)=>(b.td*80+b.yds)-(a.td*80+a.yds));
  const lAll=leaders.filter(l=>l.team===lAb).sort((a,b)=>(b.td*80+b.yds)-(a.td*80+a.yds));
  const winQB=leaders.find(l=>l.team===wAb&&l.type==="passing");
  const loseQB=leaders.find(l=>l.team===lAb&&l.type==="passing");
  const wQBq=_pq(winQB), lQBq=_pq(loseQB);
  const wSkill=wAll.filter(l=>l.type!=="passing");
  const lSkill=lAll.filter(l=>l.type!=="passing");
  const wStarRB=wSkill.find(l=>l.type==="rushing"&&(l.yds>=80||l.td>=2));
  const wStarWR=wSkill.find(l=>l.type==="receiving"&&(l.yds>=80||l.td>=2));
  const lStarRB=lSkill.find(l=>l.type==="rushing"&&(l.yds>=80||l.td>=2));
  const lStarWR=lSkill.find(l=>l.type==="receiving"&&(l.yds>=80||l.td>=2));

  const turnovers=notable.filter(p=>p.type==="INT"||p.type==="FUM");

  // ── P1: LEDE — archetype-aware opening ──
  let lede="";
  let ctxPre="";
  if(pRound==="Super Bowl") ctxPre="In the Super Bowl, ";
  else if(pRound==="Conference Championship") ctxPre="In the conference championship, ";
  else if(pRound) ctxPre=`In the ${pRound}, `;

  let ledeStar="";
  if(wStarRB&&wStarRB.yds>=120) ledeStar=` behind ${_capName(wStarRB.name)}'s ${wStarRB.yds}-yard, ${wStarRB.td}-TD rushing performance`;
  else if(wStarWR&&wStarWR.yds>=120) ledeStar=` fueled by ${_capName(wStarWR.name)}'s ${wStarWR.yds}-yard receiving day`;
  else if(winQB&&wQBq==="dominant") ledeStar=` behind ${_capName(winQB.name)}'s ${winQB.td}-TD performance`;

  if(arche==="comeback"&&deficit>=14){
    lede=`${ctxPre}${W} erased a ${deficit}-point deficit${ledeStar} to win ${scoreStr}${hasOT?" in overtime":""}. `;
  } else if(arche==="comeback"){
    lede=`${ctxPre}${W} trailed for most of this game before surging late${ledeStar} for a ${scoreStr} win${hasOT?" in overtime":""}. `;
  } else if(arche==="seesaw"){
    lede=`${ctxPre}Neither team could pull away in a wild back-and-forth battle. ${W} emerged${ledeStar}, ${scoreStr}${hasOT?" in overtime":""}.`;
  } else if(arche==="wire"&&margin>=17){
    lede=`${ctxPre}${W} dominated from the opening whistle${ledeStar}, routing ${L} ${scoreStr}.`;
  } else if(arche==="wire"&&margin>=10){
    lede=`${ctxPre}${W} controlled this game from start to finish${ledeStar}, winning ${scoreStr}. ${L} never seriously threatened.`;
  } else if(arche==="wire"){
    lede=`${ctxPre}${W} was in command throughout${ledeStar}, winning ${scoreStr}.`;
  } else if(arche==="collapse"){
    lede=`${ctxPre}${L} held a ${deficit}-point lead and let it slip. ${W} came all the way back${ledeStar} for a ${scoreStr} victory${hasOT?" in overtime":""}.`;
  } else if(hasOT){
    lede=`${ctxPre}${W} outlasted ${L} in overtime${ledeStar}, ${scoreStr}. Regulation couldn't settle it.`;
  } else if(margin<=3){
    lede=`${ctxPre}${W} edged ${L}${ledeStar}, ${scoreStr}, in a game decided by the thinnest of margins.`;
  } else if(margin<=7&&totalPts>=50){
    lede=`${ctxPre}${W} held off ${L} ${scoreStr} in a high-scoring affair${ledeStar}.`;
  } else if(totalPts<=20){
    lede=`${ctxPre}In a defensive slugfest, ${W} ground out a ${scoreStr} win over ${L}${ledeStar}.`;
  } else {
    lede=`${ctxPre}${W} beat ${L} ${scoreStr}${ledeStar}.`;
  }
  paragraphs.push(lede);

  // ── P2: GAME FLOW — chronological narrative using scoring plays and key moments ──
  // Build a timeline of all significant events, then narrate through them
  const timeline=[];
  for(const sp of scoring){
    const txt=_humanizePlay(sp.text);
    if(!txt)continue;
    timeline.push({period:sp.period,clock:sp.clock,type:sp.type,team:sp.team,
      text:txt,homeScore:sp.homeScore,awayScore:sp.awayScore,source:"score"});
  }
  // Add key turnovers to timeline
  for(const np of notable){
    if(np.type==="INT"||np.type==="FUM"){
      const txt=_humanizePlay(np.text);
      if(!txt)continue;
      timeline.push({period:np.period,clock:np.clock,type:np.type,team:np.team,
        text:txt,source:"turnover"});
    }
  }
  // Sort by game time (period asc, then clock desc within period)
  timeline.sort((a,b)=>{
    if(a.period!==b.period)return a.period-b.period;
    const ca=parseClockStr(a.clock), cb=parseClockStr(b.clock);
    if(ca!=null&&cb!=null)return cb-ca; // higher clock = earlier in quarter
    return 0;
  });

  function parseClockStr(c){
    if(!c)return null;
    const m=String(c).match(/(\d+):(\d+)/);
    return m?(+m[1]*60+ +m[2]):null;
  }

  // Build the narrative per quarter/half with multiple scoring plays mentioned
  const qH=qNarr.find(q=>q.q===2)||qNarr[1];
  const q1=qNarr.find(q=>q.q===1);
  const q3=qNarr.find(q=>q.q===3);
  const q4=qNarr.find(q=>q.q===4);
  const halftimeLead=qH?(qH.endHS-qH.endAS):0;

  let narr="";
  // First half
  const firstHalfScores=timeline.filter(t=>t.period<=2&&t.source==="score");
  const firstHalfTOs=timeline.filter(t=>t.period<=2&&t.source==="turnover");
  const hLeader=halftimeLead>0?hN:halftimeLead<0?aN:null;
  const hHigh=qH?Math.max(qH.endHS,qH.endAS):0;
  const hLow=qH?Math.min(qH.endHS,qH.endAS):0;

  if(firstHalfScores.length===0&&qH){
    // Scoreless or limited first half
    if(hHigh===0) narr+="Neither team found the end zone in the first half. ";
    else narr+=`It was ${hHigh}-${hLow} at the break. `;
  } else if(firstHalfScores.length<=2&&qH){
    // Sparse scoring — mention the plays that did happen
    if(hLeader&&Math.abs(halftimeLead)>=10){
      narr+=`${hLeader} took control early, building a ${hHigh}-${hLow} lead by halftime`;
      if(firstHalfScores.length>0){
        const topPlay=firstHalfScores[firstHalfScores.length-1];
        narr+=`, capped by ${_scoreLine(topPlay)}`;
      }
      narr+=`. `;
    } else if(qH){
      if(hLeader) narr+=`${hLeader} carried a ${hHigh}-${hLow} lead into halftime. `;
      else if(hHigh>0) narr+=`It was ${hHigh}-all at the break. `;
    }
  } else if(firstHalfScores.length>=3&&qH){
    // Active first half — describe the flow
    if(hLeader&&Math.abs(halftimeLead)>=14){
      narr+=`${hLeader} jumped out to a ${hHigh}-${hLow} halftime lead. `;
      // Mention a standout first-half play
      const topFH=firstHalfScores.find(s=>s.type==="TD");
      if(topFH) narr+=`The highlight was ${_scoreLine(topFH)}. `;
    } else if(hLeader&&Math.abs(halftimeLead)>=4){
      narr+=`The teams traded blows early. ${hLeader} took a ${hHigh}-${hLow} lead into the break`;
      if(firstHalfTOs.length>0) narr+=` as ${firstHalfTOs.length} turnover${firstHalfTOs.length>1?"s":""} kept things volatile`;
      narr+=`. `;
    } else {
      if(hHigh>0&&hLeader) narr+=`After a back-and-forth first half it was ${hHigh}-${hLow} ${hLeader} at the break. `;
      else if(hHigh>0) narr+=`After a competitive first half it was tied ${hHigh}-all at the break. `;
    }
  }

  // Second half — this is where the story usually lives
  const secondHalfScores=timeline.filter(t=>t.period>=3&&t.period<=4&&t.source==="score");
  const q3Lead=q3?(q3.endHS-q3.endAS):halftimeLead;
  const leaderFlippedQ3=(halftimeLead>0&&q3Lead<0)||(halftimeLead<0&&q3Lead>0);

  if(leaderFlippedQ3&&q3){
    const q3Winner=q3Lead>0?hN:aN;
    const q3High=Math.max(q3.endHS,q3.endAS), q3Low=Math.min(q3.endHS,q3.endAS);
    narr+=`${q3Winner} stormed back in the third quarter to take a ${q3High}-${q3Low} lead. `;
  } else if(q3&&secondHalfScores.length>0){
    // Mention key third-quarter scoring
    const q3Scores=secondHalfScores.filter(s=>s.period===3);
    if(q3Scores.length>=2){
      narr+=`The third quarter saw ${q3Scores.length} scoring drives. `;
    } else if(q3Scores.length===1){
      const s=q3Scores[0];
      const teamName=tn(s.team);
      narr+=`${teamName} scored in the third quarter with ${_scoreLine(s)}. `;
    }
  }

  if(narr.trim()) paragraphs.push(narr.trim());

  // ── P3: FOURTH QUARTER + OT — natural sportswriter narrative ──
  // Helper: extract a compact play description from humanized text
  // e.g. "Allen pass to Davis for 27 Yrds for a touchdown" → "a 27-yard TD pass from Allen to Davis"
  function _playDesc(sp){
    const txt=_humanizePlay(sp.text||"");
    if(!txt)return null;
    const lo=txt.toLowerCase();
    const isTD=sp.type==="TD"||lo.includes("touchdown");
    const isFG=sp.type==="FG"||lo.includes("field goal");
    // Try to extract yardage
    const yM=txt.match(/(\d+)\s*(?:Yrds?|yards?|Yd)/i);
    const yds=yM?+yM[1]:0;
    // Try to extract player names from the play
    // Patterns: "Name pass to Name for X Yrds", "Name X Yd Rush", "Name X Yd pass from Name"
    const passTo=txt.match(/^(\S+)\s+pass\s+to\s+(\S+)/i);
    const passFrom=txt.match(/^(\S+)\s+.*?pass\s+from\s+(\S+)/i);
    const rush=txt.match(/^(\S+)\s+\d+\s*(?:Yd|Yard)/i);
    const fgM=txt.match(/^(\S+)\s+\d+\s*(?:Yd|Yard)\s+Field Goal/i);
    if(isFG){
      const kicker=fgM?_capName(fgM[1]):null;
      if(kicker&&yds) return `a ${yds}-yard field goal by ${kicker}`;
      if(yds) return `a ${yds}-yard field goal`;
      return "a field goal";
    }
    if(isTD){
      if(passFrom&&yds){
        const receiver=_capName(passFrom[1]);
        const qb=_capName(passFrom[2]);
        return `a ${yds}-yard TD pass from ${qb} to ${receiver}`;
      }
      if(passTo&&yds){
        const qb=_capName(passTo[1]);
        const receiver=_capName(passTo[2]);
        return `a ${yds}-yard TD pass from ${qb} to ${receiver}`;
      }
      if(rush&&yds){
        const runner=_capName(rush[1]);
        return `a ${yds}-yard TD run by ${runner}`;
      }
      if(yds) return `a ${yds}-yard touchdown`;
      return "a touchdown";
    }
    // Non-TD/FG play
    if(yds>=20) return `a ${yds}-yard play`;
    return txt.length>60?txt.slice(0,60)+"...":txt;
  }
  // Helper: short mascot-style team name from abbreviation
  function _short(abbr){
    const full=TEAMS[abbr];if(!full)return abbr;
    const parts=full.split(" ");return parts[parts.length-1];
  }

  let lateNarr="";
  const q4Scores=timeline.filter(t=>t.period===4&&t.source==="score");
  const q4TOs=timeline.filter(t=>t.period===4&&t.source==="turnover");
  const otScores=timeline.filter(t=>t.period>4&&t.source==="score");
  const lateScores=[...q4Scores,...otScores];

  // Determine the game state entering Q4
  const q4Start=q4?(q4.startHS-q4.startAS):q3Lead;
  const q4Leader=q4Start>0?_short(sum.homeTeam):q4Start<0?_short(sum.awayTeam):null;
  const q4StartHigh=q4?Math.max(q4.startHS,q4.startAS):0;
  const q4StartLow=q4?Math.min(q4.startHS,q4.startAS):0;

  if(lateScores.length>=3||(lateScores.length>=2&&hasOT)){
    // Dramatic late game — natural play-by-play sentences
    if(q4Leader&&q4StartHigh>0) lateNarr+=`Entering the fourth quarter, the ${q4Leader} led ${q4StartHigh}-${q4StartLow}. `;
    else if(!q4Leader&&q4StartHigh>0) lateNarr+=`Entering the fourth quarter, the game was tied ${q4StartHigh}-all. `;

    if(lateScores.length>=3) lateNarr+=`Scoring was heavy during the game's final minutes. `;

    // Track the running score as we narrate
    let prevHS=q4?q4.startHS:(q3?q3.endHS:0);
    let prevAS=q4?q4.startAS:(q3?q3.endAS:0);
    let prevLeader=prevHS>prevAS?"home":prevAS>prevHS?"away":"tied";

    const allLate=lateScores.slice(0,7); // cap for readability
    for(let i=0;i<allLate.length;i++){
      const sp=allLate[i];
      const desc=_playDesc(sp);
      if(!desc)continue;
      const teamShort=_short(sp.team);
      const curHS=sp.homeScore!=null?+sp.homeScore:prevHS;
      const curAS=sp.awayScore!=null?+sp.awayScore:prevAS;
      const curLeader=curHS>curAS?"home":curAS>curHS?"away":"tied";
      const curHigh=Math.max(curHS,curAS), curLow=Math.min(curHS,curAS);
      const curLeaderName=curLeader==="home"?_short(sum.homeTeam):curLeader==="away"?_short(sum.awayTeam):null;

      // Build natural time reference
      let timeRef="";
      if(sp.clock){
        const clkSec=parseClockStr(sp.clock);
        const per=sp.period<=4?"remaining in the game":"remaining in overtime";
        if(clkSec!=null&&clkSec<=30) timeRef=`with just ${sp.clock} ${per}`;
        else if(clkSec!=null&&clkSec<=120) timeRef=`with ${sp.clock} ${per}`;
        else if(sp.clock) timeRef=`with ${sp.clock} ${per}`;
      }

      // Determine narrative verb/framing based on score change
      const leadChanged=(curLeader!==prevLeader&&prevLeader!=="tied"&&curLeader!=="tied");
      const tookLead=(curLeader!=="tied"&&prevLeader==="tied");
      const tiedIt=(curLeader==="tied"&&prevLeader!=="tied");
      const extendedLead=(curLeader===prevLeader&&curLeader!=="tied"&&(curHigh-curLow)>(Math.max(prevHS,prevAS)-Math.min(prevHS,prevAS)));

      let sentence="";
      if(tiedIt){
        sentence=`The ${teamShort} tied it at ${curHigh} on ${desc}`;
        if(timeRef) sentence+=` ${timeRef}`;
      } else if(leadChanged){
        sentence=`The ${teamShort} went back on top ${curHigh}-${curLow} on ${desc}`;
        if(timeRef) sentence+=` ${timeRef}`;
      } else if(tookLead){
        sentence=`The ${teamShort} took the lead ${curHigh}-${curLow} on ${desc}`;
        if(timeRef) sentence+=` ${timeRef}`;
      } else if(extendedLead){
        sentence=`The ${teamShort} extended their lead to ${curHigh}-${curLow} on ${desc}`;
        if(timeRef) sentence+=` ${timeRef}`;
      } else {
        sentence=`The ${teamShort} scored on ${desc}`;
        if(timeRef) sentence+=` ${timeRef}`;
        if(curLeaderName) sentence+=`, making it ${curHigh}-${curLow}`;
        else sentence+=`, tying it ${curHigh}-all`;
      }
      lateNarr+=sentence+". ";
      prevHS=curHS; prevAS=curAS; prevLeader=curLeader;
    }

    if(hasOT&&otScores.length>0){
      // Check if OT was already narrated above
      const otNarrated=allLate.some(s=>s.period>4);
      if(!otNarrated){
        lateNarr+=`In overtime, the ${_short(wAb)} finished it off`;
        const otWinner=otScores.find(s=>s.team===wAb);
        const desc=otWinner?_playDesc(otWinner):null;
        if(desc) lateNarr+=` with ${desc}`;
        lateNarr+=` for a ${scoreStr} win. `;
      }
    } else if(hasOT){
      lateNarr+=`The game went to overtime where the ${_short(wAb)} prevailed ${scoreStr}. `;
    }
  } else if(lateScores.length>=1){
    // Some late scoring — still use natural language
    if(q4Scores.length>0){
      const bigQ4=q4Scores[q4Scores.length-1];
      const teamShort=_short(bigQ4.team);
      const desc=_playDesc(bigQ4);
      if(desc){
        if(q4Leader&&Math.abs(q4Start)<=3){
          lateNarr+=`The fourth quarter came down to the wire. The ${teamShort} scored on ${desc}`;
        } else {
          lateNarr+=`In the fourth quarter, the ${teamShort} scored on ${desc}`;
        }
        if(bigQ4.clock) lateNarr+=` with ${bigQ4.clock} remaining`;
        if(bigQ4.homeScore!=null&&bigQ4.awayScore!=null){
          const h=Math.max(+bigQ4.homeScore,+bigQ4.awayScore),l=Math.min(+bigQ4.homeScore,+bigQ4.awayScore);
          if(+bigQ4.homeScore===+bigQ4.awayScore) lateNarr+=`, tying it at ${h}`;
          else lateNarr+=`, making it ${h}-${l}`;
        }
        lateNarr+=`. `;
      }
    }
    if(hasOT) lateNarr+=`After regulation ended tied, the ${_short(wAb)} won it in overtime ${scoreStr}. `;
  } else if(arche==="wire"&&margin>=14){
    lateNarr+=`The fourth quarter was garbage time as the ${_short(wAb)} cruised to the finish. `;
  } else if(q4TOs.length>0){
    lateNarr+=`The fourth quarter was shaped by ${q4TOs.length} turnover${q4TOs.length>1?"s":""} as both teams tried to close it out. `;
  }

  if(lateNarr.trim()) paragraphs.push(lateNarr.trim());

  // ── P4: PERFORMERS — key stat lines ──
  const perfParts=[];
  const wStarNonQB=wStarRB||wStarWR;
  if(wStarNonQB&&(!ledeStar||!ledeStar.includes(_capName(wStarNonQB.name)))){
    if(wStarNonQB.type==="rushing") perfParts.push(`${_capName(wStarNonQB.name)} carried ${W}'s ground game (${wStarNonQB.line})`);
    else perfParts.push(`${_capName(wStarNonQB.name)} was a force in the passing game for ${W} (${wStarNonQB.line})`);
  }
  const wStar2=wSkill.find(l=>l!==wStarNonQB&&(l.yds>=70||l.td>=1));
  if(wStar2) perfParts.push(`${_capName(wStar2.name)} added ${wStar2.line}`);

  if(winQB&&!ledeStar.includes(_capName(winQB.name)||"__none__")){
    if(wQBq==="dominant") perfParts.push(`${_capName(winQB.name)} was outstanding (${winQB.line})`);
    else if(wQBq==="sharp") perfParts.push(`${_capName(winQB.name)} was sharp (${winQB.line})`);
    else if(wQBq==="mistake-prone") perfParts.push(`${_capName(winQB.name)} was erratic (${winQB.line}) but the team overcame it`);
    else if(wQBq!=="poor") perfParts.push(`${_capName(winQB.name)} went ${winQB.line}`);
  }

  const lStarNonQB=lStarRB||lStarWR;
  if(loseQB){
    if(lQBq==="dominant"||lQBq==="sharp"){
      perfParts.push(`${_capName(loseQB.name)} played well in defeat for ${L} (${loseQB.line})`);
      if(lStarNonQB) perfParts.push(`${_capName(lStarNonQB.name)} also produced (${lStarNonQB.line})`);
    } else if(lQBq==="mistake-prone"){
      const intM=(loseQB.line||"").match(/(\d+)\s*INT/);
      const ints=intM?+intM[1]:0;
      perfParts.push(`${_capName(loseQB.name)} hurt ${L} with ${ints} interception${ints>1?"s":""} (${loseQB.line})`);
    } else if(lQBq==="poor"){
      perfParts.push(`${_capName(loseQB.name)} struggled for ${L} (${loseQB.line})`);
      if(lStarNonQB&&lStarNonQB.yds>=100) perfParts.push(`${_capName(lStarNonQB.name)} did what he could (${lStarNonQB.line})`);
    }
  } else if(lStarNonQB){
    perfParts.push(`${_capName(lStarNonQB.name)} led ${L}'s effort (${lStarNonQB.line})`);
  }

  if(perfParts.length>0){
    paragraphs.push(perfParts.map((p,i)=>i===0?p:p.charAt(0).toLowerCase()+p.slice(1)).join(". ")+".");
  }

  // ── P5: CLOSER — context and rating ──
  let closer="";
  if(pRound==="Super Bowl"){
    if(sum.excitementScore>=80) closer="The biggest stage delivered a game worthy of it.";
    else if(sum.excitementScore>=60) closer="The Super Bowl provided its share of drama.";
    else closer="The Super Bowl didn't deliver the classic fans hoped for.";
  } else if(pRound){
    closer=`The playoff stage added weight to every possession.`;
  } else {
    if(sum.rivalryNote) closer+=sum.rivalryNote;
    else if(sum.stakesNote) closer+=sum.stakesNote;
  }
  if(closer) closer+=" ";
  closer+=`Excitement Index: ${sum.excitementScore||0} (${sum.excitementVerdict||"N/A"}).`;
  paragraphs.push(closer);

  return paragraphs.filter(p=>p&&p.trim()).slice(0,6);
}


// ── WP Chart: hover crosshair, scoring markers, overlays, animations ──

function WPChart({seriesE, seriesAlt, modelSel, onModelChange, mode, onModeChange, exc, topLev, homeTeam, awayTeam, scoringPlays}){
  const [tooltip,setTooltip]=useState(null);
  const [vLine,setVLine]=useState(null);
  const [hover,setHover]=useState(null); // live hover crosshair
  const [pinned,setPinned]=useState(false); // whether vLine is pinned by click
  const [zoom,setZoom]=useState("Full");
  const [scoreMarkerTip,setScoreMarkerTip]=useState(null);
  const svgRef=useRef(null);

  const activeSeries = (modelSel==="Alt") ? (seriesAlt||[]) : (seriesE||[]);
  const bothSeries = (modelSel==="Both");
  if(!activeSeries||activeSeries.length<2){
    return h("div",{style:{color:"var(--text-3)",fontFamily:"JetBrains Mono",fontSize:".75rem"}},"Win probability data unavailable.");
  }

  // Determine if game has OT
  const allForExtent = bothSeries ? [...(seriesE||[]), ...(seriesAlt||[])] : activeSeries;
  const maxTMin=Math.max(...allForExtent.filter(s=>s.tMin!=null).map(s=>s.tMin));
  const hasOT=maxTMin>60;
  const otMaxMin=hasOT?Math.ceil(maxTMin/5)*5:60;

  const effectiveZoom=(mode==="Clutch")?"Clutch":zoom;
  const zoomRanges={Full:[0,otMaxMin],Q1:[0,15],Q2:[15,30],Q3:[30,45],Q4:[45,60],Clutch:[52,otMaxMin]};
  const [zoomStart,zoomEnd]=zoomRanges[effectiveZoom]||[0,otMaxMin];

  const W=860,H=220,pad=28,markerY=H-8;
  const chartW=W-2*pad;
  const toX=t=>pad+((t-zoomStart)/(zoomEnd-zoomStart))*chartW;
  const toY=wp=>pad+(1-wp)*(H-2*pad-16); // leave room for scoring markers at bottom

  const inRange=s=>s&&s.tMin!=null&&s.wp!=null&&s.tMin>=zoomStart&&s.tMin<=zoomEnd;
  const step=Math.max(1,Math.floor(activeSeries.length/500));
  const pts=[];
  for(let i=0;i<activeSeries.length;i+=step){
    const s=activeSeries[i];
    if(inRange(s))pts.push([toX(s.tMin),toY(s.wp)]);
  }
  const path=pts.length>1?"M "+pts.map(p=>p[0].toFixed(2)+" "+p[1].toFixed(2)).join(" L "):"";

  let pathAlt=null;
  if(bothSeries && seriesAlt && seriesAlt.length>1){
    const step2=Math.max(1,Math.floor(seriesAlt.length/500));
    const pts2=[];
    for(let i=0;i<seriesAlt.length;i+=step2){
      const s=seriesAlt[i];
      if(inRange(s))pts2.push([toX(s.tMin),toY(s.wp)]);
    }
    if(pts2.length>1) pathAlt="M "+pts2.map(p=>p[0].toFixed(2)+" "+p[1].toFixed(2)).join(" L ");
  }

  // Quarter dividers and labels
  const qDividers=[];
  const qLabels=[];
  const quarters=[{q:1,s:0,e:15},{q:2,s:15,e:30},{q:3,s:30,e:45},{q:4,s:45,e:60}];
  if(hasOT) quarters.push({q:5,s:60,e:otMaxMin});
  for(const qr of quarters){
    const overlapStart=Math.max(qr.s,zoomStart), overlapEnd=Math.min(qr.e,zoomEnd);
    if(overlapEnd>overlapStart){
      const mid=(overlapStart+overlapEnd)/2;
      qLabels.push({x:toX(mid),label:qr.q<=4?`Q${qr.q}`:"OT",isOT:qr.q>4});
    }
    if(qr.e>zoomStart&&qr.e<zoomEnd&&qr.q<5) qDividers.push(toX(qr.e));
    if(qr.q===4&&hasOT&&60>zoomStart&&60<zoomEnd) qDividers.push(toX(60));
  }

  // Build scoring marker data from the series (detect score changes)
  const scoreMarkers=[];
  let prevSc={h:activeSeries[0]?.homeScore||0, a:activeSeries[0]?.awayScore||0};
  for(let i=1;i<activeSeries.length;i++){
    const s=activeSeries[i];
    const curH=s.homeScore||0, curA=s.awayScore||0;
    if((curH!==prevSc.h || curA!==prevSc.a) && s.tMin!=null && s.tMin>=zoomStart && s.tMin<=zoomEnd){
      const isHome=(curH>prevSc.h);
      const isTD=(curH-prevSc.h>=6)||(curA-prevSc.a>=6);
      const isFG=!isTD&&((curH-prevSc.h>=3)||(curA-prevSc.a>=3));
      scoreMarkers.push({x:toX(s.tMin), isHome, isTD, isFG,
        homeScore:curH, awayScore:curA,
        text:_humanizePlay(s.text)||`Score: ${curH}-${curA}`,
        period:s.period, clock:s.clock, tMin:s.tMin, wp:s.wp});
      prevSc={h:curH, a:curA};
    }
  }

  const overlays=[];
  const hitAreas=[];

  function addDot(cx,cy,r,fill,stroke,data){
    overlays.push(h("circle",{key:`dot-${overlays.length}`,cx,cy,r,fill,stroke:stroke||"none",strokeWidth:stroke?1.5:0,style:{cursor:"pointer"}}));
    hitAreas.push({cx,cy,r:Math.max(r,12),...data});
  }

  if(mode==="Leverage"){
    (topLev||[]).slice(0,6).forEach(tp=>{
      if(tp.tMin==null||tp.tMin<zoomStart||tp.tMin>zoomEnd)return;
      const per=tp.period<=4?`Q${tp.period}`:"OT";
      addDot(toX(tp.tMin),toY(tp.wp||0.5),6,"var(--gold)","rgba(201,162,39,.4)",{
        label:`${per} ${tp.clock}`,
        detail:_humanizePlay(tp.text)||"High leverage play",
        sub:`WP swing: ${Math.round(Math.abs(tp.delta||tp.absDelta||0)*100)}% | Score: ${shortName(homeTeam)} ${tp.homeScore}, ${shortName(awayTeam)} ${tp.awayScore}`,
        wp:tp.wp, tMin:tp.tMin, homeScore:tp.homeScore, awayScore:tp.awayScore
      });
    });
  }else if(mode==="Momentum"){
    for(let i=1;i<activeSeries.length;i++){
      const s=activeSeries[i];
      const prev=activeSeries[i-1];
      if(s.wp==null||prev.wp==null||s.tMin<zoomStart||s.tMin>zoomEnd)continue;
      const swing=Math.abs(s.wp-prev.wp);
      const crossed50=(prev.wp<0.5&&s.wp>=0.5)||(prev.wp>=0.5&&s.wp<0.5);
      if((crossed50&&swing>=0.05)||swing>=0.12){
        const per=s.period<=4?`Q${s.period}`:"OT";
        const swingPct=Math.round(swing*100);
        const lbl=crossed50?"Likely winner change":"Momentum shift";
        addDot(toX(s.tMin),toY(s.wp),crossed50?6:5,"var(--blue)","rgba(61,142,212,.4)",{
          label:`${per} ${s.clock} — ${lbl}`,
          detail:_humanizePlay(s.text)||lbl,
          sub:`WP swing: ${swingPct}% | ${shortName(homeTeam)} ${s.homeScore}, ${shortName(awayTeam)} ${s.awayScore}`,
          wp:s.wp, tMin:s.tMin, homeScore:s.homeScore, awayScore:s.awayScore
        });
      }
    }
  }else if(mode==="Chaos"){
    for(const s of activeSeries){
      if((s.tag==="TO"||s.tag==="SP")&&s.tMin>=zoomStart&&s.tMin<=zoomEnd){
        const per=s.period<=4?`Q${s.period}`:"OT";
        const lbl=s.tag==="TO"?"Turnover":"Special teams";
        addDot(toX(s.tMin),toY(s.wp),5.5,"var(--red)","rgba(212,64,64,.4)",{
          label:`${per} ${s.clock} — ${lbl}`,
          detail:_humanizePlay(s.text)||lbl,
          sub:`WP swing: ${Math.round(s.absDelta*100)}% | Score: ${shortName(homeTeam)} ${s.homeScore}, ${shortName(awayTeam)} ${s.awayScore}`,
          wp:s.wp, tMin:s.tMin, homeScore:s.homeScore, awayScore:s.awayScore
        });
      }
    }
  }else if(mode==="Clutch"){
    const clutchStart=Math.max(52, otMaxMin-8);
    overlays.push(h("rect",{key:"clutch-zone",x:toX(clutchStart),y:pad,width:toX(otMaxMin)-toX(clutchStart),height:H-2*pad-16,fill:"rgba(201,162,39,.08)"}));
  }

  // Find nearest play to a given tMin
  function findNearest(tMin){
    let nearest=null,nearDist=Infinity;
    for(const s of activeSeries){
      if(s.tMin==null)continue;
      const d=Math.abs(s.tMin-tMin);
      if(d<nearDist){nearDist=d;nearest=s;}
    }
    return nearest;
  }

  function svgCoords(e){
    const svg=e.currentTarget;
    const rect=svg.getBoundingClientRect();
    const scaleX=W/rect.width;
    return {cx:(e.clientX-rect.left)*scaleX, cy:(e.clientY-rect.top)*(H/rect.height)};
  }

  function handleSVGMove(e){
    if(pinned)return; // Don't update hover when pinned
    const {cx}=svgCoords(e);
    const tMin=zoomStart+((cx-pad)/chartW)*(zoomEnd-zoomStart);
    const nearest=findNearest(tMin);
    if(nearest){
      setHover({x:toX(nearest.tMin), wp:nearest.wp, tMin:nearest.tMin, homeScore:nearest.homeScore, awayScore:nearest.awayScore, text:_humanizePlay(nearest.text)||""});
    }
  }

  function handleSVGLeave(){
    if(!pinned) setHover(null);
  }

  function handleSVGClick(e){
    const {cx,cy}=svgCoords(e);

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
      setPinned(true);
      setHover(null);
      return;
    }

    // Check if we hit a scoring marker
    for(const sm of scoreMarkers){
      if(Math.abs(cx-sm.x)<8 && cy>=markerY-10){
        setScoreMarkerTip(sm);
        setVLine({x:sm.x, wp:sm.wp, tMin:sm.tMin, homeScore:sm.homeScore, awayScore:sm.awayScore});
        setPinned(true);
        setHover(null);
        return;
      }
    }

    // Toggle pin on/off
    if(pinned){
      setPinned(false);
      setVLine(null);
      setTooltip(null);
      setScoreMarkerTip(null);
      return;
    }

    const clickTMin=zoomStart+((cx-pad)/chartW)*(zoomEnd-zoomStart);
    const nearest=findNearest(clickTMin);
    if(nearest){
      setVLine({x:toX(nearest.tMin), wp:nearest.wp, tMin:nearest.tMin, homeScore:nearest.homeScore, awayScore:nearest.awayScore});
      setPinned(true);
      setHover(null);
      setTooltip(null);
      setScoreMarkerTip(null);
    }
  }

  const homeName=shortName(homeTeam)||"Home";
  const awayName=shortName(awayTeam)||"Away";
  const activeVLine=pinned?vLine:hover;

  const selStyle={background:"var(--bg-3)",border:"1px solid var(--border-1)",color:"var(--text-1)",padding:".35rem .5rem",fontFamily:"JetBrains Mono",fontSize:".7rem"};
  const lblStyle={fontFamily:"JetBrains Mono",fontSize:".65rem",letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-3)"};

  return h("div",{className:"sec"},
    h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:"1rem",flexWrap:"wrap"}},
      h("div",{className:"sec-h",style:{borderBottom:"none",marginBottom:"0"}},`Win Probability (${homeName})${modelSel==="Alt"?" — nflfastR Model":""}`),
      h("div",{style:{display:"flex",alignItems:"center",gap:".5rem",flexWrap:"wrap"}},
        h("div",{style:lblStyle},"Model"),
        h("select",{value:modelSel,onChange:e=>{onModelChange(e.target.value);setTooltip(null);setVLine(null);setPinned(false);},style:selStyle},
          [ ["ESPN","ESPN"], ["nflfastR","Alt"], ["Both","Both"] ].map(o=>h("option",{key:o[0],value:o[1]},o[0]))),
        h("div",{style:{...lblStyle,marginLeft:".4rem"}},"Overlay"),
        h("select",{value:mode,onChange:e=>{onModeChange(e.target.value);setTooltip(null);setVLine(null);setPinned(false);},style:selStyle},
          ["Leverage","Momentum","Chaos","Clutch"].map(o=>h("option",{key:o,value:o},o))),
        h("div",{style:{...lblStyle,marginLeft:".4rem"}},"Zoom"),
        h("select",{value:effectiveZoom,onChange:e=>{setZoom(e.target.value);setTooltip(null);setVLine(null);setPinned(false);},disabled:mode==="Clutch",style:{...selStyle,color:mode==="Clutch"?"var(--text-4)":"var(--text-1)"}},
          ["Full","Q1","Q2","Q3","Q4"].concat(hasOT?["Clutch"]:[]).map(o=>h("option",{key:o,value:o},o==="Clutch"?"Clutch (Q4+OT)":o))))),
    h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".6rem",color:"var(--text-4)",marginTop:".3rem",marginBottom:".2rem"}},
      "Hover to track WP. Click to pin. Triangles = scoring plays.",
      mode==="Leverage"?" Gold dots = highest WP swings.":
      mode==="Momentum"?" Blue dots = momentum shifts.":
      mode==="Chaos"?" Red dots = turnovers & special teams.":
      " Gold zone = clutch time."),
    h("div",{style:{border:"1px solid var(--border-1)",background:"var(--bg-2)",padding:".6rem .6rem .2rem",position:"relative"}},
      h("svg",{ref:svgRef,viewBox:`0 0 ${W} ${H}`,width:"100%",height:"auto",preserveAspectRatio:"none",
        onClick:handleSVGClick,onMouseMove:handleSVGMove,onMouseLeave:handleSVGLeave,
        style:{cursor:"crosshair",display:"block"}},
        // Y-axis labels
        h("text",{x:pad-4,y:toY(1),fill:"var(--text-4)",fontSize:"9",textAnchor:"end",dominantBaseline:"middle"},"100%"),
        h("text",{x:pad-4,y:toY(0.75),fill:"var(--text-4)",fontSize:"8",textAnchor:"end",dominantBaseline:"middle",opacity:.5},"75%"),
        h("text",{x:pad-4,y:toY(0.5),fill:"var(--text-4)",fontSize:"9",textAnchor:"end",dominantBaseline:"middle"},"50%"),
        h("text",{x:pad-4,y:toY(0.25),fill:"var(--text-4)",fontSize:"8",textAnchor:"end",dominantBaseline:"middle",opacity:.5},"25%"),
        h("text",{x:pad-4,y:toY(0),fill:"var(--text-4)",fontSize:"9",textAnchor:"end",dominantBaseline:"middle"},"0%"),
        // 25/75% gridlines
        h("line",{x1:toX(zoomStart),y1:toY(0.75),x2:toX(zoomEnd),y2:toY(0.75),stroke:"rgba(136,146,164,.12)",strokeWidth:"1",strokeDasharray:"2 4"}),
        h("line",{x1:toX(zoomStart),y1:toY(0.25),x2:toX(zoomEnd),y2:toY(0.25),stroke:"rgba(136,146,164,.12)",strokeWidth:"1",strokeDasharray:"2 4"}),
        // 50% midline
        h("line",{x1:toX(zoomStart),y1:toY(0.5),x2:toX(zoomEnd),y2:toY(0.5),stroke:"rgba(136,146,164,.35)",strokeWidth:"1",strokeDasharray:"4 4"}),
        // Quarter dividers
        ...qDividers.map((x,i)=>h("line",{key:`qd-${i}`,x1:x,y1:pad,x2:x,y2:H-pad-16,stroke:"rgba(136,146,164,.2)",strokeWidth:"1"})),
        // Quarter labels at top
        ...qLabels.map((l,i)=>h("text",{key:`ql-${i}`,x:l.x,y:pad-6,fill:l.label==="OT"?"var(--gold)":"rgba(136,146,164,.5)",fontSize:l.label==="OT"?"10":"9",fontWeight:l.label==="OT"?"600":"400",textAnchor:"middle",fontFamily:"JetBrains Mono"},l.label)),
        // OT background highlight
        (hasOT&&zoomEnd>60)?h("rect",{x:toX(Math.max(60,zoomStart)),y:pad,width:toX(zoomEnd)-toX(Math.max(60,zoomStart)),height:H-2*pad-16,fill:"rgba(201,162,39,.06)"}):null,
        // Clutch zone
        (mode==="Clutch"&&overlays.length)?overlays[0]:null,
        // WP line(s)
        h("path",{d:path,fill:"none",stroke:"rgba(232,236,240,.85)",strokeWidth:"2",strokeLinejoin:"round"}),
        (pathAlt? h("path",{d:pathAlt,fill:"none",stroke:"rgba(61,142,212,.7)",strokeWidth:"2",strokeLinejoin:"round"}) : null),
        // Scoring markers along bottom (small triangles)
        ...scoreMarkers.map((sm,i)=>{
          const color=sm.isHome?"var(--blue)":"var(--red)";
          const size=sm.isTD?5:3.5;
          return h("polygon",{key:`sm-${i}`,
            points:`${sm.x},${markerY-size*2} ${sm.x-size},${markerY} ${sm.x+size},${markerY}`,
            fill:color,opacity:.7,className:"score-tri",
            style:{cursor:"pointer"}});
        }),
        // Scoring marker labels (team abbreviations)
        ...scoreMarkers.filter((_,i)=>i<15).map((sm,i)=>h("text",{key:`sml-${i}`,x:sm.x,y:markerY+8,fill:"var(--text-4)",fontSize:"6",textAnchor:"middle",fontFamily:"JetBrains Mono"},
          `${sm.homeScore}-${sm.awayScore}`)),
        // Overlay dots
        ...(mode==="Clutch"?overlays.slice(1):overlays),
        // Hover crosshair (not pinned)
        activeVLine?h("line",{x1:activeVLine.x,y1:pad,x2:activeVLine.x,y2:H-pad-16,stroke:pinned?"var(--gold)":"rgba(201,162,39,.5)",strokeWidth:"1",strokeDasharray:pinned?"3 3":"2 3",opacity:pinned?.7:.5}):null,
        // WP dot on the line at cursor position
        activeVLine?h("circle",{cx:activeVLine.x,cy:toY(activeVLine.wp),r:3.5,fill:pinned?"var(--gold)":"rgba(201,162,39,.7)",stroke:"none"}):null,
        // WP percentage label at cursor
        activeVLine?h("text",{x:activeVLine.x+(activeVLine.x>W/2?-8:8),y:toY(activeVLine.wp)-10,fill:"var(--gold)",fontSize:"11",fontWeight:"600",textAnchor:activeVLine.x>W/2?"end":"start"},`${Math.round(activeVLine.wp*100)}%`):null
      ),
      // Time axis labels
      h("div",{style:{display:"flex",justifyContent:"space-between",fontFamily:"JetBrains Mono",fontSize:".55rem",color:"var(--text-4)",marginTop:".15rem",paddingLeft:`${pad}px`,paddingRight:`${pad}px`}},
        h("div",null,effectiveZoom==="Full"?"0:00":effectiveZoom==="Clutch"?"8:00 Q4":`Start ${effectiveZoom}`),
        h("div",null,effectiveZoom==="Full"?(hasOT?"END":"END"):effectiveZoom==="Clutch"?(hasOT?"OT END":"END"):`End ${effectiveZoom}`)
      ),
      // Persistent hover/pin info bar
      h("div",{className:"wp-hover-bar",style:{marginTop:".35rem",opacity:activeVLine?1:0}},
        activeVLine?h(Fragment,null,
          h("span",{style:{color:"var(--gold)"}},`${Math.round((activeVLine?.wp||0)*100)}% ${homeName}`),
          h("span",{style:{color:"var(--text-2)"}},`${shortName(homeTeam)} ${activeVLine?.homeScore||0}, ${shortName(awayTeam)} ${activeVLine?.awayScore||0}`),
          hover&&!pinned?h("span",{style:{color:"var(--text-4)",fontSize:".6rem",maxWidth:"40%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},hover.text||""):null,
          pinned?h("span",{style:{color:"var(--text-4)",fontSize:".6rem"}},"click to unpin"):null
        ):null
      ),
      // Scoring marker tooltip
      scoreMarkerTip?h("div",{style:{background:"var(--bg-3)",border:"1px solid var(--border-2)",padding:".5rem .7rem",marginTop:".3rem"},onClick:()=>{setScoreMarkerTip(null);setPinned(false);setVLine(null);}},
        h("div",{style:{fontFamily:"Oswald",fontSize:".85rem",color:"var(--text-1)",marginBottom:".15rem"}},`${scoreMarkerTip.period<=4?`Q${scoreMarkerTip.period}`:"OT"} ${scoreMarkerTip.clock} — ${scoreMarkerTip.isTD?"Touchdown":"Field Goal"}`),
        h("div",{style:{fontSize:".8rem",color:"var(--text-2)",lineHeight:"1.4"}},scoreMarkerTip.text),
        h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".7rem",color:"var(--gold)",marginTop:".15rem"}},`${shortName(homeTeam)} ${scoreMarkerTip.homeScore}, ${shortName(awayTeam)} ${scoreMarkerTip.awayScore}`),
        h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".55rem",color:"var(--text-4)",marginTop:".2rem"}},"Click to dismiss")
      ):null,
      // Dot overlay tooltip
      tooltip?h("div",{style:{background:"var(--bg-3)",border:"1px solid var(--border-2)",padding:".6rem .8rem",marginTop:".3rem"},onClick:()=>{setTooltip(null);setVLine(null);setPinned(false);}},
        h("div",{style:{fontFamily:"Oswald",fontSize:".85rem",color:"var(--text-1)",marginBottom:".2rem"}},tooltip.label),
        h("div",{style:{fontSize:".8rem",color:"var(--text-2)",lineHeight:"1.5"}},tooltip.detail),
        tooltip.sub?h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".7rem",color:"var(--gold)",marginTop:".2rem"}},tooltip.sub):null,
        h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".55rem",color:"var(--text-4)",marginTop:".3rem"}},"Click to dismiss")
      ):null
    )
  );
}


// ── Category Detail Modal — game-specific, natural language ──
function CategoryModal({cat,k,onClose,g,wpStats,enrichedPlays,sumData,wpSeries}){
  const homeN=tn(g.ht),awayN=tn(g.at);
  const homeShort=g.ht, awayShort=g.at;
  const winnerN=g.hs>g.as?homeN:awayN;
  const loserN=g.hs>g.as?awayN:homeN;
  const margin=Math.abs(g.hs-g.as);
  const gr=gradeFor(cat.score,cat.max);
  const topPlay=[...(enrichedPlays||[])].filter(p=>!/no play/i.test(p.text||"")).sort((a,b)=>(b.absDelta||0)-(a.absDelta||0))[0];
  const secondPlay=[...(enrichedPlays||[])].filter(p=>!/no play/i.test(p.text||"")).sort((a,b)=>(b.absDelta||0)-(a.absDelta||0))[1];
  const notable=sumData?.notablePlays||[];
  const scoring=sumData?.scoringPlays||[];
  const qNarr=sumData?.quarterNarrative||[];
  const series=wpSeries||[];
  let explanation="";

  // Helper to describe a ratio in natural English
  const ratioText=(r)=>{
    if(r>=4.5)return`about ${Math.round(r)} times`;
    if(r>=3.5)return"about four times";
    if(r>=2.5)return"about three times";
    if(r>=1.8)return"about twice";
    if(r>=1.5)return`about ${r.toFixed(1)}x`;
    return"close to";
  };

  if(k==="leverage"){
    const sumAbs=wpStats?.sumAbsDelta;
    const maxAbs=wpStats?.maxAbsDelta;
    if(sumAbs!=null){
      const ratio=sumAbs/1.5;
      if(ratio>=3) explanation=`This was an extraordinarily volatile game — ${ratioText(ratio)} the total WP movement of a typical NFL game. Almost every possession felt like it mattered.`;
      else if(ratio>=2) explanation=`This game had ${ratioText(ratio)} the total WP movement of a typical NFL game. The win probability line was in near-constant motion.`;
      else if(ratio>=1.3) explanation=`Total WP movement was above average — ${ratioText(ratio)} a typical game. There were enough swings to keep it interesting throughout.`;
      else if(ratio>=0.8) explanation=`Total WP movement was close to the NFL average. This was a standard-volatility game, with some meaningful plays but nothing extreme.`;
      else if(ratio>=0.5) explanation=`This was a quieter game than most, with less WP movement than a typical matchup. One team established control early.`;
      else explanation=`Very little WP movement — one of the least volatile games you'll see. The outcome was rarely in question.`;

      if(topPlay){
        const swingPct=Math.round((maxAbs||0)*100);
        const playDesc=_describePlay(topPlay.text,{
          period:topPlay.period, clock:topPlay.clock,
          homeScore:topPlay.homeScore, awayScore:topPlay.awayScore,
          homeName:homeN, awayName:awayN
        });
        if(swingPct>=30) explanation+=` The single biggest play swung WP by a massive ${swingPct}%`;
        else if(swingPct>=15) explanation+=` The biggest single-play swing was ${swingPct}%`;
        else explanation+=` The peak play moved WP by ${swingPct}%`;
        if(playDesc) explanation+=`: ${playDesc}.`;
        else explanation+=`.`;
      }
      // Mention secondary play if it was also significant
      if(secondPlay){
        const secSwing=Math.round((secondPlay.absDelta||0)*100);
        if(secSwing>=15){
          const secDesc=_humanizePlay(secondPlay.text);
          if(secDesc) explanation+=` Another ${secSwing}% swing came on ${secDesc}.`;
        }
      }
    }
  } else if(k==="swings"){
    const c50=wpStats?.crosses50||0;
    const bandCrosses=wpStats?.crosses40_60||0;
    if(c50===0){
      explanation=`The favored team's WP never dropped below 50% — ${winnerN} was in control the entire way.`;
      const takeoverQ=qNarr.find(q=>{
        const diff=g.hs>g.as?(q.endHS-q.endAS):(q.endAS-q.endHS);
        return diff>0;
      });
      if(takeoverQ) explanation+=` They took the lead in Q${takeoverQ.q} and never looked back.`;
      if(margin<=7) explanation+=` Despite the close final score, the momentum was one-directional.`;
    } else if(c50===1){
      explanation=`The WP advantage changed hands just once. ${winnerN} grabbed the favorable position and held it.`;
      // Try to identify when the decisive shift happened
      const crossPlay=series.find((s,i)=>i>0&&series[i-1]&&((series[i-1].wp<0.5&&s.wp>=0.5)||(series[i-1].wp>=0.5&&s.wp<0.5)));
      if(crossPlay) explanation+=` The decisive shift came in ${_qLabel(crossPlay.period)}${crossPlay.clock?` with ${crossPlay.clock} remaining`:""}.`;
    } else if(c50>=6){
      explanation=`Win probability crossed 50% a remarkable ${c50} times — this game was complete chaos. Neither team could establish any sustained control, making every drive feel pivotal.`;
    } else if(c50>=4){
      explanation=`The WP advantage changed hands ${c50} times — a genuine back-and-forth affair where neither team could establish control. Every time one team built momentum, the other answered.`;
    } else if(c50>=2){
      explanation=`The WP advantage changed hands ${c50} times. There were stretches of control, but they didn't last. The game had a natural rhythm of runs and counter-runs.`;
    }
  } else if(k==="clutch"){
    const lateSum=wpStats?.lateSumAbsDelta;
    const latePeak=wpStats?.lateMaxAbsDelta;
    const hasOT=series.some(s=>s.period>4);
    const atCrunch=series.filter(s=>s.period===4&&s.remSec!=null&&s.remSec<=520&&s.remSec>=420)[0];
    const crunchDiff=atCrunch?Math.abs(atCrunch.homeScore-atCrunch.awayScore):null;
    const crunchLeader=atCrunch?(atCrunch.homeScore>atCrunch.awayScore?homeN:atCrunch.homeScore<atCrunch.awayScore?awayN:null):null;
    const crunchHigh=atCrunch?Math.max(atCrunch.homeScore,atCrunch.awayScore):0;
    const crunchLow=atCrunch?Math.min(atCrunch.homeScore,atCrunch.awayScore):0;

    if(lateSum!=null&&lateSum>=0.8){
      if(crunchLeader) explanation=`With 8 minutes to play, ${crunchLeader} led ${crunchHigh}-${crunchLow}`;
      else if(atCrunch) explanation=`With 8 minutes to play, it was tied ${crunchHigh}-${crunchLow}`;
      else explanation=`The final 8 minutes were electric`;
      if(crunchDiff!=null&&crunchDiff<=3) explanation+=` — a one-score game with everything on the line`;
      else if(crunchDiff!=null&&crunchDiff<=7) explanation+=` — still a one-score game`;
      explanation+=`. What followed was some of the most dramatic football you'll see. `;
      // List late scoring plays with context
      const lateScoring=scoring.filter(s=>s.period>=4);
      if(lateScoring.length>=3) explanation+=`There were ${lateScoring.length} scoring plays in the final stretch. `;
      else if(lateScoring.length>0){
        const descs=lateScoring.slice(0,3).map(s=>{
          const txt=_humanizePlay(s.text);
          return txt||`a ${s.type||"score"} in the ${_qLabel(s.period)}`;
        }).filter(Boolean);
        if(descs.length) explanation+=`Key moments: ${descs.join("; ")}. `;
      }
      if(hasOT) explanation+=`The game needed overtime to decide a winner.`;
    } else if(lateSum!=null&&lateSum>=0.5){
      if(crunchLeader) explanation=`With 8 minutes to play, ${crunchLeader} led ${crunchHigh}-${crunchLow}`;
      else if(atCrunch) explanation=`With 8 minutes to play, it was tied ${crunchHigh}-${crunchLow}`;
      else explanation=`The final 8 minutes were eventful`;
      if(crunchDiff!=null&&crunchDiff<=7&&crunchDiff>0) explanation+=` — still a one-score game`;
      explanation+=`. `;
      const lateScoring=scoring.filter(s=>s.period>=4);
      if(lateScoring.length>0){
        const descs=lateScoring.slice(0,3).map(s=>{
          const txt=_humanizePlay(s.text);
          return txt||`${s.type||"score"} in the ${_qLabel(s.period)}`;
        }).filter(Boolean);
        if(descs.length) explanation+=`Down the stretch: ${descs.join("; ")}. `;
      }
    } else if(lateSum!=null){
      if(crunchLeader&&crunchDiff!=null&&crunchDiff>=21){
        explanation=`By the 8-minute mark, ${crunchLeader} was up ${crunchHigh}-${crunchLow}. With a ${crunchDiff}-point lead, the remaining time was garbage time.`;
      } else if(crunchLeader&&crunchDiff!=null&&crunchDiff>=14){
        explanation=`By the 8-minute mark, ${crunchLeader} already led ${crunchHigh}-${crunchLow}. The ${crunchDiff}-point cushion was never seriously threatened, so the final minutes were largely procedural.`;
      } else if(crunchLeader){
        explanation=`With 8 minutes to play, ${crunchLeader} led ${crunchHigh}-${crunchLow} and controlled the clock from there. The endgame was more about execution than drama.`;
      } else {
        explanation=`The outcome was largely decided before the final 8 minutes. There wasn't much late-game tension.`;
      }
    }
  } else if(k==="control"){
    const frac=wpStats?.doubtFrac;
    const pct=Math.round((frac||0)*100);
    if(frac!=null){
      const firstHalfPlays=series.filter(s=>s.period<=2);
      const secondHalfPlays=series.filter(s=>s.period>=3);
      const firstDoubt=firstHalfPlays.filter(s=>s.wp>=0.2&&s.wp<=0.8).length;
      const secondDoubt=secondHalfPlays.filter(s=>s.wp>=0.2&&s.wp<=0.8).length;
      const secondPct=secondHalfPlays.length>0?Math.round(secondDoubt/secondHalfPlays.length*100):0;
      const firstPct=firstHalfPlays.length>0?Math.round(firstDoubt/firstHalfPlays.length*100):0;

      if(frac>=0.80){
        explanation=`The outcome was genuinely in doubt for ${pct}% of the game — nearly the entire contest. This was as competitive as NFL games get, with neither team ever able to build a comfortable cushion.`;
      } else if(frac>=0.65&&secondPct>=60){
        explanation=`The outcome was in doubt for ${pct}% of the game, with genuine uncertainty lasting well into the second half. This was competitive from start to finish.`;
      } else if(frac>=0.50&&secondPct<40){
        explanation=`About ${pct}% of the game fell within the uncertain zone (WP between 20-80%), but most of that uncertainty was in the first half (${firstPct}% uncertain vs. ${secondPct}% in the second half). ${winnerN} pulled away after halftime, so the game felt more lopsided than the raw number suggests.`;
      } else if(frac>=0.50){
        explanation=`About ${pct}% of the game was genuinely competitive. The WP stayed in uncertain territory for extended stretches, giving fans of both teams reason to believe.`;
      } else if(frac>=0.30){
        explanation=`Only ${pct}% of the game was truly competitive. ${winnerN} controlled most of it, though there were moments where the outcome briefly felt uncertain.`;
      } else {
        explanation=`Only ${pct}% of the game was truly competitive. ${winnerN} was firmly in control for the vast majority, leaving little doubt about the final result from early on.`;
      }
    }
  } else if(k==="chaos"){
    const turnovers=notable.filter(p=>p.type==="INT"||p.type==="FUM");
    const bigTOs=series.filter(s=>s.tag==="TO"||s.tag==="SP").sort((a,b)=>(b.absDelta||0)-(a.absDelta||0));
    const specialPlays=series.filter(s=>s.tag==="SP");

    if(turnovers.length===0&&specialPlays.length===0){
      explanation=`No turnovers or impactful special teams plays. Both offenses protected the ball and the game unfolded methodically without sudden momentum shifts.`;
    } else if(turnovers.length===0){
      explanation=`No turnovers, but special teams contributed ${specialPlays.length} significant play${specialPlays.length>1?"s":""}. `;
    } else {
      const ints=turnovers.filter(t=>t.type==="INT").length;
      const fums=turnovers.filter(t=>t.type==="FUM").length;
      if(turnovers.length>=4) explanation=`A chaotic ${turnovers.length}-turnover game. `;
      else explanation=`There ${turnovers.length===1?"was":"were"} ${turnovers.length} turnover${turnovers.length>1?"s":""} in this game`;
      if(ints>0&&fums>0) explanation+=` (${ints} interception${ints>1?"s":""} and ${fums} fumble${fums>1?"s":""})`;
      explanation+=`. `;

      // Describe the most impactful turnover with full context
      if(bigTOs[0]){
        const to=bigTOs[0];
        const toPer=_qLabel(to.period);
        const toHomeScore=to.homeScore, toAwayScore=to.awayScore;
        const possTeam=to.teamId;
        const homeTeamId=sumData?.homeTeamId;
        const awayTeamId=sumData?.awayTeamId;
        const losingTeam=(homeTeamId&&possTeam==homeTeamId)?homeN:(awayTeamId&&possTeam==awayTeamId)?awayN:null;
        let situation="";
        if(toHomeScore!=null&&toAwayScore!=null){
          const high=Math.max(toHomeScore,toAwayScore), low=Math.min(toHomeScore,toAwayScore);
          const leader=toHomeScore>toAwayScore?homeN:toHomeScore<toAwayScore?awayN:null;
          if(leader) situation=`while ${leader} led ${high}-${low}`;
          else situation=`with the game tied ${high}-${low}`;
        }
        const clock=to.clock;
        const swingPct=Math.round((to.absDelta||0)*100);
        const toText=_humanizePlay(to.text);
        explanation+=`The most impactful occurred `;
        if(situation) explanation+=`${situation} `;
        if(clock) explanation+=`with ${clock} left in the ${toPer}`;
        else explanation+=`in the ${toPer}`;
        if(toText) explanation+=`: ${toText}`;
        if(swingPct>=10) explanation+=` — a ${swingPct}% WP swing`;
        else if(swingPct>=5) explanation+=` (${swingPct}% WP swing)`;
        explanation+=`. `;
      }
      if(turnovers.length>=4) explanation+=`That volume of turnovers made the game feel chaotic and unpredictable — a rollercoaster for fans of both teams.`;
      else if(turnovers.length>=3) explanation+=`The turnovers kept the game from ever settling into a rhythm.`;
    }
  } else if(k==="comeback"){
    const cbf=wpStats?.comebackFactor||1;
    const winnerLowest=wpStats?.minWP!=null&&wpStats?.maxWP!=null?(g.hs>g.as?wpStats.minWP:1-wpStats.maxWP):null;
    const winnerLowestPct=winnerLowest!=null?Math.round(winnerLowest*100):null;
    if(cbf>=8){
      explanation=`This was a legendary comeback. ${winnerN}'s win probability dropped as low as ${winnerLowestPct}% — meaning the analytics gave them just a 1-in-${Math.round(cbf)} chance of winning at their lowest point. Clawing back from that kind of deficit is what makes sports unforgettable.`;
    } else if(cbf>=4){
      explanation=`${winnerN} staged a significant comeback. At their lowest point, their win probability was just ${winnerLowestPct}% — less than a 1-in-${Math.round(cbf)} chance. They overcame a substantial deficit to win this one.`;
    } else if(cbf>=2.5){
      explanation=`${winnerN} had to fight back from a meaningful deficit. Their WP dropped to ${winnerLowestPct}% at one point before they turned things around. Not a legendary comeback, but they earned it.`;
    } else if(cbf>=1.5){
      explanation=`${winnerN} trailed briefly but was never in serious danger. Their lowest WP was ${winnerLowestPct}%, which means they were always roughly in contention. A mild comeback at most.`;
    } else {
      explanation=`No real comeback here. ${winnerN} was in control for most or all of the game, never dropping below a ${winnerLowestPct}% win probability. The result was rarely in doubt.`;
    }
  } else if(k==="finish"){
    const df=wpStats?.dramaticFinish;
    if(df?.walkOff){
      explanation=`This game ended with a walk-off score — the ultimate dramatic finish. The winning points came in the final seconds${df.otWinner?" of overtime":""}, giving the other team no chance to respond. These are the games fans remember forever.`;
      if(df.margin!=null&&df.margin<=3) explanation+=` The final margin of just ${df.margin} point${df.margin>1?"s":""} underscores how close it was.`;
    } else if(df?.goAheadFinal2Min){
      explanation=`The go-ahead score came in the final two minutes, creating maximum tension. ${df.otWinner?"The game also required overtime to settle it. ":""}Even though the trailing team had a chance to respond, scoring that late puts enormous pressure on both sides.`;
    } else if(df?.otWinner){
      explanation=`This game went to overtime, which inherently adds drama — the pressure of sudden-death (or near sudden-death) football elevates every play. The winning score in OT gave this a dramatic finish bonus.`;
    } else if(df?.finalPlayScore){
      explanation=`A score on the final play of the game always delivers a dramatic conclusion, regardless of the margin.`;
    } else {
      explanation=`This game had a standard finish — the outcome was effectively decided before the final moments. No walk-off scores, no last-second heroics. The drama came earlier in the game, if at all.`;
    }
  } else if(k==="contextR"){
    if(cat.score>=8) explanation=`${homeN} and ${awayN} have one of the NFL's deepest and fiercest rivalries. Games between these teams carry decades of history, and that intensity elevates the emotional stakes far beyond what the standings alone suggest.`;
    else if(cat.score>=6) explanation=`${homeN} and ${awayN} are bitter rivals with a long history of competitive, meaningful matchups. The familiarity between these teams adds an edge that neutral games can't match.`;
    else if(cat.score>=4){
      const sameDiv = (sumData?.homeDivision && sumData?.awayDivision && sumData.homeDivision===sumData.awayDivision);
      explanation = sameDiv
        ? `${homeN} and ${awayN} are division rivals who play each other twice a year. That familiarity breeds contempt — and usually better football.`
        : `${homeN} and ${awayN} are familiar opponents with some rivalry history, adding an extra edge to the matchup.`;
    } else if(cat.score>=2) {
      explanation=`A modest rivalry. These teams have some history, but it doesn't carry the same intensity as the league's premier matchups.`;
    } else {
      explanation=`Not a significant rivalry. These teams don't have notable history, so the drama here came purely from the game itself.`;
    }
  } else if(k==="contextS"){
    const detail=cat.detail||"";
    if(cat.score>=9) explanation=`The highest possible stakes. ${detail.includes("Super Bowl")?"The Super Bowl — the biggest single game in American sports. Every play matters more because there's no next week.":detail.includes("Championship")?"A conference championship with a Super Bowl berth on the line. The pressure is immense.":"A win-or-go-home playoff game with maximum stakes."}`;
    else if(cat.score>=7) explanation=`Major playoff stakes. ${detail.includes("Divisional")?"A divisional round game where every possession carries enormous weight.":detail.includes("Wild")?"A Wild Card game where one mistake can end a team's season.":"The playoff atmosphere elevates every moment."}`;
    else if(cat.score>=5) explanation=`This game carried real standings implications. ${detail.includes("both in the mix")?"Both teams were in the thick of the playoff race, making this a de facto elimination game.":"The result had meaningful consequences beyond the win-loss column."}`;
    else if(cat.score>=3) explanation=`Some standings implications, but not a must-win for either team. The result matters for seeding and positioning, though the pressure level is moderate.`;
    else if(detail.includes("resting")) explanation=`Reduced stakes. ${detail.split("·").pop()?.trim()||"At least one team appeared to be resting key players."} That context limits the game's competitive significance and explains the lower score here.`;
    else explanation=`Not a high-stakes matchup on paper. Early-season games or matchups between struggling teams don't carry the same weight. The drama had to come from the field.`;
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
  const[t1,sT1]=useState("");const[t2,sT2]=useState("");const[ssn,sSsn]=useState("2025");const[wk,sWk]=useState("");const[st,sSt]=useState("2");
  const[games,sGames]=useState([]);const[ldg,sLdg]=useState(false);const[prog,sProg]=useState({p:0,t:""});
  const[sort,sSort]=useState("dateDesc");
  const[det,sDet]=useState(null);const[ldD,sLdD]=useState(false);const[err,sErr]=useState(null);
  const[meth,sMeth]=useState(false);const[cache,sCache]=useState({});const[batching,sBatching]=useState(false);
  const[summary,sSummary]=useState(null);const[sumData,sSumData]=useState(null);const[sumLoading,sSumLoading]=useState(false);const[selGame,sSelGame]=useState(null);
  const detRef=useRef(null);

  const seasons=[];for(let y=2025;y>=2001;y--)seasons.push(""+y);
  const weeks=[];for(let w=1;w<=18;w++)weeks.push(""+w);

  useEffect(()=>{if(det&&detRef.current)detRef.current.scrollIntoView({behavior:'smooth',block:'start'})},[det]);

  const search=useCallback(async()=>{
    if(!ssn&&!t1){sErr("Select at least a season or team.");return}
    sLdg(true);sGames([]);sDet(null);sSummary(null);sErr(null);sCache({});sProg({p:0,t:"Searching..."});sSelGame(null);sSort("dateDesc");
    try{
      let fetchFailures=0,fetchBatches=0;
      const res=[];let seasonsToSearch=ssn?[ssn]:[];
      if(!ssn)for(let y=2025;y>=2016;y--)seasonsToSearch.push(""+y);
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
      const wp2=getWPSeriesPlus(d);
      const box=buildBox(d);const stats=buildStats(d);const pStats=buildPlayerStats(d);
      sDet({exc,kp,box,stats,pStats,d,wp,wp2});sCache(p=>({...p,[g.id]:exc.total}));sLdD(false);
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
    h("div",{className:"hdr"},h("div",{className:"hdr-tag"},"2001 \u2014 Present"),h("h1",null,"NFL Excitement Index"),h("div",{className:"sub"},"Quantifying what makes football unforgettable")),
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
        h("div",{className:"hints"},!ssn&&t1?"Will search 2016-2025. Select a season for faster results.":"Set a team + season to see all their games.")),
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
  const{exc,kp,box,stats,pStats,wp,wp2}=d;const og=oGrade(exc.total);
  const date=new Date(g.date).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const tags={td:["TD","t-td"],fg:["FG","t-cl"],to:["TURNOVER","t-to"],bg:["BIG PLAY","t-bg"],cl:["CLUTCH","t-cl"],sp:["SPECIAL","t-sp"],"4d":["4TH DOWN","t-bg"]};
  const passCols=["C/ATT","YDS","AVG","TD","INT","QBR"];
  const[wpMode,setWpMode]=useState("Leverage");
  const[wpModel,setWpModel]=useState("Both");
  const[catModal,setCatModal]=useState(null);
  const[tab,setTab]=useState("overview"); // "overview", "stats", "analysis"
  const rushCols=["CAR","YDS","AVG","TD","LONG"];
  const recCols=["REC","YDS","AVG","TD","LONG","TGTS"];

  function pfrLink(name){
    if(!name)return"#";
    return`https://www.pro-football-reference.com/search/search.fcgi?search=${encodeURIComponent(name)}`;
  }
  function pTable(label,players,cols){
    if(!players||players.length===0)return null;
    const useCols=cols.filter(c=>players.some(p=>p[c]!=null&&p[c]!==""));
    return h(Fragment,null,
      h("tr",null,h("td",{className:"pst-cat",colSpan:useCols.length+1},label)),
      h("tr",null,h("th",null,"Player"),...useCols.map(c=>h("th",{key:c},c))),
      players.map((p,i)=>h("tr",{key:i},h("td",null,h("a",{href:pfrLink(p.name),target:"_blank",rel:"noopener noreferrer",className:"pfr-link"},p.name),h("span",{className:"tm-tag"},p.team)),...useCols.map(c=>h("td",{key:c},p[c]||"\u2014")))));
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
      h("a",{className:"hl-btn",href:`https://www.youtube.com/results?search_query=${encodeURIComponent(`${tn(g.at)} vs ${tn(g.ht)} ${new Date(g.date).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})} highlights NFL`)}`,target:"_blank",rel:"noopener noreferrer"},
        h("svg",{viewBox:"0 0 24 24"},h("path",{d:"M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"})),"Watch Highlights"),
      h("div",{className:"hero-e"},
        h("div",{className:"hero-el"},"Excitement Index"),
        h("div",{className:"radial-gauge"},
          h("svg",{viewBox:"0 0 120 120"},
            // Background arc
            h("circle",{cx:60,cy:60,r:50,fill:"none",stroke:"var(--border-1)",strokeWidth:6,strokeDasharray:`${Math.PI*100}`,strokeDashoffset:0,transform:"rotate(-90 60 60)",strokeLinecap:"round"}),
            // Colored arc (animated via CSS)
            h("circle",{cx:60,cy:60,r:50,fill:"none",stroke:`var(--g${og.c})`,strokeWidth:6,
              strokeDasharray:`${Math.PI*100}`,
              strokeDashoffset:`${Math.PI*100*(1-Math.min(exc.total,100)/100)}`,
              transform:"rotate(-90 60 60)",strokeLinecap:"round",
              style:{transition:"stroke-dashoffset 1.5s cubic-bezier(.16,1,.3,1)"}})),
          h("div",{className:"gauge-label"},
            h("div",{className:`gauge-score ${cc(og.c)}`},exc.total),
            h("div",{className:`gauge-grade ${cc(og.c)}`},`${og.g} — ${og.l}`))))),
    // Tab navigation
    h("div",{className:"tab-bar an a1"},
      h("button",{className:`tab-btn${tab==="overview"?" active":""}`,onClick:()=>setTab("overview")},"Overview"),
      h("button",{className:`tab-btn${tab==="stats"?" active":""}`,onClick:()=>setTab("stats")},"Stats"),
      h("button",{className:`tab-btn${tab==="analysis"?" active":""}`,onClick:()=>setTab("analysis")},"Analysis")),
    // OVERVIEW TAB
    tab==="overview"?h(Fragment,null,
      box.length>0?h("div",{className:"sec an a1"},h("div",{className:"sec-h"},"Box Score"),
        h("table",{className:"bt"},h("thead",null,h("tr",null,h("th",null,""),
          ...(box[0]?.qs||[]).map((_,i)=>h("th",{key:i},i>=4?`OT${i>4?i-3:""}`:`Q${i+1}`)),h("th",null,"Final"))),
          h("tbody",null,box.map((r,i)=>h("tr",{key:i,className:r.win?"win":""},h("td",null,r.team),...r.qs.map((q,qi)=>h("td",{key:qi},q==null?"\u2014":q)),h("td",{className:"fc"},r.total==null?"\u2014":r.total)))))):null,
      WPChart({seriesE:wp?.series||[],seriesAlt:wp2?.series||[],modelSel:wpModel,onModelChange:setWpModel,mode:wpMode,onModeChange:setWpMode,exc,topLev:(sumData?.enrichedPlays||sumData?.topLeveragePlays||[]),homeTeam:g.ht,awayTeam:g.at,scoringPlays:sumData?.scoringPlays||[]}),
      h("div",{className:"sec an a5"},h("div",{className:"sec-h"},"Game Recap"),
        h("div",{className:"wb"},sumLoading?h("p",{style:{fontStyle:"italic",color:"var(--text-3)"}},"Generating game recap..."):
          summary?summary.map((p,i)=>h("p",{key:i},p)):h("p",{style:{color:"var(--text-3)"}},"Recap unavailable."))),
      kp.length>0?h("div",{className:"sec an a6"},h("div",{className:"sec-h"},"Key Plays"),
        kp.map((p,i)=>{const tl=p.tag?.toLowerCase();const[lbl,cls]=tags[tl]||[p.tag||"",""];
          const playText=_humanizePlay(p.text)||p.text;
          const scoreText=p.homeScore!=null&&p.awayScore!=null?` (${tn(g.ht)} ${p.homeScore}, ${tn(g.at)} ${p.awayScore})`:"";
          return h("div",{key:i,className:"pi"},h("div",{className:"pt2"},`${p.period>=5?"OT":`Q${p.period}`} ${p.clock}`),
            h("div",{className:"ptx"},h("span",{className:`ptg ${cls}`},lbl),playText,h("span",{style:{color:"var(--text-3)",fontSize:".8em"}},scoreText)))})):null
    ):null,
    // STATS TAB
    tab==="stats"?h(Fragment,null,
      box.length>0?h("div",{className:"sec an a1"},h("div",{className:"sec-h"},"Box Score"),
        h("table",{className:"bt"},h("thead",null,h("tr",null,h("th",null,""),
          ...(box[0]?.qs||[]).map((_,i)=>h("th",{key:i},i>=4?`OT${i>4?i-3:""}`:`Q${i+1}`)),h("th",null,"Final"))),
          h("tbody",null,box.map((r,i)=>h("tr",{key:i,className:r.win?"win":""},h("td",null,r.team),...r.qs.map((q,qi)=>h("td",{key:qi},q==null?"\u2014":q)),h("td",{className:"fc"},r.total==null?"\u2014":r.total)))))):null,
      stats.length>0?h("div",{className:"sec an a2"},h("div",{className:"sec-h"},"Team Statistics"),
      h("table",{className:"st"},h("thead",null,h("tr",null,h("th",{style:{textAlign:"right",width:"35%"}},box[0]?.team||"Away"),h("th",{style:{textAlign:"center",width:"30%"}},""),h("th",{style:{textAlign:"left",width:"35%"}},box[1]?.team||"Home"))),
        h("tbody",null,stats.map((s,i)=>h("tr",{key:i},h("td",{style:{textAlign:"right"}},s.away),h("td",{className:"sn"},s.label),h("td",{style:{textAlign:"left"}},s.home)))))):null,
    pStats&&(pStats.passing.length>0||pStats.rushing.length>0||pStats.receiving.length>0)?
      h("div",{className:"sec an a3"},h("div",{className:"sec-h"},"Player Statistics"),h("table",{className:"pst"},h("tbody",null,
        pTable("Passing",pStats.passing,passCols),pTable("Rushing",pStats.rushing,rushCols),pTable("Receiving",pStats.receiving,recCols)))):null
    ):null,
    // ANALYSIS TAB
    tab==="analysis"?h(Fragment,null,
      h("div",{className:"sec an a4"},h("div",{className:"sec-h"},"Excitement Breakdown"),
      h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".6rem",color:"var(--text-4)",marginBottom:".4rem",marginTop:"-.4rem"}},"Tap any category for game-specific details"),
      h("div",{className:"gg"},Object.entries(exc.scores).map(([k,v])=>{const gr=gradeFor(v.score,v.max);const pct=v.score/v.max*100;
        return h("div",{key:k,className:"gc",onClick:()=>setCatModal({k,cat:v}),style:{cursor:"pointer"}},
          h("div",{className:"gi"},h("h3",null,v.name),h("div",{className:"ds"},v.desc),h("div",{className:"dt"},v.detail),h("div",{className:"br"},h("div",{className:`bf ${bc(gr.c)}`,style:{width:`${pct}%`}}))),
          h("div",{className:`gbg ${cc(gr.c)}`},h("div",null,gr.g),h("div",{className:"pt"},`${v.score}/${v.max}`)))}))),
      WPChart({seriesE:wp?.series||[],seriesAlt:wp2?.series||[],modelSel:wpModel,onModelChange:setWpModel,mode:wpMode,onModeChange:setWpMode,exc,topLev:(sumData?.enrichedPlays||sumData?.topLeveragePlays||[]),homeTeam:g.ht,awayTeam:g.at,scoringPlays:sumData?.scoringPlays||[]}),
      h("div",{className:"sec an a7"},
      h("button",{className:"mt",onClick:()=>sMeth(!meth)},meth?"\u25be":"\u25b8"," Scoring Methodology"),
      meth?h("div",{className:"mb"},
        h("h4",null,"How It Works"),"The Excitement Index is built on win probability (WP). We compute home-team WP for every play using an nflfastR-inspired model that incorporates score differential, game time, field position, down & distance, timeouts, and home-field advantage — with exponential time-weighting of score differential to capture how leads become more decisive as the clock runs down. Games with volatile, uncertain, late-swinging WP curves score highest.",
        h("h4",null,"Leverage (0\u201325)"),"Total absolute WP movement (\u03a3|\u0394WP|) across all plays, weighted toward the single largest swing. A typical NFL game totals ~1.5; classics push above 2.5.",
        h("h4",null,"Momentum (0\u201315)"),"How often the likely winner changed (WP crossing 50%) and the game shifted between advantage states (40/60% bands).",
        h("h4",null,"Clutch Time (0\u201315)"),"WP movement in the final 8 min of Q4 and all OT. Late swings carry more emotional weight.",
        h("h4",null,"In Doubt (0\u201310)"),"Percentage of the game where WP was between 20% and 80%. Longer uncertainty = more competitive feel.",
        h("h4",null,"Chaos (0\u201310)"),"Direct count of turnovers (interceptions, fumble recoveries) and special teams impact plays. Bonus points for return TDs (pick-sixes, fumble-sixes, kick/punt return TDs).",
        h("h4",null,"Comeback Factor (0\u20135)"),"Measures how deep a hole the winning team climbed out of, using 1/(winner's lowest WP). A team that was down to 10% WP and won scores much higher than one that led wire-to-wire.",
        h("h4",null,"Dramatic Finish (0\u20135)"),"Rewards walk-off scores, go-ahead TDs in the final 2 minutes, overtime game-winners, and scores on the literal final play. Close final margins add a bonus.",
        h("h4",null,"Context: Stakes (0\u201310)"),"Playoffs score highest (Super Bowl = 10). Regular season weighted by week + both teams' records.",
        h("h4",null,"Context: Rivalry (0\u201310)"),"Historical rivalry intensity + division familiarity. Context categories capped at 16 combined to prevent them from inflating a boring game."
      ):null)
    ):null);
}

createRoot(document.getElementById("app")).render(h(App));
