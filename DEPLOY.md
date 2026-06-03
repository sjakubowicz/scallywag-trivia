// ── ScAllywag Trivia — PWA App ───────────────────────────────────────────────
// All game logic. Runs via React loaded from CDN in index.html.
// Shared data (questions, scores, etc.) stored in Netlify Blobs via serverless function.
// Personal data (username, dismissed notices) stored in localStorage on-device.

const { useState, useEffect, useCallback, useRef } = React;
const { createRoot } = ReactDOM;

// ── Storage ───────────────────────────────────────────────────────────────────
// Shared data → Firebase Realtime Database (all players see the same data)
// Personal data → localStorage (stays on this device only)
//
// IMPORTANT: Replace the firebaseConfig below with your own from the Firebase console.
// See DEPLOY.md for step-by-step instructions.

const firebaseConfig = {
  apiKey:            "AIzaSyC2gVOKC_Wi30oNb61AB82YO3aN51oqmo8",
  authDomain:        "scallywag-trivia.firebaseapp.com",
  databaseURL:       "https://scallywag-trivia-default-rtdb.firebaseio.com",
  projectId:         "scallywag-trivia",
  storageBucket:     "scallywag-trivia.firebasestorage.app",
  messagingSenderId: "929801983558",
  appId:             "1:929801983558:web:a6d64c4232a81961881c47",
};

// Firebase is loaded via CDN in index.html
// We access it through the global firebase object
let _db = null;
let _firebaseReady = false;

function initFirebase() {
  if (_firebaseReady) return;
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    _db = firebase.database();
    _firebaseReady = true;
  } catch(e) {
    console.warn("Firebase init failed, using localStorage:", e.message);
  }
}

// In-memory cache for snappy UI
const _cache = {};

async function sget(key) {
  // Return cache if available
  if (_cache[key] !== undefined) return _cache[key];

  initFirebase();

  if (_firebaseReady && _db && !firebaseConfig.apiKey.includes("REPLACE")) {
    try {
      const snap = await _db.ref("scallywag/" + key).once("value");
      const val  = snap.val();
      _cache[key] = val;
      return val;
    } catch(e) {
      console.warn("Firebase read failed, using localStorage:", e.message);
    }
  }

  // Fallback: localStorage
  try {
    const v = localStorage.getItem("sg_shared_" + key);
    const val = v ? JSON.parse(v) : null;
    _cache[key] = val;
    return val;
  } catch { return null; }
}

async function sset(key, val) {
  _cache[key] = val;

  // Always mirror to localStorage as instant backup
  try { localStorage.setItem("sg_shared_" + key, JSON.stringify(val)); } catch {}

  initFirebase();

  if (_firebaseReady && _db && !firebaseConfig.apiKey.includes("REPLACE")) {
    try {
      await _db.ref("scallywag/" + key).set(val);
    } catch(e) {
      console.warn("Firebase write failed:", e.message);
    }
  }
}

// Personal storage — stays on this device only
function pget(key) {
  try { const v = localStorage.getItem("sg_user_" + key); return v ? JSON.parse(v) : null; }
  catch { return null; }
}
function pset(key, val) {
  try { localStorage.setItem("sg_user_" + key, JSON.stringify(val)); } catch {}
}
function invalidate(key) { delete _cache[key]; }

// ── Keys ──────────────────────────────────────────────────────────────────────
const KEYS = {
  questions:    "questions",
  scores:       "scores",
  answered:     "answered",
  attempts:     "attempts",
  dailyQ:       "daily_queue",
  dailyLog:     "daily_log",
  flags:        "flags",
  pulled:       "pulled",
  bonuses:      "bonuses",
  notices:      "notices",
  plank:        "plank",
  plankHistory: "plank_history",
  username:     "username",
};

const FLAG_THRESHOLD = 3;
const DAILY_LIMIT    = 3;
const DAY            = 86400000;

// ── Seed questions ─────────────────────────────────────────────────────────────
const SEED = [
  { id:"seed1", author:"Trivia Bot", subject:"Science",     question:"What planet is closest to the Sun?",       answer:"mercury",  ts: Date.now()-DAY*7 },
  { id:"seed2", author:"Trivia Bot", subject:"History",     question:"In what year did World War II end?",        answer:"1945",     ts: Date.now()-DAY*5 },
  { id:"seed3", author:"Trivia Bot", subject:"Geography",   question:"What is the capital of Australia?",         answer:"canberra", ts: Date.now()-DAY*3 },
  { id:"seed4", author:"Trivia Bot", subject:"Pop Culture", question:"How many Harry Potter books are there?",    answer:"7",        ts: Date.now()-DAY*1 },
  { id:"seed5", author:"Trivia Bot", subject:"Math",        question:"What is the square root of 144?",           answer:"12",       ts: Date.now()-3600000 },
];

