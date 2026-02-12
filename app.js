import{createElement as h,useState,useCallback,useEffect,useRef,Fragment}from"https://esm.sh/react@18.2.0";
import{createRoot}from"https://esm.sh/react-dom@18.2.0/client";
import{TEAMS,tn,TK,espnSB,espnSum,parseEv,computeExc,oGrade,gradeFor,extractKP,buildBox,buildStats,buildPlayerStats,buildSummaryData,getAllPlays,getWPSeries,getWPSeriesPlus}from"./engine.js";

const cc=c=>({s:"cs",a:"ca",b:"cb",c:"cc",d:"cd",f:"cf"}[c]||"");
const bc=c=>({s:"bs",a:"ba",b:"bbl",c:"bc",d:"bd",f:"bf2"}[c]||"");
const normTeam=(x)=>x==="LAR"?"LA":x;
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
  const enriched=(sum.enrichedPlays||[]).map(p=>({...p,text:_humanizePlay(p.text)})).filter(p=>p.text);
  const leaders=sum.leaders||[];
  const qNarr=sum.quarterNarrative||[];
  const wp=sum.wpStats||{};
  const notable=sum.notablePlays||[];
  const scoring=sum.scoringPlays||[];
  const pRound=sum.playoffRound||"";
  const paragraphs=[];
  const scoreStr=`${winScore}-${loseScore}`;
  const totalPts=winScore+loseScore;
  const isTie=(hs===as);

  // ── Helper: evaluate passer quality ──
  function _passerQuality(l){
    if(!l||l.type!=="passing")return"ok";
    const m=(l.line||"").match(/(\d+)\/(\d+)/);
    if(!m)return"ok";
    const comp=+m[1],att=+m[2];
    const pct=att>0?comp/att:0;
    const ypa=att>0?l.yds/att:0;
    const intMatch=l.line.match(/(\d+)\s*INT/);
    const ints=intMatch?+intMatch[1]:0;
    if(l.td>=3&&pct>=.60&&ypa>=7)return"dominant";
    if(l.td>=2&&pct>=.65)return"sharp";
    if(pct>=.65&&l.td>=1)return"efficient";
    if(ints>=2&&l.td<=1)return"mistake-prone";
    if(pct<.50||ypa<5)return"poor";
    return"ok";
  }

  // ── All winners/losers, sorted by impact ──
  const wAll=leaders.filter(l=>l.team===wAb).sort((a,b)=>(b.td*80+b.yds)-(a.td*80+a.yds));
  const lAll=leaders.filter(l=>l.team===lAb).sort((a,b)=>(b.td*80+b.yds)-(a.td*80+a.yds));
  const wBest=wAll[0], wSecond=wAll[1], wThird=wAll[2];
  const lBest=lAll[0], lSecond=lAll[1];
  const winQB=leaders.find(l=>l.team===wAb&&l.type==="passing");
  const loseQB=leaders.find(l=>l.team===lAb&&l.type==="passing");
  const wQBq=_passerQuality(winQB);
  const lQBq=_passerQuality(loseQB);
  const turnovers=notable.filter(p=>p.type==="INT"||p.type==="FUM");
  const totalTOs=turnovers.length;

  // ── LEDE: Varied, archetype-aware openers ──
  let opener="";
  let ctxPre="";
  if(pRound==="Super Bowl") ctxPre="In the Super Bowl, ";
  else if(pRound==="Conference Championship") ctxPre="In the conference championship, ";
  else if(pRound) ctxPre=`In the ${pRound}, `;

  if(arche==="comeback"&&deficit>=17){
    opener=`${ctxPre}${W} pulled off a stunning comeback. Down ${deficit} points, they clawed their way back for a ${scoreStr} victory${hasOT?" that needed overtime to settle":""}. `;
    if(wBest&&wBest.td>=2) opener+=`${wBest.name} was at the center of the rally, finishing with ${wBest.line}.`;
    else opener+=`In a sport where deficits like that are usually death sentences, ${W} refused to fold.`;
  } else if(arche==="comeback"&&deficit>=10){
    opener=`${ctxPre}${W} overcame a ${deficit}-point hole to win ${scoreStr}${hasOT?" in overtime":""}. `;
    if(wBest&&wBest.td>=2) opener+=`${wBest.name} (${wBest.line}) fueled the comeback.`;
    else opener+=`It was the kind of deficit that usually ends one way — but not this time.`;
  } else if(arche==="comeback"){
    opener=`${ctxPre}${W} trailed for most of this game before surging late for a ${scoreStr} win${hasOT?" in overtime":""}. `;
    if(deficit>=7) opener+=`They wiped out a ${deficit}-point deficit along the way.`;
  } else if(arche==="seesaw"&&(wp.crosses50||0)>=5){
    opener=`${ctxPre}Neither team could separate in this wild one. The lead changed hands ${wp.crosses50} times before ${W} came out on top, ${scoreStr}${hasOT?" in overtime":""}.`;
  } else if(arche==="seesaw"){
    opener=`${ctxPre}This was a genuine back-and-forth battle — the lead changed hands ${wp.crosses50||"multiple"} times before ${W} held on, ${scoreStr}${hasOT?" in overtime":""}.`;
  } else if(arche==="wire"&&margin>=21){
    opener=`${ctxPre}${W} routed ${L}, ${scoreStr}. This one was a mismatch from the opening whistle. `;
    if(wBest&&wBest.td>=3) opener+=`${wBest.name} headlined with ${wBest.line}.`;
  } else if(arche==="wire"&&margin>=14){
    opener=`${ctxPre}${W} dominated ${L} from start to finish, ${scoreStr}. `;
    if(wBest&&wBest.td>=2) opener+=`${wBest.name} led the way with ${wBest.line}.`;
    else opener+=`It was never competitive.`;
  } else if(arche==="wire"){
    opener=`${ctxPre}${W} controlled this one throughout, winning ${scoreStr}. ${L} never mounted a serious challenge.`;
  } else if(arche==="collapse"&&deficit>=14){
    opener=`${ctxPre}${L} had a ${deficit}-point lead and managed to lose. ${W} stormed back for a ${scoreStr} victory${hasOT?" in overtime":""} that ${L} will want to forget.`;
  } else if(arche==="collapse"){
    opener=`${ctxPre}${L} let this one slip away. After leading comfortably, they watched ${W} close the gap and take it, ${scoreStr}${hasOT?" in overtime":""}.`;
  } else if(hasOT&&margin<=3){
    opener=`${ctxPre}${W} edged ${L} in overtime, ${scoreStr}. Regulation couldn't settle this one, and it took everything ${W} had to come away with the win.`;
  } else if(hasOT){
    opener=`${ctxPre}${W} outlasted ${L} in overtime, ${scoreStr}, after neither team could put this game away in regulation.`;
  } else if(margin===1){
    opener=`${ctxPre}${W} escaped with a one-point win over ${L}, ${scoreStr}. This game came down to the wire.`;
  } else if(margin<=3){
    const methodWord=(loseScore%3===0&&winScore-loseScore<=3)?"survived":"edged";
    opener=`${ctxPre}${W} ${methodWord} ${L}, ${scoreStr}, in a game that came down to the final minutes.`;
  } else if(margin<=7&&totalPts>=50){
    opener=`${ctxPre}In a high-scoring affair, ${W} held off ${L}, ${scoreStr}. The offenses traded blows all day.`;
  } else if(margin<=7){
    opener=`${ctxPre}${W} beat ${L}, ${scoreStr}, in a game tighter than the final score suggests.`;
  } else if(totalPts<=20){
    opener=`${ctxPre}In a defensive grind, ${W} beat ${L}, ${scoreStr}. Points were at a premium.`;
  } else {
    opener=`${ctxPre}${W} beat ${L}, ${scoreStr}.`;
  }
  paragraphs.push(opener);

  // ── GAME FLOW: Richer quarter-by-quarter narrative ──
  let flow="";
  if(qNarr.length>=2){
    const qH=qNarr.find(q=>q.q===2)||qNarr[1];
    const halftimeLead=qH?qH.endHS-qH.endAS:0;
    const hLeader=halftimeLead>0?hN:halftimeLead<0?aN:null;
    const hHigh=qH?Math.max(qH.endHS,qH.endAS):0;
    const hLow=qH?Math.min(qH.endHS,qH.endAS):0;

    // Check for 3rd quarter changes
    const q3=qNarr.find(q=>q.q===3);
    const q3Lead=q3?(q3.endHS-q3.endAS):halftimeLead;
    const leaderFlipped=(halftimeLead>0&&q3Lead<0)||(halftimeLead<0&&q3Lead>0);

    const earlyPlays=notable.filter(p=>p.period<=2&&(p.type==="INT"||p.type==="FUM"||p.type==="BIG"));
    let earlyNote="";
    if(earlyPlays.length>=2){
      const types=[...new Set(earlyPlays.map(p=>p.type))];
      if(types.includes("INT")&&types.includes("FUM")) earlyNote=" Turnovers were a factor early, with both an interception and a fumble in the first half.";
      else if(types.includes("BIG")) earlyNote=` Big plays helped set the tempo, including a ${earlyPlays.find(p=>p.type==="BIG")?.yds}-yard gain in the ${_qLabel(earlyPlays.find(p=>p.type==="BIG")?.period||1)}.`;
      else earlyNote=` Multiple turnovers in the first half helped establish the early dynamic.`;
    } else if(earlyPlays.length===1){
      const ep=earlyPlays[0];
      if(ep.type==="BIG") earlyNote=` A ${ep.yds}-yard play in the ${_qLabel(ep.period)} helped set the tempo.`;
      else if(ep.type==="INT") earlyNote=` An early interception helped set the tone.`;
      else earlyNote=` A first-half fumble shifted the momentum.`;
    }

    if(hLeader&&Math.abs(halftimeLead)>=14){
      flow=`${hLeader} built a commanding ${hHigh}-${hLow} lead by halftime.${earlyNote}`;
      if(hLeader!==W&&leaderFlipped) flow+=` The second half was a completely different game.`;
      else if(hLeader!==W) flow+=` But ${W} came out of the locker room with a different energy.`;
      else if(arche==="wire") flow+=` ${L} never made a serious run at closing the gap.`;
      else flow+=` The question was whether ${L} had an answer.`;
    } else if(hLeader&&Math.abs(halftimeLead)>=7){
      flow=`${hLeader} took a ${hHigh}-${hLow} lead into halftime.${earlyNote}`;
      if(arche==="comeback"||arche==="collapse") flow+=` What happened after the break changed everything.`;
      else if(leaderFlipped) flow+=` The momentum shifted dramatically after the break.`;
      else flow+=` They had the upper hand, but there was still a lot of football left.`;
    } else if(hLeader&&Math.abs(halftimeLead)>=4){
      flow=`It was ${hHigh}-${hLow} ${hLeader} at the break.${earlyNote}`;
      if(arche==="comeback"||arche==="collapse") flow+=` What followed made this game memorable.`;
    } else if(hLeader){
      flow=`${hLeader} held a slim ${hHigh}-${hLow} halftime lead.${earlyNote} This one was still very much up for grabs heading into the second half.`;
    } else if(hHigh===0){
      flow=`It was a scoreless first half — a defensive stalemate.${earlyNote} All the scoring came after the break.`;
    } else {
      flow=`Tied ${hHigh}-${hLow} at the half.${earlyNote} Everything was still up for grabs heading into the third quarter.`;
    }
  }
  if(flow) paragraphs.push(flow);

  // ── KEY PLAYS: Multiple plays with rich context ──
  let plays="";
  if(enriched.length>=1){
    const top=enriched[0];
    const per=top.perLabel==="OT"?"overtime":(top.period>=4?"the fourth quarter":top.perLabel);
    if(top.swingPct>=25){
      plays+=`The defining moment came${top.clock?` with ${top.clock} left in ${per}`:""}: ${top.text} — a massive ${top.swingPct}-percentage-point swing in ${top.beneficiary}'s favor. `;
    } else if(top.swingPct>=10){
      plays+=`The biggest play of the game came${top.clock?` with ${top.clock} left in ${per}`:""}: ${top.text}, shifting win probability ${top.swingPct} points toward ${top.beneficiary}. `;
    } else {
      plays+=`The highest-leverage moment came${top.clock?` with ${top.clock} left in ${per}`:""}: ${top.text}. `;
    }
    // Mention second-biggest play if it's significant and in a different quarter
    if(enriched.length>=2){
      const sec=enriched[1];
      if(sec.swingPct>=12 && sec.period!==top.period){
        const secPer=sec.perLabel==="OT"?"overtime":sec.perLabel;
        plays+=`Earlier, in ${secPer}, ${sec.text}`;
        if(sec.swingPct>=10) plays+=` (${sec.swingPct}% WP swing)`;
        plays+=`. `;
      }
    }
  }

  // Turnovers — richer descriptions
  if(totalTOs>=3){
    const ints=turnovers.filter(t=>t.type==="INT").length;
    const fums=turnovers.filter(t=>t.type==="FUM").length;
    let toDesc=`This game featured ${totalTOs} turnovers`;
    if(ints>0&&fums>0) toDesc+=` (${ints} interception${ints>1?"s":""}, ${fums} fumble${fums>1?"s":""})`;
    toDesc+=`. `;
    const lateTOs=turnovers.filter(p=>p.period>=3);
    if(lateTOs.length>=2) toDesc+=`Two of them came in the second half, where the stakes were highest. `;
    else if(lateTOs.length===1){
      const lto=lateTOs[0];
      toDesc+=`A ${lto.type==="INT"?"interception":"fumble"} in the ${_qLabel(lto.period)} was especially costly. `;
    }
    plays+=toDesc;
  } else if(totalTOs===2){
    const bothLate=turnovers.every(p=>p.period>=3);
    if(bothLate) plays+=`Both of the game's turnovers came in the second half, with each one swinging momentum. `;
    else {
      const bigTO=turnovers.find(p=>p.period>=3)||turnovers[0];
      plays+=`There were two turnovers in this game. A ${bigTO.type==="INT"?"interception":"fumble"} in the ${_qLabel(bigTO.period)} was the more impactful one. `;
    }
  } else if(totalTOs===1){
    const to=turnovers[0];
    if(to.period>=4) plays+=`A ${to.type==="INT"?"interception":"fumble"} in the fourth quarter proved pivotal. `;
    else if(to.period>=3) plays+=`A ${to.type==="INT"?"interception":"fumble"} in the ${_qLabel(to.period)} shifted the momentum. `;
    else plays+=`A ${to.type==="INT"?"interception":"fumble"} in the ${_qLabel(to.period)} was an early factor. `;
  }

  // 4th downs
  const fourthFails=notable.filter(p=>p.type==="4TH_FAIL");
  const fourthConvs=notable.filter(p=>p.type==="4TH_CONV"||p.type==="4TH_ATT");
  if(fourthFails.length>=2) plays+=`Two failed fourth-down conversions played significant roles. `;
  else if(fourthFails.length===1&&fourthFails[0].period>=3) plays+=`A failed fourth-down attempt in the ${_qLabel(fourthFails[0].period)} effectively killed a drive. `;
  else if(fourthConvs.length>=1&&fourthConvs[0].period>=3) plays+=`A gutsy fourth-down conversion in the ${_qLabel(fourthConvs[0].period)} kept a critical drive alive. `;

  // Late sacks
  const sack=notable.find(p=>p.type==="SACK"&&p.period>=4);
  if(sack&&fourthFails.length===0&&totalTOs<3) plays+=`A sack in the fourth quarter stalled a drive at a crucial moment. `;

  if(plays.trim()) paragraphs.push(plays.trim());

  // ── PERFORMERS: Smarter, more natural evaluation ──
  let stars="";

  // Winner's performers — lead with the biggest impact player
  if(wBest){
    if(wBest.type==="rushing"&&wBest.td>=2){
      stars+=`${wBest.name} powered ${W}'s offense on the ground, finishing with ${wBest.line}. `;
      if(winQB&&wQBq!=="poor"&&wQBq!=="mistake-prone") stars+=`${winQB.name} was ${wQBq==="sharp"||wQBq==="dominant"?"excellent":"solid"} through the air (${winQB.line}). `;
    } else if(wBest.type==="rushing"&&wBest.yds>=100){
      stars+=`${wBest.name} anchored the ground game for ${W} with ${wBest.line}. `;
      if(winQB&&wQBq==="dominant") stars+=`${winQB.name} was equally impressive (${winQB.line}). `;
    } else if(wBest.type==="receiving"&&wBest.yds>=120){
      stars+=`${wBest.name} was impossible to cover, finishing with ${wBest.line}. `;
      if(winQB) stars+=`${winQB.name} ${wQBq==="dominant"?"was brilliant finding him":"connected on the key throws"} (${winQB.line}). `;
    } else if(wBest.type==="receiving"&&wBest.td>=2){
      stars+=`${wBest.name} found the end zone ${wBest.td} times for ${W} (${wBest.line}). `;
      if(winQB) stars+=`${winQB.name} delivered the ball when it mattered (${winQB.line}). `;
    } else if(wBest.type==="passing"){
      if(wQBq==="dominant") stars+=`${wBest.name} was outstanding for ${W}, going ${wBest.line}. `;
      else if(wQBq==="sharp") stars+=`${wBest.name} was sharp for ${W}, completing ${wBest.line}. `;
      else if(wQBq==="efficient") stars+=`${wBest.name} was efficient for ${W} (${wBest.line}). `;
      else if(wQBq==="mistake-prone") stars+=`${wBest.name} was inconsistent for ${W} (${wBest.line}), but the team found a way. `;
      else stars+=`${wBest.name} managed the game for ${W} (${wBest.line}). `;
      // Highlight the real playmaker if it's not the QB
      if(wSecond&&wSecond.td>=2){
        stars+=`${wSecond.name} was the real difference-maker with ${wSecond.line}. `;
      } else if(wSecond&&(wSecond.yds>=100||wSecond.td>=1)){
        stars+=`${wSecond.name} contributed ${wSecond.line}. `;
      }
    } else {
      stars+=`${wBest.name} led ${W} with ${wBest.line}. `;
    }
  }

  // Loser's performers — honest but specific evaluation
  if(loseQB){
    if(lQBq==="poor"){
      const m=(loseQB.line||"").match(/(\d+)\/(\d+)/);
      const att=m?+m[2]:0;
      stars+=`${loseQB.name} struggled for ${L}`;
      if(att>=20){
        const ypa=(loseQB.yds/att).toFixed(1);
        stars+=`, completing just ${loseQB.line} (${ypa} yards per attempt)`;
      } else {
        stars+=` (${loseQB.line})`;
      }
      stars+=`. `;
    } else if(lQBq==="mistake-prone"){
      const intMatch=(loseQB.line||"").match(/(\d+)\s*INT/);
      const ints=intMatch?+intMatch[1]:0;
      if(ints>=3) stars+=`${loseQB.name} was his own worst enemy, throwing ${ints} interceptions (${loseQB.line}). `;
      else stars+=`${loseQB.name} hurt ${L} with costly turnovers (${loseQB.line}). `;
    } else if(lQBq==="dominant"||lQBq==="sharp"){
      stars+=`${loseQB.name} played well in a losing effort for ${L} (${loseQB.line}), but it wasn't enough. `;
      // If the losing QB was great, highlight what went wrong
      if(lSecond&&lSecond.type==="rushing"&&lSecond.yds<40) stars+=`The running game offered no help. `;
    } else {
      if(lBest&&lBest!==loseQB&&(lBest.td>=2||lBest.yds>=120)){
        stars+=`${lBest.name} had a strong individual performance for ${L} (${lBest.line}), but the team couldn't capitalize. `;
      } else {
        stars+=`${loseQB.name} finished with ${loseQB.line} for ${L}. `;
      }
    }
  } else if(lBest){
    stars+=`${lBest.name} led ${L}'s offense with ${lBest.line}. `;
  }

  if(stars.trim()) paragraphs.push(stars.trim());

  // ── CLOSER: Varied and context-aware ──
  let closer="";
  if(pRound==="Super Bowl"){
    if(sum.excitementScore>=80) closer+="The biggest stage in football delivered a game worthy of it. ";
    else if(sum.excitementScore>=60) closer+="The Super Bowl provided its share of drama. ";
    else closer+="The Super Bowl didn't quite deliver the classic fans hoped for. ";
  } else if(pRound==="Conference Championship"){
    closer+=`With a trip to the Super Bowl on the line, ${arche==="wire"?"the winner was never really in doubt":"the stakes amplified every moment"}. `;
  } else if(pRound){
    closer+=`As a ${pRound} game, the postseason stage added weight to every possession. `;
  } else {
    if(sum.stakesDetail&&sum.stakesDetail.includes("resting")){
      closer+=`Worth noting: ${sum.stakesDetail.split("·").pop()?.trim()||"rest may have been a factor"}. `;
    } else if(sum.stakesNote) closer+=sum.stakesNote+" ";
  }
  if(sum.rivalryNote&&!pRound) closer+=sum.rivalryNote+" ";
  closer+=`Excitement Index: ${sum.excitementScore} (${sum.excitementVerdict}).`;
  paragraphs.push(closer);

  return paragraphs.filter(p=>p&&p.trim()).slice(0,5);
}