// ── Utilities ─────────────────────────────────────────────────────────────────
const uid       = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const normalize = s  => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const now       = () => Date.now();
const thresholds = { daily: DAY, weekly: DAY*7, monthly: DAY*30, yearly: DAY*365 };

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function weekStr(ts) {
  const d = new Date(ts); d.setHours(0,0,0,0);
  d.setDate(d.getDate()+4-(d.getDay()||7));
  const y = d.getFullYear();
  const w = Math.ceil((((d-new Date(y,0,1))/DAY)+1)/7);
  return `${y}-W${String(w).padStart(2,"0")}`;
}
function currentWeekStr() { return weekStr(Date.now()); }
function prevWeekStr()    { return weekStr(Date.now()-7*DAY); }
function msUntilMidnight() { const n=new Date(),m=new Date(n); m.setHours(24,0,0,0); return m-n; }
function formatCountdown(ms) {
  const h=Math.floor(ms/3600000),m=Math.floor((ms%3600000)/60000),s=Math.floor((ms%60000)/1000);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function timeLabel(ts) {
  const d=now()-ts;
  if(d<DAY)   return "Today";
  if(d<DAY*2) return "Yesterday";
  return new Date(ts).toLocaleDateString();
}
function seededShuffle(arr, seed) {
  const a=[...arr]; let s=seed;
  for(let i=a.length-1;i>0;i--){s=(s*1664525+1013904223)&0xffffffff;const j=Math.abs(s)%(i+1);[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function dateSeed(dateStr){ return dateStr.split("-").reduce((acc,n)=>acc*100+parseInt(n),0); }
function buildDailyQueue(questions,dateStr){
  if(!questions.length) return [];
  const seed=dateSeed(dateStr),shuffled=seededShuffle(questions,seed);
  return shuffled.slice(0,Math.min(DAILY_LIMIT,shuffled.length)).map(q=>q.id);
}
function calcPlankVictim(attempts){
  const prev=prevWeekStr();
  const wa={};
  Object.values(attempts).forEach(qa=>{
    qa.forEach(a=>{
      if(weekStr(a.ts)!==prev) return;
      if(!wa[a.user]) wa[a.user]={correct:0,total:0};
      wa[a.user].total++;
      if(a.correct) wa[a.user].correct++;
    });
  });
  const players=Object.entries(wa).filter(([,s])=>s.total>0);
  if(players.length<2) return null;
  players.sort((a,b)=>{
    const pa=a[1].correct/a[1].total, pb=b[1].correct/b[1].total;
    if(pa!==pb) return pa-pb;
    return b[1].total-a[1].total;
  });
  const [victim,stats]=players[0];
  return {victim,correct:stats.correct,total:stats.total,pct:Math.round((stats.correct/stats.total)*100)};
}

// ── Inject styles ──────────────────────────────────────────────────────────────
(function(){
  const s=document.createElement("style");
  s.textContent=`
    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Lato:wght@300;400;700&display=swap');
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes pulse{0%,100%{opacity:.35}50%{opacity:1}}
    @keyframes fadeup{from{opacity:0;transform:translateX(-50%) translateY(14px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    @keyframes pop{0%{transform:scale(.92);opacity:0}100%{transform:scale(1);opacity:1}}
    @keyframes slideDown{from{opacity:0;transform:translateY(-16px)}to{opacity:1;transform:translateY(0)}}
    @keyframes treasureBounce{0%{transform:scale(0) rotate(-20deg)}60%{transform:scale(1.25) rotate(8deg)}80%{transform:scale(.92) rotate(-4deg)}100%{transform:scale(1) rotate(0)}}
    @keyframes lootShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-10px) rotate(-5deg)}40%{transform:translateX(10px) rotate(5deg)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}
    @keyframes coinRise{0%{transform:translateY(0) rotate(0) scale(1);opacity:1}100%{transform:translateY(-110vh) rotate(540deg) scale(.3);opacity:0}}
    @keyframes coinFall{0%{transform:translateY(0) rotate(0) scale(1);opacity:1}100%{transform:translateY(110vh) rotate(-360deg) scale(.5);opacity:0}}
    @keyframes tickPulse{0%,100%{opacity:1}50%{opacity:.4}}
    @keyframes stormFlash{0%,100%{opacity:0}10%,12%{opacity:.7}11%{opacity:.3}50%,52%{opacity:.5}51%{opacity:.2}}
    @keyframes stormRoll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
    @keyframes shipRock{0%,100%{transform:rotate(-1.5deg) translateY(0)}50%{transform:rotate(1.5deg) translateY(-3px)}}
    @keyframes plankBounce{0%,100%{transform:rotate(7deg) translateY(0)}50%{transform:rotate(7deg) translateY(-2px)}}
    @keyframes pirateStep{0%,100%{transform:rotate(0)}25%{transform:rotate(12deg)}75%{transform:rotate(-8deg)}}
    @keyframes pirateWalkSVG{0%{transform:translateX(0) translateY(0);opacity:1}60%{transform:translateX(90px) translateY(-4px);opacity:1}78%{transform:translateX(115px) translateY(18px) rotate(20deg);opacity:1}88%{transform:translateX(130px) translateY(50px) rotate(55deg);opacity:.7}100%{transform:translateX(145px) translateY(95px) rotate(85deg);opacity:0}}
    @keyframes guardAdvance{0%{transform:translateX(0)}100%{transform:translateX(30px)}}
    @keyframes splashBurst{0%{transform:scale(0) translateY(0);opacity:0}20%{transform:scale(1.6) translateY(-8px);opacity:1}60%{transform:scale(1.1) translateY(0);opacity:.8}100%{transform:scale(.8) translateY(4px);opacity:0}}
    @keyframes splashRing{0%{transform:scale(0);opacity:.8}100%{transform:scale(3);opacity:0}}
    @keyframes waveScroll{0%{transform:translateX(0)}100%{transform:translateX(-40%)}}
    @keyframes skullFloat{0%,100%{transform:translateY(0) rotate(-5deg)}50%{transform:translateY(-7px) rotate(5deg)}}
    @keyframes skullFade{0%{opacity:0;transform:translateY(20px)}100%{opacity:1;transform:translateY(0)}}
    @keyframes bubbleRise{0%{transform:translateY(0) scale(1);opacity:.7}100%{transform:translateY(-60px) scale(.3);opacity:0}}
    @keyframes torchFlicker{0%,100%{opacity:.8;transform:scaleY(1)}25%{opacity:.6;transform:scaleY(.85)}75%{opacity:.9;transform:scaleY(1.1)}}
    @keyframes verdictDrop{0%{transform:translateY(-40px) scale(.9);opacity:0}60%{transform:translateY(4px) scale(1.02)}100%{transform:translateY(0) scale(1);opacity:1}}
    @keyframes shameText{0%{letter-spacing:20px;opacity:0}100%{letter-spacing:3px;opacity:1}}
    @keyframes seaGlow{0%,100%{box-shadow:0 0 40px rgba(10,60,120,.4)}50%{box-shadow:0 0 80px rgba(10,80,160,.7)}}
    @keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%;background:#0f0f0f;overscroll-behavior:none}
    button{cursor:pointer;transition:opacity .15s,transform .1s}
    button:active{transform:scale(.97)}
    input::placeholder,textarea::placeholder{color:#3a3a3a}
    textarea{font-family:'Lato',sans-serif;resize:vertical}
    ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#111}::-webkit-scrollbar-thumb{background:#333;border-radius:4px}
    #root{height:100%}
  `;
  document.head.appendChild(s);
})();

// ── Pirate result messages ─────────────────────────────────────────────────────
const TREASURE_LINES=[
  {headline:"TREASURE FOUND!",sub:"Blimey! Ye struck gold, ye clever sea dog!",emoji:"🏴‍☠️"},
  {headline:"GOLD IN THE HOLD!",sub:"Shiver me timbers — the chest is YOURS!",emoji:"💰"},
  {headline:"X MARKS THE SPOT!",sub:"Yer the sharpest pirate on the seven seas!",emoji:"🗺️"},
  {headline:"DOUBLOONS APLENTY!",sub:"The crew cheers as ye claim yer bounty!",emoji:"🪙"},
  {headline:"RICHES BEYOND MEASURE!",sub:"Arr, that be the finest answer I ever heard!",emoji:"💎"},
];
const LOOT_LOST_LINES=[
  {headline:"THE LOOT BE GONE!",sub:"Davy Jones claims yer treasure this day…",emoji:"💀"},
  {headline:"SUNK WITHOUT A TRACE!",sub:"The chest slipped into the briny deep!",emoji:"⚓"},
  {headline:"PLUNDERED!",sub:"Arr, the rival crew got away with the gold!",emoji:"🦈"},
  {headline:"MAROONED!",sub:"Ye've been left on a deserted isle, matey.",emoji:"🏝️"},
  {headline:"THE MAP WAS WRONG!",sub:"Ye dug and dug… nothin' but sand and crabs.",emoji:"🦀"},
];

// ── Particles ──────────────────────────────────────────────────────────────────
function Particles({type}){
  const items=type==="correct"
    ?["🪙","💰","✨","🌟","💛","🏅","🪙","💎","✨","🪙","🌟","💰"]
    :["💀","🦴","⚓","🌊","🦈","💀","⚓","🌊","🦴","💀","🌊","🦈"];
  return React.createElement("div",{style:{position:"fixed",inset:0,pointerEvents:"none",zIndex:50,overflow:"hidden"}},
    items.map((e,i)=>React.createElement("div",{key:i,style:{position:"absolute",left:`${5+(i*8.2)%90}%`,top:type==="correct"?"110%":"-10%",fontSize:18+(i%3)*8,animation:`${type==="correct"?"coinRise":"coinFall"} ${(1.8+(i%4)*0.3).toFixed(2)}s ease-out ${(i*0.12).toFixed(2)}s both`}},e))
  );
}

// ── SVG Pirate characters ──────────────────────────────────────────────────────
function PirateVictimSVG(){
  return React.createElement("svg",{width:32,height:64,viewBox:"0 0 32 64",fill:"none"},
    // Hat
    React.createElement("path",{d:"M4 10 Q16 2 28 10 L26 14 Q16 10 6 14 Z",fill:"#1a1208"}),
    React.createElement("rect",{x:6,y:10,width:20,height:5,rx:1,fill:"#231a0e"}),
    React.createElement("rect",{x:11,y:8,width:10,height:4,rx:1,fill:"#1a1208"}),
    React.createElement("path",{d:"M26 8 Q32 4 30 12 Q28 8 26 10 Z",fill:"#8a1010"}),
    // Scared face
    React.createElement("ellipse",{cx:16,cy:20,rx:8,ry:9,fill:"#d4b896"}),
    React.createElement("circle",{cx:12,cy:18,r:3,fill:"white"}),
    React.createElement("circle",{cx:20,cy:18,r:3,fill:"white"}),
    React.createElement("circle",{cx:12,cy:19,r:1.5,fill:"#3a2010"}),
    React.createElement("circle",{cx:20,cy:19,r:1.5,fill:"#3a2010"}),
    React.createElement("circle",{cx:12.5,cy:18,r:.6,fill:"white"}),
    React.createElement("circle",{cx:20.5,cy:18,r:.6,fill:"white"}),
    React.createElement("ellipse",{cx:16,cy:25,rx:3,ry:2.5,fill:"#3a1a0a"}),
    React.createElement("ellipse",{cx:16,cy:25,rx:2,ry:1.5,fill:"#8a2020"}),
    React.createElement("ellipse",{cx:23,cy:16,rx:1.2,ry:1.8,fill:"#6ab4f0",opacity:.8}),
    // Beard
    React.createElement("path",{d:"M8 26 Q10 32 16 31 Q22 32 24 26",fill:"#5a3a18",opacity:.7}),
    // Coat
    React.createElement("rect",{x:7,y:30,width:18,height:20,rx:3,fill:"#1a3a6a"}),
    React.createElement("rect",{x:12,y:30,width:8,height:20,fill:"#152e56"}),
    React.createElement("path",{d:"M7 48 L10 52 L13 48 L16 53 L19 48 L22 52 L25 48",fill:"none",stroke:"#1a3a6a",strokeWidth:1}),
    React.createElement("rect",{x:7,y:44,width:18,height:4,rx:1,fill:"#3a2010"}),
    React.createElement("rect",{x:14,y:44,width:4,height:4,fill:"#d4a017"}),
    // Bound hands
    React.createElement("rect",{x:5,y:33,width:6,height:5,rx:2,fill:"#1a3a6a"}),
    React.createElement("rect",{x:21,y:33,width:6,height:5,rx:2,fill:"#1a3a6a"}),
    React.createElement("path",{d:"M8 35 Q16 40 24 35",stroke:"#8a6020",strokeWidth:2.5,fill:"none",strokeLinecap:"round"}),
    // Legs
    React.createElement("rect",{x:8,y:50,width:7,height:11,rx:2,fill:"#1a1208",style:{transformOrigin:"11px 50px",animation:"pirateStep .6s ease-in-out infinite"}}),
    React.createElement("rect",{x:17,y:50,width:7,height:11,rx:2,fill:"#1a1208",style:{transformOrigin:"20px 50px",animation:"pirateStep .6s ease-in-out infinite .3s"}}),
    React.createElement("rect",{x:6,y:58,width:10,height:5,rx:2,fill:"#0a0a0a"}),
    React.createElement("rect",{x:17,y:57,width:5,height:7,rx:1,fill:"#5a3010"}),
    React.createElement("rect",{x:16,y:62,width:7,height:2,rx:1,fill:"#3a1a08"})
  );
}

function PirateGuardSVG(){
  return React.createElement("svg",{width:36,height:64,viewBox:"0 0 36 64",fill:"none"},
    React.createElement("rect",{x:6,y:2,width:24,height:6,rx:2,fill:"#1a1a1a"}),
    React.createElement("rect",{x:10,y:6,width:16,height:3,rx:1,fill:"#111"}),
    React.createElement("rect",{x:12,y:8,width:4,height:2,rx:1,fill:"#d4a017"}),
    React.createElement("ellipse",{cx:18,cy:15,rx:8,ry:9,fill:"#e8d0b0"}),
    React.createElement("circle",{cx:14,cy:13,r:2.5,fill:"#1a1208"}),
    React.createElement("circle",{cx:22,cy:13,r:2.5,fill:"#1a1208"}),
    React.createElement("path",{d:"M13 20 Q18 24 23 20",stroke:"#8a6040",strokeWidth:1.5,fill:"none"}),
    React.createElement("path",{d:"M10 20 Q18 30 26 20",fill:"#3a2010",opacity:.8}),
    React.createElement("rect",{x:9,y:24,width:18,height:22,rx:3,fill:"#8a1010"}),
    React.createElement("rect",{x:14,y:24,width:8,height:22,fill:"#6a0808"}),
    React.createElement("circle",{cx:18,cy:28,r:1.5,fill:"#d4a017"}),
    React.createElement("circle",{cx:18,cy:33,r:1.5,fill:"#d4a017"}),
    React.createElement("circle",{cx:18,cy:38,r:1.5,fill:"#d4a017"}),
    React.createElement("rect",{x:3,y:25,width:8,height:5,rx:2,fill:"#8a1010"}),
    React.createElement("rect",{x:25,y:25,width:8,height:5,rx:2,fill:"#8a1010"}),
    React.createElement("line",{x1:11,y1:27,x2:-2,y2:22,stroke:"#c0c0c0",strokeWidth:2}),
    React.createElement("polygon",{points:"-2,19 -5,22 -2,25",fill:"#d0d0d0"}),
    React.createElement("rect",{x:10,y:46,width:7,height:14,rx:2,fill:"#2a1a0a",style:{transformOrigin:"13px 46px",animation:"pirateStep .5s ease-in-out infinite"}}),
    React.createElement("rect",{x:19,y:46,width:7,height:14,rx:2,fill:"#2a1a0a",style:{transformOrigin:"22px 46px",animation:"pirateStep .5s ease-in-out infinite .25s"}}),
    React.createElement("rect",{x:8,y:57,width:10,height:5,rx:2,fill:"#1a0a00"}),
    React.createElement("rect",{x:17,y:57,width:10,height:5,rx:2,fill:"#1a0a00"})
  );
}

function SkullInWaterSVG(){
  return React.createElement("svg",{width:44,height:38,viewBox:"0 0 44 38",fill:"none"},
    React.createElement("path",{d:"M4 14 Q22 6 40 14 L38 18 Q22 13 6 18 Z",fill:"#1a1208",opacity:.9}),
    React.createElement("rect",{x:6,y:14,width:32,height:6,rx:1,fill:"#231a0e",opacity:.9}),
    React.createElement("path",{d:"M38 12 Q44 8 42 16 Q40 12 38 14 Z",fill:"#8a1010",opacity:.7}),
    React.createElement("ellipse",{cx:22,cy:30,rx:9,ry:8,fill:"#d4c8a8",opacity:.85}),
    React.createElement("ellipse",{cx:17,cy:28,rx:3,ry:3.5,fill:"#1a1208"}),
    React.createElement("ellipse",{cx:27,cy:28,rx:3,ry:3.5,fill:"#1a1208"}),
    React.createElement("rect",{x:16,y:33,width:3,height:3,rx:.5,fill:"#1a1208"}),
    React.createElement("rect",{x:20,y:34,width:3,height:3,rx:.5,fill:"#1a1208"}),
    React.createElement("rect",{x:24,y:33,width:3,height:3,rx:.5,fill:"#1a1208"})
  );
}

// ── Theatrical Plank Scene ──────────────────────────────────────────────────────
function TheatricalPlankScene({victim,pct,correct,total,isVictim,onDismiss}){
  const [act,setAct]=useState(0);
  const timers=useRef([]);
  useEffect(()=>{
    const sched=[[0,1],[1500,2],[3000,3],[5500,4],[8000,5],[11000,6],[13000,7],[16000,8],[19000,9]];
    sched.forEach(([d,a])=>{ timers.current.push(setTimeout(()=>setAct(a),d)); });
    return()=>timers.current.forEach(clearTimeout);
  },[]);
  const stars=Array.from({length:40},(_,i)=>({top:Math.sin(i*137.5)*45+50,left:(i*61.8)%100,size:1+i%3,delay:(i*.07).toFixed(2)}));

  const e=React.createElement;
  return e("div",{style:{position:"fixed",inset:0,zIndex:1000,background:act>=1?"radial-gradient(ellipse at 50% 0%,#0a1a2e,#05101e 40%,#020810)":"#000",transition:"background 1.5s",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",overflow:"hidden"}},

    // Stars
    act>=1&&stars.map((s,i)=>e("div",{key:i,style:{position:"absolute",width:s.size,height:s.size,borderRadius:"50%",background:"#fff",opacity:.3,top:`${s.top}%`,left:`${s.left}%`,animation:`pulse ${2+s.size}s ease-in-out infinite ${s.delay}s`}})),

    // Storm clouds
    act>=1&&e("div",{style:{position:"absolute",top:0,left:0,right:0,height:"45%",overflow:"hidden"}},
      e("div",{style:{position:"absolute",top:0,left:0,width:"200%",height:"100%",background:"repeating-linear-gradient(90deg,transparent 0%,transparent 8%,rgba(20,20,35,.9) 8%,rgba(20,20,35,.9) 14%,transparent 14%)",animation:"stormRoll 12s linear infinite"}}),
      e("div",{style:{position:"absolute",top:"10%",left:0,width:"200%",height:"60%",background:"repeating-linear-gradient(90deg,transparent 0%,transparent 12%,rgba(15,15,30,.7) 12%,rgba(15,15,30,.7) 20%,transparent 20%)",animation:"stormRoll 18s linear infinite reverse"}})
    ),

    // Lightning
    act>=1&&act<8&&e("div",{style:{position:"absolute",inset:0,pointerEvents:"none",background:"rgba(180,200,255,.12)",animation:"stormFlash 4s ease-in-out infinite"}}),

    // Moon
    act>=1&&e("div",{style:{position:"absolute",top:"8%",right:"15%",width:50,height:50,borderRadius:"50%",background:"radial-gradient(circle at 35% 35%,#fff8e0,#c8b860)",boxShadow:"0 0 30px rgba(220,200,100,.35)"}}),

    // Ocean
    act>=2&&e("div",{style:{position:"absolute",bottom:0,left:0,right:0,height:"40%",overflow:"hidden",animation:"seaGlow 3s ease-in-out infinite"}},
      e("div",{style:{position:"absolute",inset:0,background:"linear-gradient(180deg,#082840,#051a2a 50%,#030e18)"}}),
      ...[{top:"18%",h:18,c:"rgba(10,60,110,.8)",sp:"8s",d:"0s"},{top:"28%",h:22,c:"rgba(8,50,95,.85)",sp:"11s",d:"1s"},{top:"40%",h:28,c:"rgba(6,40,80,.9)",sp:"9s",d:".5s"}].map((w,i)=>
        e("div",{key:i,style:{position:"absolute",top:w.top,left:0,width:"200%",height:w.h,background:w.c,borderRadius:"50% 50% 0 0/30% 30% 0 0",animation:`waveScroll ${w.sp} linear infinite ${w.d}`}})
      ),
      e("div",{style:{position:"absolute",top:"15%",left:0,right:0,height:4,background:"linear-gradient(90deg,transparent,rgba(100,180,255,.15),rgba(150,210,255,.25),rgba(100,180,255,.15),transparent)",animation:"waveScroll 5s linear infinite"}})
    ),

    // Ship
    act>=2&&e("div",{style:{position:"absolute",bottom:"34%",left:"5%",animation:"shipRock 3s ease-in-out infinite",transformOrigin:"bottom center"}},
      e("div",{style:{position:"relative",width:200,height:50}},
        e("div",{style:{position:"absolute",bottom:0,left:0,width:200,height:36,background:"#180e04",borderRadius:"6px 6px 24px 24px",border:"1px solid #2e1a08"}}),
        e("div",{style:{position:"absolute",bottom:32,left:20,width:160,height:12,background:"#201206",borderRadius:"4px 4px 0 0"}}),
        ...[40,80,120,160].map(x=>e("div",{key:x,style:{position:"absolute",bottom:10,left:x,width:10,height:10,borderRadius:"50%",background:"#f5c842",opacity:.4,boxShadow:"0 0 6px rgba(245,200,66,.6)"}}))
      ),
      e("div",{style:{position:"absolute",bottom:48,left:85,width:6,height:110,background:"#2a1608",borderRadius:3}}),
      e("div",{style:{position:"absolute",bottom:150,left:78,width:22,height:14,background:"#201206",borderRadius:4,border:"1px solid #3a2010"}}),
      e("div",{style:{position:"absolute",bottom:60,left:91,width:70,height:75,background:"linear-gradient(135deg,#3a2812,#281a0a)",clipPath:"polygon(0 0,100% 8%,88% 100%,0 100%)",opacity:.9}}),
      e("div",{style:{position:"absolute",bottom:56,left:30,width:55,height:55,background:"linear-gradient(120deg,#2e1e0a,#221408)",clipPath:"polygon(100% 0,100% 100%,0 80%)",opacity:.7}}),
      e("div",{style:{position:"absolute",bottom:158,left:91,width:20,height:14,background:"#1a1a1a",clipPath:"polygon(0 0,100% 25%,100% 75%,0 100%)"}}),
      ...[30,165].map(x=>e("div",{key:x,style:{position:"absolute",bottom:46,left:x}},
        e("div",{style:{width:5,height:12,background:"#3a2010",borderRadius:"2px 2px 0 0"}}),
        e("div",{style:{position:"absolute",bottom:10,left:-1,width:7,height:14,background:"radial-gradient(ellipse at 50% 80%,#f5a020,#e05010,transparent)",animation:"torchFlicker .4s ease-in-out infinite",transformOrigin:"bottom center"}})
      )),
      e("div",{style:{position:"absolute",bottom:44,left:168,width:90,height:8,background:"linear-gradient(90deg,#5a3010,#4a2808)",borderRadius:"2px 6px 6px 2px",transform:"rotate(7deg)",transformOrigin:"left center",animation:"plankBounce 3s ease-in-out infinite",boxShadow:"0 4px 8px rgba(0,0,0,.5)"}})
    ),

    // Title card
    act>=3&&act<5&&e("div",{style:{position:"absolute",top:"15%",left:0,right:0,textAlign:"center",animation:"verdictDrop .8s cubic-bezier(.34,1.56,.64,1) forwards"}},
      e("div",{style:{display:"inline-block",background:"rgba(0,0,0,.7)",border:"1px solid rgba(212,160,23,.3)",borderRadius:16,padding:"16px 32px"}},
        e("p",{style:{color:"#7a6030",fontSize:10,textTransform:"uppercase",letterSpacing:5,marginBottom:6}},"Weekly Reckoning"),
        e("h1",{style:{fontFamily:"'Cinzel',serif",fontSize:28,fontWeight:900,color:"#d4a017",textShadow:"0 0 30px rgba(212,160,23,.8)",letterSpacing:4,animation:"shameText .6s ease .3s both"}},"PLANK ROULETTE")
      )
    ),

    // Victim name
    act>=4&&act<8&&e("div",{style:{position:"absolute",top:"14%",left:0,right:0,textAlign:"center",animation:"slideDown .6s ease forwards"}},
      e("p",{style:{color:"#7a6030",fontSize:10,textTransform:"uppercase",letterSpacing:4,marginBottom:8}},"This week's condemned:"),
      e("div",{style:{display:"inline-block",background:"rgba(0,0,0,.8)",border:"2px solid #8a0000",borderRadius:12,padding:"12px 28px"}},
        e("p",{style:{fontFamily:"'Cinzel',serif",fontSize:22,color:"#e05555",fontWeight:900,letterSpacing:3,textShadow:"0 0 20px rgba(224,85,85,.7)"}},victim),
        e("p",{style:{color:"#7a3030",fontSize:12,marginTop:4}},`Only ${pct}% correct last week (${correct}/${total})`)
      ),
      act===4&&e("p",{style:{color:"#555",fontSize:12,marginTop:14,fontStyle:"italic",animation:"pulse 1.5s ease-in-out infinite"}},"Prepare to walk… 🌊")
    ),

    // SVG Pirate walk (Act 5)
    act===5&&e("div",{style:{position:"absolute",bottom:"calc(34% + 44px)",left:"calc(5% + 155px)",zIndex:10,display:"flex",alignItems:"flex-end",gap:2}},
      e("div",{style:{animation:"guardAdvance 2.8s cubic-bezier(.4,0,1,1) forwards",transformOrigin:"bottom center",marginRight:4}},e(PirateGuardSVG)),
      e("div",{style:{animation:"pirateWalkSVG 2.8s cubic-bezier(.4,0,1,1) forwards",transformOrigin:"bottom center"}},e(PirateVictimSVG))
    ),

    // Splash (Act 6)
    act===6&&e(React.Fragment,null,
      e("div",{style:{position:"absolute",bottom:"calc(34% + 2px)",left:"calc(5% + 285px)",fontSize:42,zIndex:10,animation:"splashBurst 1.2s ease-out forwards"}},"💦"),
      ...[.3,.6,.9].map((delay,i)=>e("div",{key:i,style:{position:"absolute",bottom:"calc(34% + 6px)",left:"calc(5% + 270px)",width:30,height:15,borderRadius:"50%",border:"2px solid rgba(100,180,255,.6)",animation:`splashRing 1.2s ease-out ${delay}s both`}})),
      e("div",{style:{position:"absolute",top:"14%",left:0,right:0,textAlign:"center",animation:"slideDown .4s ease"}},
        e("p",{style:{fontFamily:"'Cinzel',serif",fontSize:26,color:"#6ab4f0",letterSpacing:4,textShadow:"0 0 20px rgba(100,180,255,.8)",fontWeight:900}},"SPLASH!")
      )
    ),

    // Skull in water (Act 7)
    act>=7&&act<8&&e(React.Fragment,null,
      e("div",{style:{position:"absolute",bottom:"calc(34% + 8px)",left:"calc(5% + 268px)",zIndex:10,animation:"skullFade .8s ease forwards, skullFloat 2.5s ease-in-out .8s infinite"}},e(SkullInWaterSVG)),
      ...[0,.4,.8,1.2].map((delay,i)=>e("div",{key:i,style:{position:"absolute",bottom:`calc(34% + ${14+i*8}px)`,left:`calc(5% + ${268+i*7}px)`,width:6+i*2,height:6+i*2,borderRadius:"50%",background:"rgba(100,180,255,.3)",border:"1px solid rgba(100,180,255,.5)",animation:`bubbleRise ${1.5+delay}s ease-out ${delay}s infinite`}})),
      e("div",{style:{position:"absolute",top:"14%",left:0,right:0,textAlign:"center",animation:"slideDown .5s ease"}},
        e("p",{style:{color:"#4a6a8a",fontSize:13,fontStyle:"italic",letterSpacing:2}},"☠️  Gone to Davy Jones' Locker…")
      )
    ),

    // Verdict card (Act 8+)
    act>=8&&e("div",{style:{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"radial-gradient(ellipse at 50% 60%,rgba(100,0,0,.25),transparent 70%)",animation:"fadeIn .8s ease"}},
      e("div",{style:{background:isVictim?"linear-gradient(180deg,#1a0000,#0e0000)":"linear-gradient(180deg,#0a0a00,#050500)",border:`2px solid ${isVictim?"#8a0000":"#5a4000"}`,borderRadius:24,padding:"36px 32px 32px",maxWidth:400,width:"90%",textAlign:"center",boxShadow:`0 0 80px ${isVictim?"rgba(140,0,0,.5)":"rgba(100,80,0,.4)"},0 40px 100px rgba(0,0,0,.9)`,animation:"verdictDrop .7s cubic-bezier(.34,1.2,.64,1) forwards"}},
        e("div",{style:{fontSize:64,marginBottom:4,display:"inline-block",animation:"skullFloat 2.5s ease-in-out infinite"}},isVictim?"😱":"☠️"),
        e("div",{style:{fontSize:28,marginBottom:16}},"🌊"),
        e("h1",{style:{fontFamily:"'Cinzel',serif",fontSize:22,fontWeight:900,color:isVictim?"#e05555":"#d4a017",textShadow:isVictim?"0 0 30px rgba(224,85,85,.7)":"0 0 30px rgba(212,160,23,.7)",letterSpacing:3,marginBottom:16,animation:"shameText .5s ease .2s both"}},isVictim?"YE WALKED THE PLANK!":"PLANK ROULETTE!"),
        e("div",{style:{background:"rgba(255,255,255,.04)",border:`1px solid ${isVictim?"#4a0000":"#3a2a00"}`,borderRadius:14,padding:"16px 18px",marginBottom:18}},
          isVictim
            ?e(React.Fragment,null,e("p",{style:{color:"#c08080",fontSize:14,lineHeight:1.7,marginBottom:8}},`Yer accuracy of `,e("strong",{style:{color:"#e05555",fontSize:16}},`${pct}%`),` (${correct}/${total}) was the worst of the crew last week.`),e("p",{style:{color:"#7a4040",fontSize:12}},"Davy Jones has claimed yer weekly score. Better luck this week, matey."))
            :e(React.Fragment,null,e("p",{style:{color:"#c0a060",fontSize:14,lineHeight:1.7,marginBottom:8}},e("strong",{style:{color:"#f5c842",fontSize:16}},victim)," answered only ",e("strong",{style:{color:"#e05555"}},`${pct}%`),` correctly (${correct}/${total}).`),e("p",{style:{color:"#7a6030",fontSize:12}},"Their weekly score has been wiped and they've taken the plunge! ☠️"))
        ),
        e("div",{style:{display:"flex",alignItems:"center",gap:10,marginBottom:16}},
          e("div",{style:{flex:1,height:1,background:isVictim?"#3a0000":"#2a2000"}}),
          e("span",{style:{color:isVictim?"#5a0000":"#4a3a00",fontSize:16}},"☠"),
          e("div",{style:{flex:1,height:1,background:isVictim?"#3a0000":"#2a2000"}})
        ),
        e("p",{style:{color:"#333",fontSize:11,marginBottom:18,fontStyle:"italic"}},"Plank Roulette runs every week — answer well or face the deep!"),
        act>=9&&e("button",{onClick:onDismiss,style:{width:"100%",background:isVictim?"#3a0000":"#d4a017",color:isVictim?"#f08080":"#0a0800",border:isVictim?"1px solid #6a0000":"none",borderRadius:12,padding:"14px",fontWeight:700,fontFamily:"'Cinzel',serif",fontSize:14,letterSpacing:2,animation:"slideUp .4s ease"}},isVictim?"Face the Music 💀":"Back to the Ship ⚓")
      ),
      act<9&&e("button",{onClick:onDismiss,style:{position:"absolute",bottom:24,right:24,background:"rgba(255,255,255,.05)",border:"1px solid #2a2a2a",borderRadius:20,color:"#444",padding:"7px 16px",fontSize:12,animation:"fadeIn 1s ease 2s both"}},"Skip →")
    ),

    // Progress bar
    act>0&&act<8&&e("div",{style:{position:"absolute",bottom:20,left:0,right:0,display:"flex",justifyContent:"center",gap:6}},
      Array.from({length:8}).map((_,i)=>e("div",{key:i,style:{width:i<act?24:8,height:4,borderRadius:3,background:i<act?"#d4a017":"#222",transition:"all .4s"}}))
    )
  );
}

// ── The main App component (full game) ────────────────────────────────────────
// [All screens: Login, Home, Play, Submit, Leaderboard, Settings, DoneForToday, PlankModal]
// Using the same logic from trivia-app.jsx but with localStorage

function useCountdown(){
  const [ms,setMs]=useState(msUntilMidnight());
  useEffect(()=>{const t=setInterval(()=>setMs(msUntilMidnight()),1000);return()=>clearInterval(t);},[]);
  return ms;
}

function DoneForToday({effectiveLimit}){
  const ms=useCountdown();
  const e=React.createElement;
  return e("div",{style:{maxWidth:480,margin:"0 auto",padding:"60px 24px",textAlign:"center"}},
    e("div",{style:{fontSize:72,marginBottom:20}},"⚓"),
    e("h2",{style:{fontFamily:"'Cinzel',serif",fontSize:26,color:"#d4a017",marginBottom:12,letterSpacing:2}},"Anchors Aweigh!"),
    e("p",{style:{color:"#888",fontSize:16,lineHeight:1.6,marginBottom:32}},`Ye've answered all ${effectiveLimit} questions for today, ye tireless sea dog. Rest yer sea legs — a new voyage begins at midnight!`),
    e("div",{style:{background:"#141414",border:"1px solid #2a2000",borderRadius:16,padding:"24px",marginBottom:24}},
      e("p",{style:{color:"#5a4a20",fontSize:11,textTransform:"uppercase",letterSpacing:3,marginBottom:10}},"Next Questions In"),
      e("div",{style:{fontFamily:"'Cinzel',serif",fontSize:42,fontWeight:900,color:"#f5c842",letterSpacing:4,animation:"tickPulse 1s ease-in-out infinite"}},formatCountdown(ms))
    ),
    e("p",{style:{color:"#333",fontSize:13}},"Come back tomorrow for new questions!")
  );
}

function App(){
  const [screen,   setScreen]   = useState("home");
  const [username, setUsername] = useState("");
  const [nameInput,setNameInput]= useState("");
  const [questions,setQuestions]= useState([]);
  const [scores,   setScores]   = useState({});
  const [answered, setAnswered] = useState({});
  const [attempts, setAttempts] = useState({});
  const [dailyQ,   setDailyQ]   = useState(null);
  const [dailyLog, setDailyLog] = useState({});
  const [flags,    setFlags]    = useState({});
  const [pulled,   setPulled]   = useState([]);
  const [bonuses,  setBonuses]  = useState({});
  const [notices,  setNotices]  = useState({});
  const [plank,    setPlank]    = useState(null);
  const [plankHistory,setPlankHistory]=useState([]);
  const [showPlank,setShowPlank]=useState(false);
  const [plankIsVictim,setPlankIsVictim]=useState(false);
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState("");

  useEffect(()=>{
    (async()=>{
      const [q,s,a,at,dl,fl,pu,bo,no,pl,ph,dqRaw] = await Promise.all([
        sget(KEYS.questions), sget(KEYS.scores),   sget(KEYS.answered),
        sget(KEYS.attempts),  sget(KEYS.dailyLog),  sget(KEYS.flags),
        sget(KEYS.pulled),    sget(KEYS.bonuses),   sget(KEYS.notices),
        sget(KEYS.plank),     sget(KEYS.plankHistory), sget(KEYS.dailyQ),
      ]);

      const questions = q  || SEED;
      const scores    = s  || {};
      const answered  = a  || {};
      const attempts  = at || {};
      const dailyLog  = dl || {};
      const flags     = fl || {};
      const pulled    = pu || [];
      const bonuses   = bo || {};
      const notices   = no || {};
      const plankData = pl || null;
      const plankHist = ph || [];
      const saved     = pget(KEYS.username);
      const today     = todayStr();

      // Write seed questions if DB is empty
      if (!q) await sset(KEYS.questions, SEED);

      const pulledIds = new Set(pulled.map(p=>p.qid));
      const activeQ   = questions.filter(q=>!pulledIds.has(q.id));
      let dq = dqRaw;
      if(!dq||dq.date!==today){ dq={date:today,qids:buildDailyQueue(activeQ,today)}; await sset(KEYS.dailyQ,dq); }

      let nextScores=scores, nextPlank=plankData, nextHistory=plankHist;
      const thisWeek=currentWeekStr(), prevWeek=prevWeekStr();
      if((!plankData||plankData.weekStr!==prevWeek)&&prevWeek!==thisWeek){
        const result=calcPlankVictim(attempts);
        if(result){
          const wiped={...scores};
          if(wiped[result.victim]) wiped[result.victim]=wiped[result.victim].filter(e=>weekStr(e.ts)!==prevWeek);
          await sset(KEYS.scores,wiped); nextScores=wiped;
          nextPlank={weekStr:prevWeek,victim:result.victim,pct:result.pct,correct:result.correct,total:result.total,processedAt:Date.now()};
          await sset(KEYS.plank,nextPlank);
          nextHistory=[...plankHist.filter(h=>h.weekStr!==prevWeek),nextPlank];
          await sset(KEYS.plankHistory,nextHistory);
        }
      }

      setQuestions(questions); setScores(nextScores); setAnswered(answered);
      setAttempts(attempts); setDailyLog(dailyLog); setFlags(flags);
      setPulled(pulled); setBonuses(bonuses); setNotices(notices);
      setDailyQ(dq); setPlank(nextPlank); setPlankHistory(nextHistory);
      if(saved) setUsername(saved);
      if(nextPlank&&nextPlank.weekStr===prevWeekStr()){
        const dismissed=pget("plank_dismissed");
        if(dismissed!==nextPlank.weekStr){ setPlankIsVictim(nextPlank.victim===saved); setShowPlank(true); }
      }
      setLoading(false);

      // ── Real-time listeners — update UI when other players make changes ──
      initFirebase();
      if(_firebaseReady && _db && !firebaseConfig.apiKey.includes("REPLACE")){
        // Listen for score changes (leaderboard updates live)
        _db.ref("scallywag/" + KEYS.scores).on("value", snap => {
          const val = snap.val();
          if(val){ invalidate(KEYS.scores); setScores(val); }
        });
        // Listen for new questions
        _db.ref("scallywag/" + KEYS.questions).on("value", snap => {
          const val = snap.val();
          if(val){ invalidate(KEYS.questions); setQuestions(val); }
        });
        // Listen for flags and pulled questions
        _db.ref("scallywag/" + KEYS.flags).on("value", snap => {
          const val = snap.val();
          if(val){ invalidate(KEYS.flags); setFlags(val); }
        });
        _db.ref("scallywag/" + KEYS.notices).on("value", snap => {
          const val = snap.val();
          if(val){ invalidate(KEYS.notices); setNotices(val); }
        });
      }
    })();
  },[]);

  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(""),2800);};

  const sv=q=>{setQuestions(q);sset(KEYS.questions,q);};
  const ss=s=>{setScores(s);sset(KEYS.scores,s);};
  const sa=a=>{setAnswered(a);sset(KEYS.answered,a);};
  const sat=at=>{setAttempts(at);sset(KEYS.attempts,at);};
  const sdl=dl=>{setDailyLog(dl);sset(KEYS.dailyLog,dl);};
  const sfl=fl=>{setFlags(fl);sset(KEYS.flags,fl);};
  const spu=pu=>{setPulled(pu);sset(KEYS.pulled,pu);};
  const sbo=bo=>{setBonuses(bo);sset(KEYS.bonuses,bo);};
  const sno=no=>{setNotices(no);sset(KEYS.notices,no);};

  const handleLogin=name=>{if(!name.trim())return;setUsername(name.trim());pset(KEYS.username,name.trim());};
  const addScore=(user,pts)=>{const n={...scores};if(!n[user])n[user]=[];n[user]=[...n[user],{ts:now(),pts}];ss(n);};
  const markAnswered=(qid,user)=>{const a={...answered};if(!a[qid])a[qid]=[];if(!a[qid].includes(user))a[qid]=[...a[qid],user];sa(a);};
  const recordAttempt=(qid,user,answer,correct)=>{const at={...attempts};if(!at[qid])at[qid]=[];at[qid]=[...at[qid],{user,answer,correct,ts:now()}];sat(at);};
  const markDailyAnswer=(user,qid)=>{const key=`${user}|${todayStr()}`;const n={...dailyLog};if(!n[key])n[key]=[];if(!n[key].includes(qid))n[key]=[...n[key],qid];sdl(n);return n;};
  const dismissPlank=()=>{setShowPlank(false);pset("plank_dismissed",plank?.weekStr);};
  const dismissNotice=(user,qid)=>{const n={...notices};if(n[user])n[user]=n[user].filter(x=>x.qid!==qid);sno(n);};



  const flagQuestion=(qid,flagger)=>{
    const q=questions.find(q=>q.id===qid); if(!q) return;
    const nf={...flags}; if(!nf[qid])nf[qid]=[]; if(nf[qid].includes(flagger)){showToast("Ye already flagged this one, matey.");return;}
    nf[qid]=[...nf[qid],flagger]; sfl(nf);
    const fc=nf[qid].length;
    if(fc>=FLAG_THRESHOLD){
      const affected=answered[qid]||[];
      const np=[...pulled,{qid,subject:q.subject,question:q.question,pulledAt:now(),affectedUsers:affected}];
      spu(np);
      if(affected.length>0){
        const nb={...bonuses},nn={...notices};
        affected.forEach(user=>{nb[user]=(nb[user]||0)+1;if(!nn[user])nn[user]=[];nn[user]=[...nn[user],{qid,subject:q.subject,question:q.question,ts:now()}];});
        sbo(nb); sno(nn);
      }
      const pids=new Set(np.map(p=>p.qid));
      const aq=questions.filter(q=>!pids.has(q.id));
      const newDq={date:todayStr(),qids:buildDailyQueue(aq,todayStr())};
      setDailyQ(newDq); sset(KEYS.dailyQ,newDq);
      showToast("Question pulled by the crew! 🏴‍☠️");
    } else {
      const rem=FLAG_THRESHOLD-fc;
      showToast(`Flagged! ${rem} more flag${rem!==1?"s":""} needed.`);
    }
  };

  const dailyAnsweredCount=username?(dailyLog[`${username}|${todayStr()}`]||[]).length:0;
  const bonusCount=username?(bonuses[username]||0):0;
  const effectiveLimit=DAILY_LIMIT+bonusCount;
  const userNotices=username?(notices[username]||[]):[];
  const pulledIds=new Set(pulled.map(p=>p.qid));
  const activeQuestions=questions.filter(q=>!pulledIds.has(q.id));

  const e=React.createElement;

  if(loading) return e("div",{style:{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#0f0f0f"}},
    e("div",{style:{width:36,height:36,border:"3px solid #222",borderTop:"3px solid #d4a017",borderRadius:"50%",animation:"spin .8s linear infinite"}}),
    e("p",{style:{color:"#555",fontFamily:"Lato,sans-serif",marginTop:14,fontSize:13,letterSpacing:2,textTransform:"uppercase"}},"Boarding the ship…")
  );

  if(!username) return e(LoginScreen,{nameInput,setNameInput,onLogin:()=>handleLogin(nameInput)});

  return e("div",{style:{minHeight:"100dvh",background:"#0f0f0f",color:"#e8dcc8",fontFamily:"'Lato',sans-serif",display:"flex",flexDirection:"column",paddingBottom:72}},
    showPlank&&plank&&e(TheatricalPlankScene,{victim:plank.victim,pct:plank.pct,correct:plank.correct,total:plank.total,isVictim:plankIsVictim,onDismiss:dismissPlank}),
    e(AppHeader,{username,setScreen,noticeCount:userNotices.length}),
    userNotices.length>0&&screen!=="settings"&&e(NoticeBanner,{notices:userNotices,onDismiss:qid=>dismissNotice(username,qid)}),
    e("main",{style:{flex:1,overflowY:"auto"}},
      screen==="home"&&e(HomeScreen,{username,questions:activeQuestions,scores,dailyAnsweredCount,effectiveLimit,bonusCount,plank,onNavigate:setScreen,onShowPlank:()=>{setPlankIsVictim(plank?.victim===username);setShowPlank(true);}}),
      screen==="play"&&e(PlayScreen,{username,questions:activeQuestions,answered,dailyQ,dailyLog,dailyAnsweredCount,effectiveLimit,flags,pulledIds,
        onCorrect:(qid,ans)=>{addScore(username,10);markAnswered(qid,username);recordAttempt(qid,username,ans,true);const dl=markDailyAnswer(username,qid);if(bonusCount>0){const nb={...bonuses};nb[username]=nb[username]-1;if(nb[username]<=0)delete nb[username];sbo(nb);}return dl;},
        onWrong:(qid,ans)=>{markAnswered(qid,username);recordAttempt(qid,username,ans,false);const dl=markDailyAnswer(username,qid);if(bonusCount>0){const nb={...bonuses};nb[username]=nb[username]-1;if(nb[username]<=0)delete nb[username];sbo(nb);}return dl;},
        onFlag:flagQuestion}),
      screen==="submit"&&e(SubmitScreen,{username,questions,answered,attempts,onSubmit:q=>{const next=[...questions,{...q,id:uid(),author:username,ts:now()}];sv(next);const pids=new Set(pulled.map(p=>p.qid));const aq=next.filter(q=>!pids.has(q.id));const newDq={date:todayStr(),qids:buildDailyQueue(aq,todayStr())};setDailyQ(newDq);sset(KEYS.dailyQ,newDq);showToast("Question added! 🎉");setScreen("home");}}),
      screen==="leaderboard"&&e(LeaderboardScreen,{scores,username,plank,plankHistory}),
      screen==="settings"&&e(SettingsScreen,{username,userNotices,onSaveName:newName=>{if(!newName.trim())return;setUsername(newName.trim());pset(KEYS.username,newName.trim());showToast("Name updated! ⚓");setScreen("home");},onDismissNotice:qid=>dismissNotice(username,qid)})
    ),
    e(BottomNav,{screen,setScreen,dailyAnsweredCount,effectiveLimit,noticeCount:userNotices.length}),
    toast&&e("div",{style:{position:"fixed",bottom:90,left:"50%",transform:"translateX(-50%)",background:"#1a1500",border:"1px solid #d4a017",color:"#d4a017",borderRadius:24,padding:"11px 22px",fontSize:14,zIndex:9999,whiteSpace:"nowrap",animation:"fadeup .3s ease",boxShadow:"0 8px 32px rgba(0,0,0,.5)"}},toast)
  );
}

// ── Sub-components (LoginScreen, AppHeader, BottomNav, HomeScreen, PlayScreen, etc.)
// These are identical to the trivia-app.jsx versions but using React.createElement instead of JSX.
// For brevity they reference the functions defined below.

function LoginScreen({nameInput,setNameInput,onLogin}){
  const e=React.createElement;
  return e("div",{style:{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"radial-gradient(ellipse at 50% 20%,#1c1200,#0a0a0a 65%)",padding:20}},
    e("div",{style:{background:"#111",border:"1px solid #2a2000",borderRadius:24,padding:"52px 40px 44px",maxWidth:400,width:"100%",textAlign:"center",boxShadow:"0 32px 80px rgba(0,0,0,.7)",animation:"pop .35s ease"}},
      e("div",{style:{fontSize:52,marginBottom:16}},"⚓"),
      e("div",{style:{fontFamily:"'Cinzel',serif",fontSize:36,fontWeight:900,color:"#d4a017",letterSpacing:4,lineHeight:1}},"ScAllywag"),
      e("div",{style:{fontFamily:"'Cinzel',serif",fontSize:13,color:"#6a5a30",letterSpacing:6,textTransform:"uppercase",marginBottom:36,marginTop:4}},"Trivia"),
      e("input",{style:{width:"100%",background:"#0a0a0a",border:"1px solid #2a2000",borderRadius:10,padding:"14px 18px",color:"#e8dcc8",fontSize:15,fontFamily:"Lato,sans-serif",outline:"none",marginBottom:14,boxSizing:"border-box"},placeholder:"Enter your name to play…",value:nameInput,onChange:ev=>setNameInput(ev.target.value),onKeyDown:ev=>ev.key==="Enter"&&onLogin(),autoFocus:true}),
      e("button",{onClick:onLogin,style:{width:"100%",background:"#d4a017",color:"#0a0800",border:"none",borderRadius:10,padding:"14px",fontSize:15,fontWeight:700,fontFamily:"'Cinzel',serif",letterSpacing:2}},"Set Sail")
    )
  );
}

function AppHeader({username,setScreen,noticeCount}){
  const e=React.createElement;
  return e("header",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px 12px",background:"#0a0a0a",borderBottom:"1px solid #1c1c1c",flexShrink:0}},
    e("div",null,
      e("div",{style:{fontFamily:"'Cinzel',serif",fontSize:20,fontWeight:900,color:"#d4a017",letterSpacing:2,lineHeight:1}},"⚓ ScAllywag"),
      e("div",{style:{fontFamily:"'Cinzel',serif",fontSize:10,color:"#6a5a30",letterSpacing:4,textTransform:"uppercase",marginTop:2}},"Trivia")
    ),
    e("button",{onClick:()=>setScreen("settings"),style:{background:"#161616",border:"1px solid #2a2a2a",borderRadius:24,color:"#888",padding:"7px 14px",fontSize:13,fontFamily:"Lato,sans-serif",display:"flex",alignItems:"center",gap:7,position:"relative"}},
      noticeCount>0&&e("span",{style:{position:"absolute",top:-4,right:-4,width:10,height:10,background:"#e05555",borderRadius:"50%",border:"2px solid #0a0a0a"}}),
      e("span",{style:{width:22,height:22,borderRadius:"50%",background:"#d4a017",color:"#0a0a0a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700}},username[0].toUpperCase()),
      e("span",{style:{maxWidth:90,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},username),
      e("span",{style:{fontSize:12,color:"#555"}},"⚙️")
    )
  );
}

function NoticeBanner({notices,onDismiss}){
  const e=React.createElement;
  return e("div",{style:{background:"#1a0a00",borderBottom:"1px solid #5a2500",padding:"12px 20px",animation:"slideDown .3s ease"}},
    notices.map(n=>e("div",{key:n.qid,style:{display:"flex",alignItems:"flex-start",gap:12,marginBottom:notices.length>1?10:0}},
      e("span",{style:{fontSize:18,flexShrink:0,marginTop:1}},"⚠️"),
      e("p",{style:{flex:1,color:"#f0a060",fontSize:13,lineHeight:1.5}},`A question you answered (`,e("strong",null,`"${n.subject}"`),`) was flagged and pulled by the crew. Ye've been granted `,e("strong",null,"+1 bonus question"),` for yer next voyage!`),
      e("button",{onClick:()=>onDismiss(n.qid),style:{background:"none",border:"none",color:"#5a2500",fontSize:18,padding:0,flexShrink:0,lineHeight:1,cursor:"pointer"}},"✕")
    ))
  );
}

function BottomNav({screen,setScreen,dailyAnsweredCount,effectiveLimit,noticeCount}){
  const e=React.createElement;
  const tabs=[{id:"home",icon:"🏠",label:"Home"},{id:"play",icon:"🎯",label:"Play"},{id:"submit",icon:"✏️",label:"Submit"},{id:"leaderboard",icon:"🏆",label:"Board"},{id:"settings",icon:"⚙️",label:"Settings"}];
  return e("nav",{style:{position:"fixed",bottom:0,left:0,right:0,height:68,background:"#0a0a0a",borderTop:"1px solid #1c1c1c",display:"flex",zIndex:200}},
    tabs.map(t=>{
      const active=screen===t.id;
      const playBadge=t.id==="play"&&dailyAnsweredCount<effectiveLimit;
      const settingsBadge=t.id==="settings"&&noticeCount>0;
      return e("button",{key:t.id,onClick:()=>setScreen(t.id),style:{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,background:"none",border:"none",color:active?"#d4a017":"#444",fontFamily:"Lato,sans-serif",fontSize:11,letterSpacing:.5,padding:"8px 0 6px",position:"relative"}},
        active&&e("div",{style:{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:32,height:2,background:"#d4a017",borderRadius:"0 0 3px 3px"}}),
        e("span",{style:{fontSize:20,lineHeight:1,position:"relative"}},
          t.icon,
          playBadge&&e("span",{style:{position:"absolute",top:-4,right:-8,background:"#d4a017",color:"#0a0800",borderRadius:10,fontSize:9,fontWeight:700,padding:"1px 5px",lineHeight:1.4}},effectiveLimit-dailyAnsweredCount),
          settingsBadge&&e("span",{style:{position:"absolute",top:-4,right:-8,background:"#e05555",color:"#fff",borderRadius:10,fontSize:9,fontWeight:700,padding:"1px 5px",lineHeight:1.4}},noticeCount)
        ),
        e("span",{style:{fontWeight:active?700:400}},t.label)
      );
    })
  );
}

function HomeScreen({username,questions,scores,dailyAnsweredCount,effectiveLimit,bonusCount,plank,onNavigate,onShowPlank}){
  const e=React.createElement;
  const userScore=(scores[username]||[]).reduce((a,b)=>a+b.pts,0);
  const remaining=effectiveLimit-dailyAnsweredCount;
  const isVictim=plank&&plank.victim===username;
  return e("div",{style:{maxWidth:680,margin:"0 auto",padding:"28px 20px 32px"}},
    e("div",{style:{marginBottom:28}},
      e("p",{style:{color:"#5a4a20",fontSize:12,textTransform:"uppercase",letterSpacing:3,marginBottom:4}},"Welcome aboard,"),
      e("h1",{style:{fontFamily:"'Cinzel',serif",fontSize:30,color:"#e8dcc8",fontWeight:700}},username)
    ),
    plank&&e("button",{onClick:onShowPlank,style:{width:"100%",background:isVictim?"#1a0000":"#0e0c00",border:`1px solid ${isVictim?"#6a0000":"#5a3000"}`,borderRadius:14,padding:"14px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:12,textAlign:"left",cursor:"pointer",boxShadow:`0 0 20px ${isVictim?"rgba(180,0,0,.15)":"rgba(180,80,0,.15)"}`}},
      e("span",{style:{fontSize:26}},isVictim?"😱":"☠️"),
      e("div",{style:{flex:1}},
        e("p",{style:{fontFamily:"'Cinzel',serif",fontSize:13,color:isVictim?"#e05555":"#d4a017",fontWeight:700,letterSpacing:1,marginBottom:2}},isVictim?"YE WALKED THE PLANK!":`${plank.victim} walked the plank!`),
        e("p",{style:{color:"#555",fontSize:11}},isVictim?`Only ${plank.pct}% correct last week — yer weekly score was wiped.`:`${plank.pct}% correct last week — weekly score wiped.`)
      ),
      e("span",{style:{color:"#555",fontSize:11}},"Watch →")
    ),
    e("div",{style:{background:"#141414",borderRadius:14,padding:"18px 20px",marginBottom:16,border:"1px solid #1e1e1e"}},
      e("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}},
        e("span",{style:{color:"#5a4a20",fontSize:11,textTransform:"uppercase",letterSpacing:2}},"Today's Voyage"),
        e("div",{style:{display:"flex",alignItems:"center",gap:8}},
          bonusCount>0&&e("span",{style:{background:"#2a1500",border:"1px solid #8a4500",color:"#f0a060",borderRadius:12,padding:"2px 10px",fontSize:11}},`+${bonusCount} bonus`),
          e("span",{style:{fontFamily:"'Cinzel',serif",color:remaining>0?"#d4a017":"#555",fontSize:13}},`${dailyAnsweredCount}/${effectiveLimit} answered`)
        )
      ),
      e("div",{style:{background:"#0a0a0a",borderRadius:20,height:8,overflow:"hidden"}},
        e("div",{style:{height:"100%",width:`${Math.min((dailyAnsweredCount/effectiveLimit)*100,100)}%`,background:dailyAnsweredCount>=effectiveLimit?"#555":"linear-gradient(90deg,#b8820f,#f5c842)",borderRadius:20,transition:"width .4s ease"}})
      ),
      remaining>0
        ?e("p",{style:{color:"#555",fontSize:12,marginTop:8}},`${remaining} question${remaining!==1?"s":""} remaining today`)
        :e("p",{style:{color:"#444",fontSize:12,marginTop:8}},"⚓ All done for today — come back tomorrow!")
    ),
    e("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:28}},
      ...[{label:"Your Score",val:userScore+" pts",accent:"#d4a017"},{label:"Questions in Pool",val:questions.length,accent:"#4ecdc4"},{label:"Daily Progress",val:`${dailyAnsweredCount}/${effectiveLimit}`,accent:"#f0814a"},{label:"Your Questions",val:questions.filter(q=>q.author===username).length,accent:"#b87cf5"}].map(s=>
        e("div",{key:s.label,style:{background:"#141414",borderRadius:14,padding:"18px 16px",borderLeft:`3px solid ${s.accent}`}},
          e("div",{style:{fontFamily:"'Cinzel',serif",fontSize:26,fontWeight:700,color:s.accent}},s.val),
          e("div",{style:{color:"#555",fontSize:11,textTransform:"uppercase",letterSpacing:1.5,marginTop:5}},s.label)
        )
      )
    ),
    e("div",{style:{display:"flex",flexDirection:"column",gap:10,marginBottom:36}},
      e("button",{onClick:()=>onNavigate("play"),style:{background:remaining>0?"#d4a017":"#1c1c1c",color:remaining>0?"#0a0800":"#444",border:remaining>0?"none":"1px solid #2a2a2a",borderRadius:12,padding:"16px",fontSize:16,fontWeight:700,fontFamily:"'Cinzel',serif",letterSpacing:1,textAlign:"left",paddingLeft:22}},`🎯  ${remaining>0?`Play Trivia (${remaining} left today)`:"Play Trivia (done for today)"}`),
      e("div",{style:{display:"flex",gap:10}},
        e("button",{onClick:()=>onNavigate("submit"),style:{flex:1,background:"#161616",border:"1px solid #2a2a2a",borderRadius:12,padding:"14px",fontSize:14,color:"#e8dcc8",fontFamily:"Lato,sans-serif"}},"✏️  Submit a Question"),
        e("button",{onClick:()=>onNavigate("leaderboard"),style:{flex:1,background:"#161616",border:"1px solid #2a2a2a",borderRadius:12,padding:"14px",fontSize:14,color:"#e8dcc8",fontFamily:"Lato,sans-serif"}},"🏆  Leaderboard")
      )
    ),
    e("p",{style:{color:"#5a4a20",fontSize:11,textTransform:"uppercase",letterSpacing:3,marginBottom:12}},"Recent Questions"),
    questions.slice(-6).reverse().map(q=>
      e("div",{key:q.id,style:{display:"flex",alignItems:"center",gap:10,padding:"11px 0",borderBottom:"1px solid #1a1a1a"}},
        e("span",{style:{background:"#1a1400",border:"1px solid #2e2200",color:"#d4a017",borderRadius:20,padding:"3px 12px",fontSize:12,whiteSpace:"nowrap"}},q.subject),
        e("span",{style:{color:"#555",fontSize:12,whiteSpace:"nowrap"}},`by ${q.author}`),
        e("span",{style:{color:"#333",fontSize:12,marginLeft:"auto",whiteSpace:"nowrap"}},timeLabel(q.ts))
      )
    )
  );
}

function PlayScreen({username,questions,answered,dailyQ,dailyLog,dailyAnsweredCount,effectiveLimit,flags,pulledIds,onCorrect,onWrong,onFlag}){
  const [currentQ,setCurrentQ]=useState(null);
  const [revealed,setRevealed]=useState(false);
  const [answerInput,setAnswerInput]=useState("");
  const [result,setResult]=useState(null);
  const [resultMsg,setResultMsg]=useState(null);
  const [showParticles,setShowParticles]=useState(false);
  const [localCount,setLocalCount]=useState(dailyAnsweredCount);
  const [flagged,setFlagged]=useState(false);
  const [showFlagConfirm,setShowFlagConfirm]=useState(false);
  const e=React.createElement;

  const getQ=useCallback((slotIndex,log)=>{
    if(!dailyQ?.qids?.length) return null;
    const logKey=`${username}|${todayStr()}`;
    const today=(log[logKey]||[]);
    const primaryQ=questions.find(q=>q.id===dailyQ.qids[slotIndex]&&!pulledIds.has(q.id));
    if(primaryQ&&primaryQ.author!==username) return primaryQ;
    const used=new Set([...dailyQ.qids,...today]);
    return questions.find(q=>q.author!==username&&!used.has(q.id)&&!pulledIds.has(q.id))||null;
  },[dailyQ,questions,username,pulledIds]);

  const loadNext=useCallback(log=>{
    const logKey=`${username}|${todayStr()}`;
    const todayA=((log||dailyLog)[logKey]||[]);
    const slot=todayA.length;
    if(slot>=effectiveLimit){setCurrentQ(null);return;}
    setCurrentQ(getQ(slot,log||dailyLog));
    setRevealed(false);setAnswerInput("");setResult(null);setResultMsg(null);setShowParticles(false);setFlagged(false);setShowFlagConfirm(false);
  },[dailyLog,getQ,username,effectiveLimit]);

  useEffect(()=>{loadNext(dailyLog);},[]);

  const handleAnswer=async()=>{
    if(!answerInput.trim()||result||!currentQ) return;
    const correct=normalize(answerInput)===normalize(currentQ.answer);
    const lines=correct?TREASURE_LINES:LOOT_LOST_LINES;
    setResult(correct?"correct":"wrong");
    setResultMsg(lines[Math.floor(Math.random()*lines.length)]);
    setShowParticles(true);
    setTimeout(()=>setShowParticles(false),3200);
    const dl=correct?onCorrect(currentQ.id,answerInput.trim()):onWrong(currentQ.id,answerInput.trim());
    setLocalCount(p=>p+1);
    if(dl) setCurrentQ(p=>({...p,_updatedLog:dl}));
  };

  const handleNext=()=>{loadNext(currentQ?._updatedLog||dailyLog);};
  const handleFlag=async()=>{if(!currentQ||flagged)return;setFlagged(true);setShowFlagConfirm(false);onFlag(currentQ.id,username);};

  if(localCount>=effectiveLimit&&!result) return e(DoneForToday,{effectiveLimit});
  if(!currentQ&&localCount>=effectiveLimit) return e(DoneForToday,{effectiveLimit});
  if(!currentQ) return e("div",{style:{maxWidth:480,margin:"0 auto",padding:"60px 24px",textAlign:"center"}},
    e("div",{style:{fontSize:56,marginBottom:16}},"🗺️"),
    e("h2",{style:{fontFamily:"'Cinzel',serif",color:"#d4a017",fontSize:22,marginBottom:12}},"No questions available"),
    e("p",{style:{color:"#555",fontSize:14}},"All questions were written by you or already used. Ask yer crew to submit more!")
  );

  const isCorrect=result==="correct",isWrong=result==="wrong";

  if(result&&resultMsg) return e(React.Fragment,null,
    showParticles&&e(Particles,{type:result}),
    e("div",{style:{position:"fixed",inset:0,zIndex:40,background:isCorrect?"radial-gradient(ellipse at 50% 40%,#1a3a00,#0a1a00 50%,#050f00)":"radial-gradient(ellipse at 50% 40%,#3a0000,#1a0000 50%,#0a0000)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",padding:32,animation:"pop .4s ease"}},
      e("div",{style:{fontSize:88,marginBottom:16,animation:isCorrect?"treasureBounce .6s ease":"lootShake .5s ease",display:"inline-block"}},resultMsg.emoji),
      e("h1",{style:{fontFamily:"'Cinzel',serif",fontSize:28,fontWeight:900,letterSpacing:3,color:isCorrect?"#f5c842":"#cc3333",textShadow:isCorrect?"0 0 40px rgba(245,200,66,.6)":"0 0 40px rgba(200,50,50,.5)",marginBottom:12,lineHeight:1.2}},resultMsg.headline),
      e("p",{style:{fontFamily:"Lato,sans-serif",fontSize:17,color:isCorrect?"#a8c87a":"#cc8888",marginBottom:20,maxWidth:320,lineHeight:1.5}},resultMsg.sub),
      isCorrect&&e("div",{style:{background:"rgba(245,200,66,.12)",border:"1px solid rgba(245,200,66,.35)",borderRadius:40,padding:"10px 28px",marginBottom:20,color:"#f5c842",fontFamily:"'Cinzel',serif",fontSize:18,fontWeight:700,letterSpacing:2}},"+10 Gold Coins"),
      isWrong&&e("div",{style:{background:"rgba(255,255,255,.05)",border:"1px solid #2a1010",borderRadius:12,padding:"14px 24px",marginBottom:16,maxWidth:340}},
        e("p",{style:{color:"#666",fontSize:12,textTransform:"uppercase",letterSpacing:2,marginBottom:6}},"The answer was"),
        e("p",{style:{color:"#e8dcc8",fontFamily:"'Cinzel',serif",fontSize:18,fontWeight:700}},currentQ.answer)
      ),
      isWrong&&!flagged&&!(flags[currentQ.id]||[]).includes(username)&&e("div",{style:{marginBottom:16}},
        !showFlagConfirm
          ?e("button",{onClick:()=>setShowFlagConfirm(true),style:{background:"none",border:"1px solid #3a2000",borderRadius:20,color:"#7a5030",padding:"7px 18px",fontSize:12}},"🚩 Flag as incorrect")
          :e("div",{style:{background:"#1a0e00",border:"1px solid #5a3000",borderRadius:12,padding:"14px 18px",maxWidth:300}},
            e("p",{style:{color:"#c08050",fontSize:13,marginBottom:12,lineHeight:1.4}},`Think this question is wrong? Flag it — ${Math.max(0,FLAG_THRESHOLD-(flags[currentQ.id]||[]).length)} more flag${Math.max(0,FLAG_THRESHOLD-(flags[currentQ.id]||[]).length)!==1?"s":""} and the crew pulls it.`),
            e("div",{style:{display:"flex",gap:8}},
              e("button",{onClick:handleFlag,style:{flex:1,background:"#5a2000",border:"none",borderRadius:8,color:"#f0a060",padding:"9px",fontSize:13,fontWeight:700}},"🚩 Confirm Flag"),
              e("button",{onClick:()=>setShowFlagConfirm(false),style:{flex:1,background:"#1a1a1a",border:"1px solid #2a2a2a",borderRadius:8,color:"#666",padding:"9px",fontSize:13}},"Cancel")
            )
          )
      ),
      isWrong&&(flagged||(flags[currentQ.id]||[]).includes(username))&&e("p",{style:{color:"#7a5030",fontSize:12,marginBottom:16}},"🚩 Flagged — thanks for keeping the pool clean!"),
      e("div",{style:{display:"flex",gap:8,marginBottom:24}},
        Array.from({length:effectiveLimit}).map((_,i)=>e("div",{key:i,style:{width:10,height:10,borderRadius:"50%",background:i<localCount?"#d4a017":i===localCount-1?(isCorrect?"#2ecc71":"#e74c3c"):"#2a2a2a",border:i===localCount-1?"none":"1px solid #333"}}))
      ),
      e("button",{onClick:handleNext,style:{background:isCorrect?"#f5c842":"#cc3333",color:isCorrect?"#0a0800":"#fff",border:"none",borderRadius:12,padding:"15px 36px",fontWeight:700,fontFamily:"'Cinzel',serif",fontSize:15,letterSpacing:2,boxShadow:isCorrect?"0 8px 32px rgba(245,200,66,.3)":"0 8px 32px rgba(200,50,50,.3)"}},localCount>=effectiveLimit?"See Results 🏴‍☠️":isCorrect?"Sail Onward →":"Next Question →")
    )
  );

  return e("div",{style:{maxWidth:680,margin:"0 auto",padding:"28px 20px 32px"}},
    e("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22}},
      e("span",{style:{color:"#555",fontSize:13}},"Question by ",e("strong",{style:{color:"#d4a017"}},currentQ.author)),
      e("div",{style:{display:"flex",alignItems:"center",gap:6}},
        e("span",{style:{color:"#5a4a20",fontSize:12}},`${localCount+1}/${effectiveLimit}`),
        Array.from({length:effectiveLimit}).map((_,i)=>e("div",{key:i,style:{width:8,height:8,borderRadius:"50%",background:i<localCount?"#d4a017":i===localCount?"#d4a01766":"#1e1e1e",border:i===localCount?"1px solid #d4a017":"1px solid #2a2a2a"}}))
      )
    ),
    e("div",{style:{background:"#121212",border:"2px solid #1e1e1e",borderRadius:20,padding:32,minHeight:280,display:"flex",alignItems:"center",justifyContent:"center"}},
      !revealed
        ?e("div",{style:{textAlign:"center",cursor:"pointer"},onClick:()=>setRevealed(true)},
            e("div",{style:{background:"#1a1400",border:"2px solid #d4a017",color:"#d4a017",borderRadius:14,padding:"18px 36px",fontSize:26,fontWeight:700,fontFamily:"'Cinzel',serif",display:"inline-block",marginBottom:20,letterSpacing:1}},currentQ.subject),
            e("p",{style:{color:"#3a3a3a",fontSize:14,animation:"pulse 2s ease-in-out infinite"}},"Tap to reveal the question")
          )
        :e("div",{style:{width:"100%",textAlign:"center"}},
            e("div",{style:{background:"#1a1400",border:"1px solid #2e2200",color:"#d4a017",borderRadius:20,padding:"4px 16px",fontSize:12,display:"inline-block",marginBottom:20}},currentQ.subject),
            e("p",{style:{fontSize:21,color:"#e8dcc8",lineHeight:1.55,marginBottom:28,fontFamily:"'Cinzel',serif",fontWeight:700}},currentQ.question),
            e("div",{style:{display:"flex",gap:10,maxWidth:480,margin:"0 auto"}},
              e("input",{style:{flex:1,background:"#0d0d0d",border:"1px solid #2a2a2a",borderRadius:8,padding:"12px 16px",color:"#e8dcc8",fontSize:15,outline:"none"},placeholder:"Type your answer…",value:answerInput,onChange:ev=>setAnswerInput(ev.target.value),onKeyDown:ev=>ev.key==="Enter"&&handleAnswer(),autoFocus:true}),
              e("button",{onClick:handleAnswer,style:{background:"#d4a017",color:"#0a0800",border:"none",borderRadius:8,padding:"12px 20px",fontWeight:700,fontSize:14}},"Submit")
            )
          )
    )
  );
}

function SubmitScreen({username,questions,answered,attempts,onSubmit}){
  const [subject,setSubject]=useState("");
  const [question,setQuestion]=useState("");
  const [answer,setAnswer]=useState("");
  const [error,setError]=useState("");
  const [expandedId,setExpandedId]=useState(null);
  const e=React.createElement;
  const myQs=questions.filter(q=>q.author===username).slice().reverse();
  const handle=()=>{
    if(!subject.trim()||!question.trim()||!answer.trim()){setError("All fields are required.");return;}
    onSubmit({subject:subject.trim(),question:question.trim(),answer:normalize(answer)});
  };
  const fs={width:"100%",background:"#0d0d0d",border:"1px solid #222",borderRadius:10,padding:"13px 16px",color:"#e8dcc8",fontSize:15,fontFamily:"Lato,sans-serif",outline:"none",marginBottom:20,boxSizing:"border-box"};
  const ls={display:"block",color:"#5a4a20",fontSize:11,textTransform:"uppercase",letterSpacing:2.5,marginBottom:8};
  return e("div",{style:{maxWidth:680,margin:"0 auto",padding:"28px 20px 32px"}},
    e("h2",{style:{fontFamily:"'Cinzel',serif",fontSize:24,color:"#d4a017",marginBottom:4}},"Submit a Question"),
    e("p",{style:{color:"#555",fontSize:13,marginBottom:28}},"Stump your crew. Submitting as ",e("strong",{style:{color:"#d4a017"}},username)),
    e("div",{style:{background:"#121212",border:"1px solid #1e1e1e",borderRadius:16,padding:"28px 24px",marginBottom:28}},
      e("label",{style:ls},"Subject / Category"),
      e("input",{style:fs,placeholder:"e.g. Science, Movies, Sports…",value:subject,onChange:ev=>setSubject(ev.target.value)}),
      e("label",{style:ls},"Your Question"),
      e("textarea",{style:{...fs,minHeight:90},placeholder:"Ask something tricky…",value:question,onChange:ev=>setQuestion(ev.target.value)}),
      e("label",{style:ls},"The Answer"),
      e("input",{style:{...fs,marginBottom:error?6:20},placeholder:"Exact answer (case-insensitive)",value:answer,onChange:ev=>setAnswer(ev.target.value)}),
      error&&e("p",{style:{color:"#e05555",fontSize:13,marginBottom:18}},error),
      e("button",{onClick:handle,style:{width:"100%",background:"#d4a017",color:"#0a0800",border:"none",borderRadius:10,padding:"14px",fontSize:15,fontWeight:700,fontFamily:"'Cinzel',serif",letterSpacing:1}},"Add to Pool 🚀")
    ),
    e("p",{style:{color:"#5a4a20",fontSize:11,textTransform:"uppercase",letterSpacing:3,marginBottom:12}},`Your Questions (${myQs.length})`),
    myQs.length===0
      ?e("p",{style:{color:"#333",fontStyle:"italic",textAlign:"center",padding:"24px 0",fontSize:14}},"None yet — add your first above!")
      :myQs.map(q=>{
          const qa=attempts[q.id]||[],correct=qa.filter(a=>a.correct).length,total=qa.length,pct=total>0?Math.round((correct/total)*100):null,isOpen=expandedId===q.id;
          const wrongMap={};qa.filter(a=>!a.correct).forEach(a=>{const k=a.answer.toLowerCase();if(!wrongMap[k])wrongMap[k]={text:a.answer,count:0,users:[]};wrongMap[k].count++;if(!wrongMap[k].users.includes(a.user))wrongMap[k].users.push(a.user);});
          const topWrong=Object.values(wrongMap).sort((a,b)=>b.count-a.count).slice(0,5);
          return e("div",{key:q.id,style:{marginBottom:10}},
            e("button",{onClick:()=>setExpandedId(isOpen?null:q.id),style:{width:"100%",background:"#141414",border:"1px solid #1e1e1e",borderRadius:isOpen?"14px 14px 0 0":"14px",padding:"14px 16px",display:"flex",alignItems:"center",gap:10,cursor:"pointer",textAlign:"left"}},
              e("span",{style:{background:"#1a1400",border:"1px solid #2e2200",color:"#d4a017",borderRadius:20,padding:"3px 12px",fontSize:12,whiteSpace:"nowrap",flexShrink:0}},q.subject),
              e("span",{style:{color:"#888",fontSize:13,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},q.question),
              pct!==null&&e("span",{style:{fontFamily:"'Cinzel',serif",fontSize:13,color:pct>=70?"#2ecc71":pct>=40?"#d4a017":"#e74c3c",fontWeight:700,flexShrink:0}},`${pct}%`),
              e("span",{style:{color:"#444",fontSize:12,flexShrink:0}},`${total} play${total!==1?"s":""}`),
              e("span",{style:{color:"#555",fontSize:16,transition:"transform .2s",display:"inline-block",transform:isOpen?"rotate(180deg)":"none"}},"▾")
            ),
            isOpen&&e("div",{style:{background:"#0e0e0e",border:"1px solid #1e1e1e",borderTop:"none",borderRadius:"0 0 14px 14px",padding:"20px 18px",animation:"pop .2s ease"}},
              total===0
                ?e("p",{style:{color:"#444",fontSize:13,textAlign:"center",padding:"12px 0"}},"No one has answered this yet, matey.")
                :e(React.Fragment,null,
                    e("div",{style:{marginBottom:20}},
                      e("div",{style:{display:"flex",justifyContent:"space-between",marginBottom:8}},
                        e("span",{style:{color:"#5a4a20",fontSize:11,textTransform:"uppercase",letterSpacing:2}},"Correct vs Wrong"),
                        e("span",{style:{color:"#555",fontSize:12}},`${correct} correct · ${total-correct} wrong · ${total} total`)
                      ),
                      e("div",{style:{display:"flex",height:10,borderRadius:8,overflow:"hidden",background:"#1a1a1a"}},
                        correct>0&&e("div",{style:{width:`${(correct/total)*100}%`,background:"#2ecc71"}}),
                        (total-correct)>0&&e("div",{style:{width:`${((total-correct)/total)*100}%`,background:"#e74c3c"}})
                      )
                    ),
                    e("div",{style:{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"rgba(46,204,113,.07)",border:"1px solid rgba(46,204,113,.2)",borderRadius:10,marginBottom:12}},
                      e("span",null,"✅"),
                      e("span",{style:{color:"#e8dcc8",fontSize:14,fontFamily:"'Cinzel',serif",flex:1}},q.answer),
                      e("span",{style:{color:"#2ecc71",fontSize:13,fontWeight:700}},`${correct}×`)
                    ),
                    correct>0&&e(React.Fragment,null,
                      e("p",{style:{color:"#5a4a20",fontSize:11,textTransform:"uppercase",letterSpacing:2,marginBottom:8}},"Got it right"),
                      e("div",{style:{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16}},
                        qa.filter(a=>a.correct).map((a,i)=>e("span",{key:i,style:{background:"#0d2010",border:"1px solid #1a4020",color:"#6fcf8a",borderRadius:20,padding:"3px 12px",fontSize:12}},a.user))
                      )
                    ),
                    topWrong.length>0&&e(React.Fragment,null,
                      e("p",{style:{color:"#5a4a20",fontSize:11,textTransform:"uppercase",letterSpacing:2,marginBottom:8}},"Common Wrong Answers"),
                      topWrong.map((w,i)=>e("div",{key:i,style:{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",background:"rgba(231,76,60,.05)",border:"1px solid rgba(231,76,60,.12)",borderRadius:9,marginBottom:6}},
                        e("span",null,"❌"),
                        e("span",{style:{color:"#c08080",fontSize:14,flex:1,fontStyle:"italic"}},`"${w.text}"`),
                        e("span",{style:{color:"#666",fontSize:12}},`${w.count}×`),
                        e("div",{style:{display:"flex",flexWrap:"wrap",gap:4}},w.users.map((u,j)=>e("span",{key:j,style:{background:"#1a0e0e",border:"1px solid #3a1515",color:"#8a5050",borderRadius:20,padding:"2px 8px",fontSize:11}},u)))
                      ))
                    ),
                    e("div",{style:{marginTop:14,paddingTop:12,borderTop:"1px solid #1a1a1a",display:"flex",justifyContent:"space-between",alignItems:"center"}},
                      e("span",{style:{color:"#444",fontSize:12}},`Added ${timeLabel(q.ts)}`),
                      e("span",{style:{color:"#555",fontSize:12}},`${(answered[q.id]||[]).length} unique player${(answered[q.id]||[]).length!==1?"s":""}`)
                    )
                  )
            )
          );
        })
  );
}

function LeaderboardScreen({scores,username,plank,plankHistory}){
  const [tab,setTab]=useState("alltime");
  const [plankTab,setPlankTab]=useState("alltime");
  const e=React.createElement;
  const tabs=[{id:"daily",label:"Day"},{id:"weekly",label:"Week"},{id:"monthly",label:"Month"},{id:"yearly",label:"Year"},{id:"alltime",label:"All"},{id:"plank",label:"☠️ Plank"}];
  const cutoff=thresholds[tab]?now()-thresholds[tab]:0;
  const allUsers=new Set([...Object.keys(scores),...(plank?.victim?[plank.victim]:[])]);
  const board=Array.from(allUsers).map(user=>({user,pts:(scores[user]||[]).filter(e=>e.ts>=cutoff).reduce((a,b)=>a+b.pts,0),isPlankVictim:plank?.victim===user})).filter(e=>e.pts>0||e.isPlankVictim).sort((a,b)=>b.pts-a.pts);
  const medals=["🥇","🥈","🥉"];
  const plankCutoffs={monthly:now()-DAY*30,yearly:now()-DAY*365,alltime:0};
  const plankTabs=[{id:"monthly",label:"Month"},{id:"yearly",label:"Year"},{id:"alltime",label:"All Time"}];
  const plankBoard=(()=>{
    const c={};
    (plankHistory||[]).filter(h=>h.processedAt>=(plankCutoffs[plankTab]||0)).forEach(h=>{
      if(!c[h.victim])c[h.victim]={user:h.victim,count:0,last:0,lastPct:0};
      c[h.victim].count++;
      if(h.processedAt>c[h.victim].last){c[h.victim].last=h.processedAt;c[h.victim].lastPct=h.pct;}
    });
    return Object.values(c).sort((a,b)=>b.count-a.count||b.last-a.last);
  })();
  const shameRanks=["🩸","💀","☠️"];

  return e("div",{style:{maxWidth:680,margin:"0 auto",padding:"28px 20px 32px"}},
    e("h2",{style:{fontFamily:"'Cinzel',serif",fontSize:24,color:"#d4a017",marginBottom:24}},"🏆 Leaderboard"),
    e("div",{style:{display:"flex",background:"#0d0d0d",borderRadius:12,padding:4,marginBottom:28,gap:3,flexWrap:"wrap"}},
      tabs.map(t=>e("button",{key:t.id,onClick:()=>setTab(t.id),style:{flex:1,minWidth:0,background:tab===t.id?"#1a1400":"none",border:tab===t.id?"1px solid #2e2200":"1px solid transparent",borderRadius:9,color:tab===t.id?"#d4a017":"#444",padding:"10px 3px",fontSize:12,fontWeight:tab===t.id?700:400,whiteSpace:"nowrap"}},t.label))
    ),
    tab!=="plank"
      ?(board.length===0
          ?e("div",{style:{textAlign:"center",padding:"64px 20px"}},e("div",{style:{fontSize:44}},"📭"),e("p",{style:{color:"#333",marginTop:14,fontSize:14}},"No scores yet for this period."))
          :e("div",{style:{display:"flex",flexDirection:"column",gap:8}},
              board.map((entry,i)=>e("div",{key:entry.user,style:{display:"flex",alignItems:"center",gap:16,background:entry.isPlankVictim?"#0e0000":i===0?"#1a1400":"#111",border:`1px solid ${entry.isPlankVictim?"#6a0000":entry.user===username?"#2a4a30":i===0?"#2e2200":"#1e1e1e"}`,borderRadius:14,padding:"16px 20px",opacity:entry.isPlankVictim?.85:1}},
                e("span",{style:{fontSize:24,width:34,textAlign:"center"}},entry.isPlankVictim?"☠️":(medals[i]||`#${i+1}`)),
                e("div",{style:{flex:1,display:"flex",flexDirection:"column",minWidth:0}},
                  e("span",{style:{fontFamily:"'Cinzel',serif",fontSize:16,color:entry.isPlankVictim?"#a05050":entry.user===username?"#8fcf9c":"#e8dcc8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},entry.user+(entry.user===username?" ✦":"")),
                  entry.isPlankVictim&&e("span",{style:{color:"#6a2020",fontSize:11,marginTop:2}},"walked the plank — weekly score wiped")
                ),
                e("span",{style:{fontFamily:"'Cinzel',serif",fontSize:20,fontWeight:700,color:entry.isPlankVictim?"#6a2020":i===0?"#d4a017":"#888",flexShrink:0}},entry.pts,e("span",{style:{fontSize:12,marginLeft:4,color:"#444"}},"pts"))
              ))
            )
        )
      :e("div",null,
          e("div",{style:{background:"#0e0000",border:"1px solid #4a0000",borderRadius:14,padding:"16px 18px",marginBottom:20,display:"flex",alignItems:"center",gap:12}},
            e("span",{style:{fontSize:28}},"🌊"),
            e("div",null,
              e("p",{style:{fontFamily:"'Cinzel',serif",fontSize:14,color:"#e05555",fontWeight:700,letterSpacing:1,marginBottom:2}},"Walk the Plank Leaderboard"),
              e("p",{style:{color:"#7a3030",fontSize:12}},"The most disgraced pirates of the seven seas. Fewest is best.")
            )
          ),
          e("div",{style:{display:"flex",background:"#0d0d0d",borderRadius:12,padding:4,marginBottom:20,gap:4}},
            plankTabs.map(t=>e("button",{key:t.id,onClick:()=>setPlankTab(t.id),style:{flex:1,background:plankTab===t.id?"#1a0000":"none",border:plankTab===t.id?"1px solid #5a0000":"1px solid transparent",borderRadius:9,color:plankTab===t.id?"#e05555":"#444",padding:"9px 4px",fontSize:13,fontWeight:plankTab===t.id?700:400}},t.label))
          ),
          plankBoard.length===0
            ?e("div",{style:{textAlign:"center",padding:"56px 20px"}},e("div",{style:{fontSize:44,marginBottom:12}},"⚓"),e("p",{style:{color:"#333",fontSize:14}},"No one has walked the plank yet this period!"))
            :e(React.Fragment,null,
                e("div",{style:{display:"flex",flexDirection:"column",gap:8}},
                  plankBoard.map((entry,i)=>e("div",{key:entry.user,style:{display:"flex",alignItems:"center",gap:14,background:i===0?"#1a0000":"#111",border:`1px solid ${entry.user===username?"#6a2020":i===0?"#6a0000":"#2a1010"}`,borderRadius:14,padding:"14px 18px"}},
                    e("span",{style:{fontSize:22,width:32,textAlign:"center"}},shameRanks[i]||`#${i+1}`),
                    e("div",{style:{flex:1,minWidth:0}},
                      e("span",{style:{fontFamily:"'Cinzel',serif",fontSize:15,color:entry.user===username?"#cf8080":"#c08080",display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},entry.user+(entry.user===username?" ✦":"")),
                      e("span",{style:{color:"#5a2020",fontSize:11,marginTop:2,display:"block"}},`Last: ${timeLabel(entry.last)} · ${entry.lastPct}% correct`)
                    ),
                    e("div",{style:{textAlign:"right",flexShrink:0}},
                      e("div",{style:{fontFamily:"'Cinzel',serif",fontSize:22,fontWeight:700,color:i===0?"#e05555":"#7a3030"}},entry.count),
                      e("div",{style:{color:"#5a2020",fontSize:10,textTransform:"uppercase",letterSpacing:1}},`time${entry.count!==1?"s":""}`)
                    )
                  ))
                ),
                e("div",{style:{marginTop:20,padding:"14px 16px",background:"#0a0a0a",borderRadius:12,border:"1px solid #1a1a1a"}},
                  e("p",{style:{color:"#3a3a3a",fontSize:11,textAlign:"center",fontStyle:"italic"}},"☠ Plank Roulette runs weekly. The pirate with the worst correct % walks the plank and loses their weekly score. ☠")
                )
              )
        )
  );
}

function SettingsScreen({username,userNotices,onSaveName,onDismissNotice}){
  const [nameInput,setNameInput]=useState(username);
  const [changed,setChanged]=useState(false);
  const [error,setError]=useState("");
  const e=React.createElement;
  const handleSave=()=>{
    if(!nameInput.trim()){setError("Name can't be empty, matey!");return;}
    if(nameInput.trim()===username){setError("That's already yer name!");return;}
    onSaveName(nameInput.trim());
  };
  return e("div",{style:{maxWidth:480,margin:"0 auto",padding:"36px 24px 32px"}},
    e("h2",{style:{fontFamily:"'Cinzel',serif",fontSize:24,color:"#d4a017",marginBottom:4}},"⚙️ Settings"),
    e("p",{style:{color:"#555",fontSize:13,marginBottom:28}},"Manage yer pirate identity"),
    userNotices.length>0&&e("div",{style:{marginBottom:24}},
      e("p",{style:{color:"#5a4a20",fontSize:11,textTransform:"uppercase",letterSpacing:2.5,marginBottom:10}},"Crew Notices"),
      userNotices.map(n=>e("div",{key:n.qid,style:{background:"#1a0a00",border:"1px solid #5a2500",borderRadius:12,padding:"14px 16px",marginBottom:8,display:"flex",gap:12,alignItems:"flex-start"}},
        e("span",{style:{fontSize:18,flexShrink:0}},"⚠️"),
        e("div",{style:{flex:1}},
          e("p",{style:{color:"#f0a060",fontSize:13,lineHeight:1.5,marginBottom:4}},"A question you answered in ",e("strong",null,`"${n.subject}"`),` was pulled by the crew.`),
          e("p",{style:{color:"#7a5030",fontSize:12}},"+1 bonus question has been added to yer next voyage.")
        ),
        e("button",{onClick:()=>onDismissNotice(n.qid),style:{background:"none",border:"none",color:"#5a2500",fontSize:16,padding:0,flexShrink:0,cursor:"pointer"}},"✕")
      ))
    ),
    e("div",{style:{background:"#121212",border:"1px solid #1e1e1e",borderRadius:16,padding:"28px 24px",marginBottom:20}},
      e("div",{style:{display:"flex",alignItems:"center",gap:14,marginBottom:24}},
        e("div",{style:{width:52,height:52,borderRadius:"50%",background:"#1a1400",border:"2px solid #d4a017",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Cinzel',serif",fontSize:22,fontWeight:900,color:"#d4a017"}},username[0].toUpperCase()),
        e("div",null,
          e("div",{style:{fontFamily:"'Cinzel',serif",fontSize:18,color:"#e8dcc8"}},username),
          e("div",{style:{color:"#555",fontSize:12,marginTop:2}},"Current pirate name")
        )
      ),
      e("label",{style:{display:"block",color:"#5a4a20",fontSize:11,textTransform:"uppercase",letterSpacing:2.5,marginBottom:8}},"Change Name"),
      e("input",{style:{width:"100%",background:"#0d0d0d",border:"1px solid #222",borderRadius:10,padding:"13px 16px",color:"#e8dcc8",fontSize:15,fontFamily:"Lato,sans-serif",outline:"none",marginBottom:error?8:16,boxSizing:"border-box"},value:nameInput,onChange:ev=>{setNameInput(ev.target.value);setChanged(ev.target.value.trim()!==username);setError("");},onKeyDown:ev=>ev.key==="Enter"&&handleSave(),placeholder:"Enter new name…"}),
      error&&e("p",{style:{color:"#e05555",fontSize:13,marginBottom:14}},error),
      e("button",{onClick:handleSave,disabled:!changed||!nameInput.trim(),style:{width:"100%",background:changed&&nameInput.trim()?"#d4a017":"#1c1c1c",color:changed&&nameInput.trim()?"#0a0800":"#444",border:changed&&nameInput.trim()?"none":"1px solid #2a2a2a",borderRadius:10,padding:"13px",fontSize:14,fontWeight:700,fontFamily:"'Cinzel',serif",letterSpacing:1,transition:"all .2s"}},"Save New Name")
    ),
    e("div",{style:{background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:14,padding:"18px 20px"}},
      e("p",{style:{color:"#3a3a3a",fontSize:12,lineHeight:1.6}},"⚓  Yer name is saved to this device. Changing it won't affect yer score history — scores are tied to yer previous name.")
    )
  );
}

// ── Boot the app ──────────────────────────────────────────────────────────────
const root = createRoot(document.getElementById("root"));
root.render(React.createElement(App));