// ── WP Chart: vertical line on tap, bigger dots, OT x-axis fix ──

function WPChart({seriesE, seriesAlt, modelSel, onModelChange, mode, onModeChange, exc, topLev, homeTeam, awayTeam}){
  const [tooltip,setTooltip]=useState(null);
  const [vLine,setVLine]=useState(null); // {x, wp, tMin, homeScore, awayScore}

  const activeSeries = (modelSel==="Alt") ? (seriesAlt||[]) : (seriesE||[]);
  const bothSeries = (modelSel==="Both");
  if(!activeSeries||activeSeries.length<2){
    return h("div",{style:{color:"var(--text-3)",fontFamily:"JetBrains Mono",fontSize:".75rem"}},"Win probability data unavailable.");
  }

  // Determine max game time (OT extends past 60)
  const allForExtent = bothSeries ? [...(seriesE||[]), ...(seriesAlt||[])] : activeSeries;
  const maxTMin=Math.max(...allForExtent.filter(s=>s.tMin!=null).map(s=>s.tMin));
  const gameMaxMin=maxTMin>60?Math.ceil(maxTMin/5)*5:60;

  const W=860,H=200,pad=28;
  const toX=t=>pad+(t/gameMaxMin)*(W-2*pad);
  const toY=wp=>pad+(1-wp)*(H-2*pad);

  const step=Math.max(1,Math.floor(activeSeries.length/500));
  const pts=[];
  for(let i=0;i<activeSeries.length;i+=step){
    const s=activeSeries[i];
    if(s&&s.tMin!=null&&s.wp!=null)pts.push([toX(s.tMin),toY(s.wp)]);
  }
  const path="M "+pts.map(p=>p[0].toFixed(2)+" "+p[1].toFixed(2)).join(" L ");

  let pathAlt=null;
  if(bothSeries && seriesAlt && seriesAlt.length>1){
    const step2=Math.max(1,Math.floor(seriesAlt.length/500));
    const pts2=[];
    for(let i=0;i<seriesAlt.length;i+=step2){
      const s=seriesAlt[i];
      if(s&&s.tMin!=null&&s.wp!=null)pts2.push([toX(s.tMin),toY(s.wp)]);
    }
    if(pts2.length>1) pathAlt="M "+pts2.map(p=>p[0].toFixed(2)+" "+p[1].toFixed(2)).join(" L ");
  }

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
    for(let i=1;i<activeSeries.length;i++){
      const a=activeSeries[i-1].wp,b=activeSeries[i].wp;
      if(a==null||b==null)continue;
      if((a<0.5&&b>=0.5)||(a>=0.5&&b<0.5)){
        const s=activeSeries[i];
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
    for(const s of activeSeries){
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
    for(const s of activeSeries){
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
      h("div",{className:"sec-h",style:{borderBottom:"none",marginBottom:"0"}},`Win Probability (${homeName})${modelSel==="Alt"?" — nflfastR Model":""}`),
      h("div",{style:{display:"flex",alignItems:"center",gap:".5rem"}},
        h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".65rem",letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-3)"}},"Model"),
        h("select",{value:modelSel,onChange:e=>{onModelChange(e.target.value);setTooltip(null);setVLine(null);},style:{background:"var(--bg-3)",border:"1px solid var(--border-1)",color:"var(--text-1)",padding:".35rem .5rem",fontFamily:"JetBrains Mono",fontSize:".7rem"}},
          [ ["ESPN","ESPN"], ["nflfastR","Alt"], ["Both","Both"] ].map(o=>h("option",{key:o[0],value:o[1]},o[0]))),
        h("div",{style:{fontFamily:"JetBrains Mono",fontSize:".65rem",letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-3)",marginLeft:".4rem"}},"Overlay"),
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
        // WP line(s)
        h("path",{d:path,fill:"none",stroke:"rgba(232,236,240,.85)",strokeWidth:"2"}),
        (pathAlt? h("path",{d:pathAlt,fill:"none",stroke:"rgba(61,142,212,.7)",strokeWidth:"2"}) : null),
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
  const{exc,kp,box,stats,pStats,wp,wp2}=d;const og=oGrade(exc.total);
  const date=new Date(g.date).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const tags={td:["TD","t-td"],fg:["FG","t-cl"],to:["TURNOVER","t-to"],bg:["BIG PLAY","t-bg"],cl:["CLUTCH","t-cl"],sp:["SPECIAL","t-sp"],"4d":["4TH DOWN","t-bg"]};
  const passCols=["C/ATT","YDS","AVG","TD","INT","QBR"];
  const[wpMode,setWpMode]=useState("Leverage");
  const[wpModel,setWpModel]=useState("ESPN");
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
    WPChart({seriesE:wp?.series||[],seriesAlt:wp2?.series||[],modelSel:wpModel,onModelChange:setWpModel,mode:wpMode,onModeChange:setWpMode,exc,topLev:(sumData?.enrichedPlays||sumData?.topLeveragePlays||[]),homeTeam:g.ht,awayTeam:g.at}),
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
        h("h4",null,"How It Works"),"The Excitement Index is built on win probability (WP). We compute home-team WP for every play using an nflfastR-inspired model that incorporates score differential, game time, field position, down & distance, timeouts, and home-field advantage — with exponential time-weighting of score differential (Diff_Time_Ratio) to capture how leads become more decisive as the clock runs down. Games with volatile, uncertain, late-swinging WP curves score highest.",
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
