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
  vapidKey:          "REPLACE_WITH_YOUR_VAPID_KEY", // From Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
};

// ── Push notification helpers ──────────────────────────────────────────────
async function requestNotificationPermission(username) {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const db = getDB();
    if (!db) return false;

    // Get FCM token and save it to Firebase under this user
    const messaging = firebase.messaging();
    const token = await messaging.getToken({ vapidKey: firebaseConfig.vapidKey });
    if (token) {
      await db.ref("scallywag/fcm_tokens/" + btoa(username).replace(/=/g,'')).set({
        username, token, ts: Date.now()
      });
      pset("notifications_enabled", true);
      return true;
    }
    return false;
  } catch(e) {
    console.warn("Notification setup failed:", e.message);
    return false;
  }
}

async function disableNotifications(username) {
  try {
    const db = getDB();
    if (db) await db.ref("scallywag/fcm_tokens/" + btoa(username).replace(/=/g,'')).remove();
    pset("notifications_enabled", false);
  } catch(e) { console.warn("Disable notifications failed:", e.message); }
}

// Firebase is loaded via CDN in index.html
const _cache = {};
let _db = null;

// Wait for Firebase SDK to be ready, then initialize
function getDB() {
  if (_db) return _db;
  try {
    if (typeof firebase === "undefined") return null;
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    _db = firebase.database();
    return _db;
  } catch(e) {
    console.warn("Firebase init error:", e.message);
    return null;
  }
}

async function sget(key) {
  if (_cache[key] !== undefined) return _cache[key];
  const db = getDB();
  if (db) {
    try {
      const snap = await db.ref("scallywag/" + key).once("value");
      const val = snap.val();
      _cache[key] = val;
      try { localStorage.setItem("sg_shared_" + key, JSON.stringify(val)); } catch {}
      return val;
    } catch(e) {
      console.warn("Firebase read failed for", key, e.message);
    }
  }
  // Fallback to localStorage
  try {
    const v = localStorage.getItem("sg_shared_" + key);
    const val = v ? JSON.parse(v) : null;
    _cache[key] = val;
    return val;
  } catch { return null; }
}

async function sset(key, val) {
  _cache[key] = val;
  try { localStorage.setItem("sg_shared_" + key, JSON.stringify(val)); } catch {}
  const db = getDB();
  if (db) {
    try {
      await db.ref("scallywag/" + key).set(val);
    } catch(e) {
      console.warn("Firebase write failed for", key, e.message);
    }
  }
}

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
  usedQ:        "used_questions",  // tracks which questions have been used so far
  username:     "username",
};

const FLAG_THRESHOLD = 3;
const DAILY_LIMIT    = 3;
const DAY            = 86400000;

// ── Seed questions ─────────────────────────────────────────────────────────────
const SEED = [
  // ── Science & Nature (35) ─────────────────────────────────────────────────
  { id:"s01",  author:"Trivia Bot", subject:"Science", question:"What planet is closest to the Sun?", answer:"mercury", ts: Date.now()-DAY*299 },
  { id:"s02",  author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for gold?", answer:"au", ts: Date.now()-DAY*298 },
  { id:"s03",  author:"Trivia Bot", subject:"Science", question:"How many bones are in the adult human body?", answer:"206", ts: Date.now()-DAY*297 },
  { id:"s04",  author:"Trivia Bot", subject:"Science", question:"What gas do plants absorb from the atmosphere during photosynthesis?", answer:"carbon dioxide", ts: Date.now()-DAY*296 },
  { id:"s05",  author:"Trivia Bot", subject:"Science", question:"What is the hardest natural substance on Earth?", answer:"diamond", ts: Date.now()-DAY*295 },
  { id:"s06",  author:"Trivia Bot", subject:"Science", question:"What planet is known as the Red Planet?", answer:"mars", ts: Date.now()-DAY*294 },
  { id:"s07",  author:"Trivia Bot", subject:"Science", question:"What organ in the human body produces insulin?", answer:"pancreas", ts: Date.now()-DAY*293 },
  { id:"s08",  author:"Trivia Bot", subject:"Science", question:"What is the most abundant gas in Earth's atmosphere?", answer:"nitrogen", ts: Date.now()-DAY*292 },
  { id:"s09",  author:"Trivia Bot", subject:"Science", question:"How many chromosomes do humans have?", answer:"46", ts: Date.now()-DAY*291 },
  { id:"s10",  author:"Trivia Bot", subject:"Science", question:"What is the chemical formula for water?", answer:"h2o", crewNote:"Chemical formula required — letters and numbers, matey!", ts: Date.now()-DAY*290 },
  { id:"s11",  author:"Trivia Bot", subject:"Science", question:"What force keeps planets in orbit around the Sun?", answer:"gravity", ts: Date.now()-DAY*289 },
  { id:"s12",  author:"Trivia Bot", subject:"Science", question:"What is the powerhouse of the cell?", answer:"mitochondria", ts: Date.now()-DAY*288 },
  { id:"s13",  author:"Trivia Bot", subject:"Science", question:"How many elements are on the periodic table?", answer:"118", ts: Date.now()-DAY*287 },
  { id:"s14",  author:"Trivia Bot", subject:"Science", question:"What is the largest organ in the human body?", answer:"skin", ts: Date.now()-DAY*286 },
  { id:"s15",  author:"Trivia Bot", subject:"Science", question:"What planet has the most moons in our solar system?", answer:"saturn", ts: Date.now()-DAY*285 },
  { id:"s16",  author:"Trivia Bot", subject:"Science", question:"What is the atomic number of carbon?", answer:"6", crewNote:"Number only, ye scallywag!", ts: Date.now()-DAY*284 },
  { id:"s17",  author:"Trivia Bot", subject:"Science", question:"How many chambers does the human heart have?", answer:"4", ts: Date.now()-DAY*283 },
  { id:"s18",  author:"Trivia Bot", subject:"Science", question:"What planet is the largest in our solar system?", answer:"jupiter", ts: Date.now()-DAY*282 },
  { id:"s19",  author:"Trivia Bot", subject:"Science", question:"What is the name of the layer of the atmosphere closest to Earth?", answer:"troposphere", ts: Date.now()-DAY*281 },
  { id:"s20",  author:"Trivia Bot", subject:"Science", question:"What type of animal is a Komodo dragon?", answer:"lizard", ts: Date.now()-DAY*280 },
  { id:"s21",  author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for iron?", answer:"fe", ts: Date.now()-DAY*279 },
  { id:"s22",  author:"Trivia Bot", subject:"Science", question:"What is the smallest planet in our solar system?", answer:"mercury", ts: Date.now()-DAY*278 },
  { id:"s23",  author:"Trivia Bot", subject:"Science", question:"What part of the plant conducts photosynthesis?", answer:"leaves", ts: Date.now()-DAY*277 },
  { id:"s24",  author:"Trivia Bot", subject:"Science", question:"What is the boiling point of water in degrees Celsius?", answer:"100", ts: Date.now()-DAY*276 },
  { id:"s25",  author:"Trivia Bot", subject:"Science", question:"What is the study of earthquakes called?", answer:"seismology", ts: Date.now()-DAY*275 },
  { id:"s26",  author:"Trivia Bot", subject:"Science", question:"What is the most common blood type in humans?", answer:"o positive", ts: Date.now()-DAY*274 },
  { id:"s27",  author:"Trivia Bot", subject:"Science", question:"How many teeth does an adult human have including wisdom teeth?", answer:"32", ts: Date.now()-DAY*273 },
  { id:"s28",  author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for sodium?", answer:"na", crewNote:"Chemical symbol required — two letters, matey!", ts: Date.now()-DAY*272 },
  { id:"s29",  author:"Trivia Bot", subject:"Science", question:"What is the name of the closest star to Earth other than the Sun?", answer:"proxima centauri", crewNote:"Full name required, matey!", ts: Date.now()-DAY*271 },
  { id:"s30",  author:"Trivia Bot", subject:"Science", question:"What organ filters blood and produces urine?", answer:"kidney", ts: Date.now()-DAY*270 },
  { id:"s31",  author:"Trivia Bot", subject:"Science", question:"What is the speed of light in a vacuum approximately in miles per second?", answer:"186000", ts: Date.now()-DAY*269 },
  { id:"s32",  author:"Trivia Bot", subject:"Science", question:"What gas makes up about 21 percent of Earth's atmosphere?", answer:"oxygen", ts: Date.now()-DAY*268 },
  { id:"s33",  author:"Trivia Bot", subject:"Science", question:"What is the largest land animal on Earth?", answer:"elephant", ts: Date.now()-DAY*267 },
  { id:"s34",  author:"Trivia Bot", subject:"Science", question:"What is the name of the process by which a caterpillar becomes a butterfly?", answer:"metamorphosis", ts: Date.now()-DAY*266 },
  { id:"s35",  author:"Trivia Bot", subject:"Science", question:"What is the unit of electrical resistance?", answer:"ohm", ts: Date.now()-DAY*265 },

  // ── History (35) ─────────────────────────────────────────────────────────
  { id:"h01",  author:"Trivia Bot", subject:"History", question:"In what year did World War II end?", answer:"1945", ts: Date.now()-DAY*264 },
  { id:"h02",  author:"Trivia Bot", subject:"History", question:"Who was the first President of the United States?", answer:"george washington", crewNote:"Full name required, matey!", ts: Date.now()-DAY*263 },
  { id:"h03",  author:"Trivia Bot", subject:"History", question:"In what year did the Berlin Wall fall?", answer:"1989", ts: Date.now()-DAY*262 },
  { id:"h04",  author:"Trivia Bot", subject:"History", question:"What year did the Titanic sink?", answer:"1912", ts: Date.now()-DAY*261 },
  { id:"h05",  author:"Trivia Bot", subject:"History", question:"Who was the first human to walk on the moon?", answer:"neil armstrong", crewNote:"Full name required, matey!", ts: Date.now()-DAY*260 },
  { id:"h06",  author:"Trivia Bot", subject:"History", question:"In what year did World War I begin?", answer:"1914", ts: Date.now()-DAY*259 },
  { id:"h07",  author:"Trivia Bot", subject:"History", question:"What country did Napoleon Bonaparte come from?", answer:"france", ts: Date.now()-DAY*258 },
  { id:"h08",  author:"Trivia Bot", subject:"History", question:"In what year did the American Civil War end?", answer:"1865", ts: Date.now()-DAY*257 },
  { id:"h09",  author:"Trivia Bot", subject:"History", question:"Who wrote the Declaration of Independence?", answer:"thomas jefferson", crewNote:"Full name required, matey!", ts: Date.now()-DAY*256 },
  { id:"h10",  author:"Trivia Bot", subject:"History", question:"What year did the French Revolution begin?", answer:"1789", ts: Date.now()-DAY*255 },
  { id:"h11",  author:"Trivia Bot", subject:"History", question:"Which country was the first to give women the right to vote in 1893?", answer:"new zealand", ts: Date.now()-DAY*254 },
  { id:"h12",  author:"Trivia Bot", subject:"History", question:"Who was the first female Prime Minister of the United Kingdom?", answer:"margaret thatcher", crewNote:"Full name required, matey!", ts: Date.now()-DAY*253 },
  { id:"h13",  author:"Trivia Bot", subject:"History", question:"What year did the United States declare independence?", answer:"1776", ts: Date.now()-DAY*252 },
  { id:"h14",  author:"Trivia Bot", subject:"History", question:"What Egyptian queen had famous relationships with Julius Caesar and Mark Antony?", answer:"cleopatra", ts: Date.now()-DAY*251 },
  { id:"h15",  author:"Trivia Bot", subject:"History", question:"What was the name of the first artificial satellite launched into space in 1957?", answer:"sputnik", ts: Date.now()-DAY*250 },
  { id:"h16",  author:"Trivia Bot", subject:"History", question:"In what city was Martin Luther King Jr. assassinated in 1968?", answer:"memphis", ts: Date.now()-DAY*249 },
  { id:"h17",  author:"Trivia Bot", subject:"History", question:"What year did the Soviet Union dissolve?", answer:"1991", ts: Date.now()-DAY*248 },
  { id:"h18",  author:"Trivia Bot", subject:"History", question:"Who invented the telephone in 1876?", answer:"alexander graham bell", crewNote:"Full name required, matey!", ts: Date.now()-DAY*247 },
  { id:"h19",  author:"Trivia Bot", subject:"History", question:"What Roman amphitheater completed around 80 AD could hold up to 80000 spectators?", answer:"colosseum", ts: Date.now()-DAY*246 },
  { id:"h20",  author:"Trivia Bot", subject:"History", question:"Who was the leader of Nazi Germany during World War II?", answer:"adolf hitler", crewNote:"Full name required, matey!", ts: Date.now()-DAY*245 },
  { id:"h21",  author:"Trivia Bot", subject:"History", question:"What ancient civilization built Machu Picchu?", answer:"inca", ts: Date.now()-DAY*244 },
  { id:"h22",  author:"Trivia Bot", subject:"History", question:"In what year did Christopher Columbus first reach the Americas?", answer:"1492", ts: Date.now()-DAY*243 },
  { id:"h23",  author:"Trivia Bot", subject:"History", question:"What war was fought between North Korea and South Korea from 1950 to 1953?", answer:"korean war", ts: Date.now()-DAY*242 },
  { id:"h24",  author:"Trivia Bot", subject:"History", question:"Who was the first Roman Emperor?", answer:"augustus", ts: Date.now()-DAY*241 },
  { id:"h25",  author:"Trivia Bot", subject:"History", question:"What country did the United States purchase Alaska from in 1867?", answer:"russia", ts: Date.now()-DAY*240 },
  { id:"h26",  author:"Trivia Bot", subject:"History", question:"What ancient wonder was a giant statue located on the Greek island of Rhodes?", answer:"colossus of rhodes", ts: Date.now()-DAY*239 },
  { id:"h27",  author:"Trivia Bot", subject:"History", question:"In what year did the United States enter World War II?", answer:"1941", ts: Date.now()-DAY*238 },
  { id:"h28",  author:"Trivia Bot", subject:"History", question:"Who was the British Prime Minister during most of World War II?", answer:"winston churchill", crewNote:"Full name required, matey!", ts: Date.now()-DAY*237 },
  { id:"h29",  author:"Trivia Bot", subject:"History", question:"What empire did Genghis Khan found in the 13th century?", answer:"mongol empire", ts: Date.now()-DAY*236 },
  { id:"h30",  author:"Trivia Bot", subject:"History", question:"What year was the United Nations founded?", answer:"1945", ts: Date.now()-DAY*235 },
  { id:"h31",  author:"Trivia Bot", subject:"History", question:"Who was the first President of South Africa after apartheid ended?", answer:"nelson mandela", crewNote:"Full name required, matey!", ts: Date.now()-DAY*234 },
  { id:"h32",  author:"Trivia Bot", subject:"History", question:"What ancient city was destroyed by the eruption of Mount Vesuvius in 79 AD?", answer:"pompeii", ts: Date.now()-DAY*233 },
  { id:"h33",  author:"Trivia Bot", subject:"History", question:"What was the name of the ship that carried the Pilgrims to America in 1620?", answer:"mayflower", ts: Date.now()-DAY*232 },
  { id:"h34",  author:"Trivia Bot", subject:"History", question:"What US President was in office when the atomic bomb was dropped on Japan?", answer:"harry truman", crewNote:"Full name required, matey!", ts: Date.now()-DAY*231 },
  { id:"h35",  author:"Trivia Bot", subject:"History", question:"What year did India gain independence from Britain?", answer:"1947", ts: Date.now()-DAY*230 },

  // ── Geography (30) ───────────────────────────────────────────────────────
  { id:"g01",  author:"Trivia Bot", subject:"Geography", question:"What is the capital of Australia?", answer:"canberra", ts: Date.now()-DAY*229 },
  { id:"g02",  author:"Trivia Bot", subject:"Geography", question:"What is the longest river in the world?", answer:"nile", ts: Date.now()-DAY*228 },
  { id:"g03",  author:"Trivia Bot", subject:"Geography", question:"What is the smallest country in the world by area?", answer:"vatican city", ts: Date.now()-DAY*227 },
  { id:"g04",  author:"Trivia Bot", subject:"Geography", question:"What is the capital of Canada?", answer:"ottawa", ts: Date.now()-DAY*226 },
  { id:"g05",  author:"Trivia Bot", subject:"Geography", question:"On which continent is the Sahara Desert located?", answer:"africa", ts: Date.now()-DAY*225 },
  { id:"g06",  author:"Trivia Bot", subject:"Geography", question:"What is the tallest mountain in the world?", answer:"mount everest", ts: Date.now()-DAY*224 },
  { id:"g07",  author:"Trivia Bot", subject:"Geography", question:"What is the largest ocean in the world?", answer:"pacific", ts: Date.now()-DAY*223 },
  { id:"g08",  author:"Trivia Bot", subject:"Geography", question:"How many states does the United States have?", answer:"50", ts: Date.now()-DAY*222 },
  { id:"g09",  author:"Trivia Bot", subject:"Geography", question:"What is the capital of Japan?", answer:"tokyo", ts: Date.now()-DAY*221 },
  { id:"g10",  author:"Trivia Bot", subject:"Geography", question:"What is the longest mountain range in the world?", answer:"andes", ts: Date.now()-DAY*220 },
  { id:"g11",  author:"Trivia Bot", subject:"Geography", question:"What is the capital of Brazil?", answer:"brasilia", ts: Date.now()-DAY*219 },
  { id:"g12",  author:"Trivia Bot", subject:"Geography", question:"What is the largest country in the world by land area?", answer:"russia", ts: Date.now()-DAY*218 },
  { id:"g13",  author:"Trivia Bot", subject:"Geography", question:"What is the capital of Germany?", answer:"berlin", ts: Date.now()-DAY*217 },
  { id:"g14",  author:"Trivia Bot", subject:"Geography", question:"What US state is the largest by land area?", answer:"alaska", ts: Date.now()-DAY*216 },
  { id:"g16",  author:"Trivia Bot", subject:"Geography", question:"What is the capital of France?", answer:"paris", ts: Date.now()-DAY*214 },
  { id:"g17",  author:"Trivia Bot", subject:"Geography", question:"What is the capital of Italy?", answer:"rome", ts: Date.now()-DAY*213 },
  { id:"g18",  author:"Trivia Bot", subject:"Geography", question:"What is the largest desert in the world?", answer:"antarctica", ts: Date.now()-DAY*212 },
  { id:"g19",  author:"Trivia Bot", subject:"Geography", question:"What is the capital of China?", answer:"beijing", ts: Date.now()-DAY*211 },
  { id:"g20",  author:"Trivia Bot", subject:"Geography", question:"What is the deepest lake in the world?", answer:"lake baikal", ts: Date.now()-DAY*210 },
  { id:"g21",  author:"Trivia Bot", subject:"Geography", question:"What is the capital of Spain?", answer:"madrid", ts: Date.now()-DAY*209 },
  { id:"g22",  author:"Trivia Bot", subject:"Geography", question:"What country has the largest population in the world?", answer:"india", ts: Date.now()-DAY*208 },
  { id:"g23",  author:"Trivia Bot", subject:"Geography", question:"What is the capital of Egypt?", answer:"cairo", ts: Date.now()-DAY*207 },
  { id:"g24",  author:"Trivia Bot", subject:"Geography", question:"What is the smallest continent?", answer:"australia", ts: Date.now()-DAY*206 },
  { id:"g25",  author:"Trivia Bot", subject:"Geography", question:"What US state is known as the Sunshine State?", answer:"florida", ts: Date.now()-DAY*205 },
  { id:"g26",  author:"Trivia Bot", subject:"Geography", question:"What is the capital of Argentina?", answer:"buenos aires", ts: Date.now()-DAY*204 },
  { id:"g27",  author:"Trivia Bot", subject:"Geography", question:"What mountain range separates Europe from Asia in Russia?", answer:"ural mountains", ts: Date.now()-DAY*203 },
  { id:"g28",  author:"Trivia Bot", subject:"Geography", question:"What is the capital of Mexico?", answer:"mexico city", ts: Date.now()-DAY*202 },
  { id:"g29",  author:"Trivia Bot", subject:"Geography", question:"What is the largest lake in North America?", answer:"lake superior", ts: Date.now()-DAY*201 },
  { id:"g30",  author:"Trivia Bot", subject:"Geography", question:"What country contains the Amazon rainforest's largest portion?", answer:"brazil", ts: Date.now()-DAY*200 },

  // ── Pop Culture & Entertainment (30) ─────────────────────────────────────
  { id:"p01",  author:"Trivia Bot", subject:"Pop Culture", question:"How many books are in the Harry Potter series?", answer:"7", ts: Date.now()-DAY*199 },
  { id:"p02",  author:"Trivia Bot", subject:"Pop Culture", question:"What band was Freddie Mercury the lead singer of?", answer:"queen", ts: Date.now()-DAY*198 },
  { id:"p03",  author:"Trivia Bot", subject:"Pop Culture", question:"What year was the first iPhone released?", answer:"2007", ts: Date.now()-DAY*197 },
  { id:"p04",  author:"Trivia Bot", subject:"Pop Culture", question:"Who played Iron Man in the Marvel Cinematic Universe?", answer:"robert downey jr", crewNote:"Full name required, matey!", ts: Date.now()-DAY*196 },
  { id:"p05",  author:"Trivia Bot", subject:"Pop Culture", question:"What TV show features the fictional Dunder Mifflin Paper Company?", answer:"the office", ts: Date.now()-DAY*195 },
  { id:"p06",  author:"Trivia Bot", subject:"Pop Culture", question:"How many seasons of Game of Thrones are there?", answer:"8", ts: Date.now()-DAY*194 },
  { id:"p07",  author:"Trivia Bot", subject:"Pop Culture", question:"Who recorded the 1982 album Thriller?", answer:"michael jackson", ts: Date.now()-DAY*193 },
  { id:"p08",  author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of Batman's butler?", answer:"alfred", ts: Date.now()-DAY*192 },
  { id:"p09",  author:"Trivia Bot", subject:"Pop Culture", question:"In what year was the first Star Wars film released?", answer:"1977", ts: Date.now()-DAY*191 },
  { id:"p10",  author:"Trivia Bot", subject:"Pop Culture", question:"What streaming service produced Stranger Things?", answer:"netflix", ts: Date.now()-DAY*190 },
  { id:"p11",  author:"Trivia Bot", subject:"Pop Culture", question:"Who voiced Woody in the Toy Story films?", answer:"tom hanks", crewNote:"Full name required, matey!", ts: Date.now()-DAY*189 },
  { id:"p12",  author:"Trivia Bot", subject:"Pop Culture", question:"What is the best-selling video game of all time?", answer:"minecraft", ts: Date.now()-DAY*188 },
  { id:"p13",  author:"Trivia Bot", subject:"Pop Culture", question:"Who wrote and directed the 1994 film Pulp Fiction?", answer:"quentin tarantino", crewNote:"Full name required, matey!", ts: Date.now()-DAY*187 },
  { id:"p14",  author:"Trivia Bot", subject:"Pop Culture", question:"Who played Jack Dawson in the 1997 film Titanic?", answer:"leonardo dicaprio", crewNote:"Full name required, matey!", ts: Date.now()-DAY*186 },
  { id:"p15",  author:"Trivia Bot", subject:"Pop Culture", question:"What fictional New Mexico chemistry teacher becomes a drug lord in Breaking Bad?", answer:"walter white", ts: Date.now()-DAY*185 },
  { id:"p16",  author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of the lion in The Lion the Witch and the Wardrobe?", answer:"aslan", ts: Date.now()-DAY*184 },
  { id:"p17",  author:"Trivia Bot", subject:"Pop Culture", question:"Who sang the national anthem at the 1991 Super Bowl in a famous performance?", answer:"whitney houston", crewNote:"Full name required, matey!", ts: Date.now()-DAY*183 },
  { id:"p18",  author:"Trivia Bot", subject:"Pop Culture", question:"What movie features the quote: You cannot handle the truth?", answer:"a few good men", ts: Date.now()-DAY*182 },
  { id:"p20",  author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of the fictional African country in the Marvel film Black Panther?", answer:"wakanda", ts: Date.now()-DAY*180 },
  { id:"p21",  author:"Trivia Bot", subject:"Pop Culture", question:"Who played Forrest Gump in the 1994 film?", answer:"tom hanks", crewNote:"Full name required, matey!", ts: Date.now()-DAY*179 },
  { id:"p22",  author:"Trivia Bot", subject:"Pop Culture", question:"What sitcom takes place at a bar in Boston where everybody knows your name?", answer:"cheers", ts: Date.now()-DAY*178 },
  { id:"p23",  author:"Trivia Bot", subject:"Pop Culture", question:"What 1980 horror film features Jack Nicholson saying Here's Johnny?", answer:"the shining", ts: Date.now()-DAY*177 },
  { id:"p25",  author:"Trivia Bot", subject:"Pop Culture", question:"What animated film features the song Let It Go?", answer:"frozen", ts: Date.now()-DAY*175 },
  { id:"p26",  author:"Trivia Bot", subject:"Pop Culture", question:"What is the highest-grossing film of all time not adjusted for inflation as of 2024?", answer:"avatar", ts: Date.now()-DAY*174 },
  { id:"p27",  author:"Trivia Bot", subject:"Pop Culture", question:"What band wrote and recorded the song Bohemian Rhapsody in 1975?", answer:"queen", ts: Date.now()-DAY*173 },
  { id:"p28",  author:"Trivia Bot", subject:"Pop Culture", question:"What TV show features the character Tony Soprano?", answer:"the sopranos", ts: Date.now()-DAY*172 },
  { id:"p29",  author:"Trivia Bot", subject:"Pop Culture", question:"What 1993 film features Bill Murray reliving the same day over and over?", answer:"groundhog day", ts: Date.now()-DAY*171 },
  { id:"p30",  author:"Trivia Bot", subject:"Pop Culture", question:"Who played the Joker in the 2008 film The Dark Knight?", answer:"heath ledger", crewNote:"Full name required, matey!", ts: Date.now()-DAY*170 },

  // ── Sports (25) ──────────────────────────────────────────────────────────
  { id:"sp01", author:"Trivia Bot", subject:"Sports", question:"How many players from one team are on a basketball court at a time?", answer:"5", ts: Date.now()-DAY*169 },
  { id:"sp02", author:"Trivia Bot", subject:"Sports", question:"How many players from one team are on a soccer field at a time?", answer:"11", ts: Date.now()-DAY*168 },
  { id:"sp03", author:"Trivia Bot", subject:"Sports", question:"How many holes are played in a standard round of golf?", answer:"18", ts: Date.now()-DAY*167 },
  { id:"sp04", author:"Trivia Bot", subject:"Sports", question:"What sport is played at Wimbledon?", answer:"tennis", ts: Date.now()-DAY*166 },
  { id:"sp05", author:"Trivia Bot", subject:"Sports", question:"How many points is a touchdown worth in American football?", answer:"6", ts: Date.now()-DAY*165 },
  { id:"sp06", author:"Trivia Bot", subject:"Sports", question:"In what country did the ancient Olympic Games originate?", answer:"greece", ts: Date.now()-DAY*164 },
  { id:"sp07", author:"Trivia Bot", subject:"Sports", question:"How many Grand Slam tennis tournaments are held per year?", answer:"4", ts: Date.now()-DAY*163 },
  { id:"sp08", author:"Trivia Bot", subject:"Sports", question:"What country has won the most FIFA World Cup titles?", answer:"brazil", ts: Date.now()-DAY*162 },
  { id:"sp09", author:"Trivia Bot", subject:"Sports", question:"How many innings are in a standard baseball game?", answer:"9", ts: Date.now()-DAY*161 },
  { id:"sp10", author:"Trivia Bot", subject:"Sports", question:"What sport uses terms like birdie eagle and bogey?", answer:"golf", ts: Date.now()-DAY*160 },
  { id:"sp11", author:"Trivia Bot", subject:"Sports", question:"How many players are on a volleyball team on the court?", answer:"6", ts: Date.now()-DAY*159 },
  { id:"sp12", author:"Trivia Bot", subject:"Sports", question:"What is the diameter of a basketball hoop in inches?", answer:"18", ts: Date.now()-DAY*158 },
  { id:"sp13", author:"Trivia Bot", subject:"Sports", question:"What country hosted the 2016 Summer Olympics?", answer:"brazil", ts: Date.now()-DAY*157 },
  { id:"sp14", author:"Trivia Bot", subject:"Sports", question:"How many points is a field goal worth in American football?", answer:"3", ts: Date.now()-DAY*156 },
  { id:"sp16", author:"Trivia Bot", subject:"Sports", question:"In what city are the headquarters of the International Olympic Committee?", answer:"lausanne", ts: Date.now()-DAY*154 },
  { id:"sp17", author:"Trivia Bot", subject:"Sports", question:"How long is a standard marathon in miles?", answer:"26.2", ts: Date.now()-DAY*153 },
  { id:"sp19", author:"Trivia Bot", subject:"Sports", question:"How many players are on a baseball team on the field?", answer:"9", ts: Date.now()-DAY*151 },
  { id:"sp20", author:"Trivia Bot", subject:"Sports", question:"What country has won the most Olympic gold medals in history?", answer:"united states", ts: Date.now()-DAY*150 },
  { id:"sp23", author:"Trivia Bot", subject:"Sports", question:"What boxer was known as The Greatest and was Olympic gold medalist in 1960?", answer:"muhammad ali", crewNote:"Full name required, matey!", ts: Date.now()-DAY*147 },
  { id:"sp24", author:"Trivia Bot", subject:"Sports", question:"What is the distance of a standard Olympic swimming pool in meters?", answer:"50", ts: Date.now()-DAY*146 },
  { id:"sp25", author:"Trivia Bot", subject:"Sports", question:"What country invented the sport of ice hockey?", answer:"canada", ts: Date.now()-DAY*145 },

  // ── Literature (20) ──────────────────────────────────────────────────────
  { id:"l01",  author:"Trivia Bot", subject:"Literature", question:"Who wrote Romeo and Juliet?", answer:"william shakespeare", crewNote:"Full name required, matey!", ts: Date.now()-DAY*144 },
  { id:"l02",  author:"Trivia Bot", subject:"Literature", question:"Who wrote The Great Gatsby?", answer:"f scott fitzgerald", crewNote:"Full name required, matey!", ts: Date.now()-DAY*143 },
  { id:"l03",  author:"Trivia Bot", subject:"Literature", question:"What is the first book of the Bible?", answer:"genesis", ts: Date.now()-DAY*142 },
  { id:"l04",  author:"Trivia Bot", subject:"Literature", question:"Who wrote the dystopian novel 1984?", answer:"george orwell", crewNote:"Full name required, matey!", ts: Date.now()-DAY*141 },
  { id:"l05",  author:"Trivia Bot", subject:"Literature", question:"What fictional detective was created by Arthur Conan Doyle?", answer:"sherlock holmes", ts: Date.now()-DAY*140 },
  { id:"l06",  author:"Trivia Bot", subject:"Literature", question:"Who wrote Pride and Prejudice?", answer:"jane austen", crewNote:"Full name required, matey!", ts: Date.now()-DAY*139 },
  { id:"l07",  author:"Trivia Bot", subject:"Literature", question:"Who wrote the epic poems the Iliad and the Odyssey?", answer:"homer", ts: Date.now()-DAY*138 },
  { id:"l08",  author:"Trivia Bot", subject:"Literature", question:"What is the name of the hobbit hero in The Hobbit by J.R.R. Tolkien?", answer:"bilbo baggins", ts: Date.now()-DAY*137 },
  { id:"l09",  author:"Trivia Bot", subject:"Literature", question:"Who wrote the play Death of a Salesman?", answer:"arthur miller", crewNote:"Full name required, matey!", ts: Date.now()-DAY*136 },
  { id:"l10",  author:"Trivia Bot", subject:"Literature", question:"What classic novel begins with the line: It was the best of times it was the worst of times?", answer:"a tale of two cities", ts: Date.now()-DAY*135 },
  { id:"l11",  author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel To Kill a Mockingbird?", answer:"harper lee", crewNote:"Full name required, matey!", ts: Date.now()-DAY*134 },
  { id:"l12",  author:"Trivia Bot", subject:"Literature", question:"What novel by Mary Shelley features a creature created by a scientist?", answer:"frankenstein", ts: Date.now()-DAY*133 },
  { id:"l13",  author:"Trivia Bot", subject:"Literature", question:"Who wrote the Canterbury Tales?", answer:"geoffrey chaucer", crewNote:"Full name required, matey!", ts: Date.now()-DAY*132 },
  { id:"l15",  author:"Trivia Bot", subject:"Literature", question:"Who wrote Don Quixote considered the first modern novel?", answer:"miguel de cervantes", crewNote:"Full name required, matey!", ts: Date.now()-DAY*130 },
  { id:"l16",  author:"Trivia Bot", subject:"Literature", question:"What is the name of the school Harry Potter attends?", answer:"hogwarts", ts: Date.now()-DAY*129 },
  { id:"l17",  author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel Crime and Punishment?", answer:"fyodor dostoevsky", crewNote:"Full name required, matey!", ts: Date.now()-DAY*128 },
  { id:"l18",  author:"Trivia Bot", subject:"Literature", question:"What Shakespeare play features the character Hamlet?", answer:"hamlet", ts: Date.now()-DAY*127 },
  { id:"l19",  author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel The Catcher in the Rye?", answer:"j d salinger", crewNote:"Full name required, matey!", ts: Date.now()-DAY*126 },
  { id:"l20",  author:"Trivia Bot", subject:"Literature", question:"What is the pen name of author Samuel Clemens?", answer:"mark twain", crewNote:"Pen name required, ye landlubber!", ts: Date.now()-DAY*125 },

  // ── Math & Numbers (15) ──────────────────────────────────────────────────
  { id:"m01",  author:"Trivia Bot", subject:"Math", question:"What is the square root of 144?", answer:"12", ts: Date.now()-DAY*124 },
  { id:"m02",  author:"Trivia Bot", subject:"Math", question:"How many sides does a hexagon have?", answer:"6", ts: Date.now()-DAY*123 },
  { id:"m03",  author:"Trivia Bot", subject:"Math", question:"What is the value of Pi rounded to two decimal places?", answer:"3.14", ts: Date.now()-DAY*122 },
  { id:"m04",  author:"Trivia Bot", subject:"Math", question:"What is the only even prime number?", answer:"2", ts: Date.now()-DAY*121 },
  { id:"m05",  author:"Trivia Bot", subject:"Math", question:"How many degrees are in a right angle?", answer:"90", ts: Date.now()-DAY*120 },
  { id:"m06",  author:"Trivia Bot", subject:"Math", question:"What is 12 multiplied by 12?", answer:"144", ts: Date.now()-DAY*119 },
  { id:"m07",  author:"Trivia Bot", subject:"Math", question:"How many sides does an octagon have?", answer:"8", ts: Date.now()-DAY*118 },
  { id:"m08",  author:"Trivia Bot", subject:"Math", question:"What is 15 percent of 200?", answer:"30", ts: Date.now()-DAY*117 },
  { id:"m09",  author:"Trivia Bot", subject:"Math", question:"What is the square root of 256?", answer:"16", ts: Date.now()-DAY*116 },
  { id:"m10",  author:"Trivia Bot", subject:"Math", question:"How many degrees are in a triangle?", answer:"180", ts: Date.now()-DAY*115 },
  { id:"m11",  author:"Trivia Bot", subject:"Math", question:"What is the Roman numeral for 50?", answer:"l", ts: Date.now()-DAY*114 },
  { id:"m12",  author:"Trivia Bot", subject:"Math", question:"How many zeros are in one billion?", answer:"9", ts: Date.now()-DAY*113 },
  { id:"m13",  author:"Trivia Bot", subject:"Math", question:"What is 7 multiplied by 8?", answer:"56", ts: Date.now()-DAY*112 },
  { id:"m15",  author:"Trivia Bot", subject:"Math", question:"What is the perimeter of a square with sides of 5 units?", answer:"20", ts: Date.now()-DAY*110 },

  // ── Food & Drink (15) ────────────────────────────────────────────────────
  { id:"f01",  author:"Trivia Bot", subject:"Food & Drink", question:"What is the main ingredient in guacamole?", answer:"avocado", ts: Date.now()-DAY*109 },
  { id:"f02",  author:"Trivia Bot", subject:"Food & Drink", question:"What country does sushi originally come from?", answer:"japan", ts: Date.now()-DAY*108 },
  { id:"f03",  author:"Trivia Bot", subject:"Food & Drink", question:"What is the world's most consumed beverage after water?", answer:"tea", ts: Date.now()-DAY*107 },
  { id:"f04",  author:"Trivia Bot", subject:"Food & Drink", question:"What nut is used to make marzipan?", answer:"almond", ts: Date.now()-DAY*106 },
  { id:"f06",  author:"Trivia Bot", subject:"Food & Drink", question:"What is the most expensive spice in the world by weight?", answer:"saffron", ts: Date.now()-DAY*104 },
  { id:"f07",  author:"Trivia Bot", subject:"Food & Drink", question:"What country produces the most coffee in the world?", answer:"brazil", ts: Date.now()-DAY*103 },
  { id:"f08",  author:"Trivia Bot", subject:"Food & Drink", question:"What is the main ingredient in hummus?", answer:"chickpeas", ts: Date.now()-DAY*102 },
  { id:"f09",  author:"Trivia Bot", subject:"Food & Drink", question:"What type of pastry is used in a traditional beef Wellington?", answer:"puff pastry", ts: Date.now()-DAY*101 },
  { id:"f10",  author:"Trivia Bot", subject:"Food & Drink", question:"What country is the origin of Gouda cheese?", answer:"netherlands", ts: Date.now()-DAY*100 },
  { id:"f11",  author:"Trivia Bot", subject:"Food & Drink", question:"What is the Italian term for the first course of a meal?", answer:"antipasto", ts: Date.now()-DAY*99 },
  { id:"f12",  author:"Trivia Bot", subject:"Food & Drink", question:"What fruit is used to make wine?", answer:"grapes", ts: Date.now()-DAY*98 },
  { id:"f14",  author:"Trivia Bot", subject:"Food & Drink", question:"What cocktail is made from vodka tomato juice and spices?", answer:"bloody mary", ts: Date.now()-DAY*96 },
  { id:"f15",  author:"Trivia Bot", subject:"Food & Drink", question:"What nut gives Nutella its distinctive flavor alongside chocolate?", answer:"hazelnut", ts: Date.now()-DAY*95 },

  // ── Music (20) ───────────────────────────────────────────────────────────
  { id:"mu01", author:"Trivia Bot", subject:"Music", question:"How many strings does a standard guitar have?", answer:"6", ts: Date.now()-DAY*94 },
  { id:"mu02", author:"Trivia Bot", subject:"Music", question:"What is the lowest male singing voice called?", answer:"bass", ts: Date.now()-DAY*93 },
  { id:"mu03", author:"Trivia Bot", subject:"Music", question:"Who composed the Four Seasons?", answer:"vivaldi", ts: Date.now()-DAY*92 },
  { id:"mu04", author:"Trivia Bot", subject:"Music", question:"What band included John Lennon Paul McCartney George Harrison and Ringo Starr?", answer:"the beatles", ts: Date.now()-DAY*91 },
  { id:"mu05", author:"Trivia Bot", subject:"Music", question:"What is the term for the speed of a musical piece?", answer:"tempo", ts: Date.now()-DAY*90 },
  { id:"mu06", author:"Trivia Bot", subject:"Music", question:"Who is known as the King of Rock and Roll?", answer:"elvis presley", crewNote:"Full name required, matey!", ts: Date.now()-DAY*89 },
  { id:"mu07", author:"Trivia Bot", subject:"Music", question:"How many keys are on a standard piano?", answer:"88", ts: Date.now()-DAY*88 },
  { id:"mu08", author:"Trivia Bot", subject:"Music", question:"What Mozart opera features the Queen of the Night aria?", answer:"the magic flute", ts: Date.now()-DAY*87 },
  { id:"mu09", author:"Trivia Bot", subject:"Music", question:"Who wrote the Ninth Symphony also known as the Choral Symphony?", answer:"beethoven", ts: Date.now()-DAY*86 },
  { id:"mu10", author:"Trivia Bot", subject:"Music", question:"What decade did hip-hop music originate?", answer:"1970s", ts: Date.now()-DAY*85 },
  { id:"mu12", author:"Trivia Bot", subject:"Music", question:"What singer is known as the Queen of Soul?", answer:"aretha franklin", crewNote:"Full name required, matey!", ts: Date.now()-DAY*83 },
  { id:"mu13", author:"Trivia Bot", subject:"Music", question:"What instrument did Miles Davis famously play?", answer:"trumpet", ts: Date.now()-DAY*82 },
  { id:"mu14", author:"Trivia Bot", subject:"Music", question:"What is the name of the song that begins with the lyrics Imagine there is no heaven?", answer:"imagine", ts: Date.now()-DAY*81 },
  { id:"mu16", author:"Trivia Bot", subject:"Music", question:"What musical term means to gradually get louder?", answer:"crescendo", ts: Date.now()-DAY*79 },
  { id:"mu18", author:"Trivia Bot", subject:"Music", question:"What country does the musical style of Bossa Nova come from?", answer:"brazil", ts: Date.now()-DAY*77 },
  { id:"mu19", author:"Trivia Bot", subject:"Music", question:"What instrument is Yo-Yo Ma famous for playing?", answer:"cello", ts: Date.now()-DAY*76 },
  { id:"mu20", author:"Trivia Bot", subject:"Music", question:"What band is Mick Jagger the lead singer of?", answer:"the rolling stones", ts: Date.now()-DAY*75 },

  // ── Art & Architecture (10) ───────────────────────────────────────────────
  { id:"a01",  author:"Trivia Bot", subject:"Art", question:"Who painted the Mona Lisa?", answer:"leonardo da vinci", ts: Date.now()-DAY*74 },
  { id:"a02",  author:"Trivia Bot", subject:"Art", question:"What Dutch painter cut off his own ear?", answer:"vincent van gogh", ts: Date.now()-DAY*73 },
  { id:"a03",  author:"Trivia Bot", subject:"Art", question:"What building in Paris is a famous art museum and former royal palace?", answer:"louvre", ts: Date.now()-DAY*72 },
  { id:"a04",  author:"Trivia Bot", subject:"Art", question:"Who painted the Sistine Chapel ceiling?", answer:"michelangelo", ts: Date.now()-DAY*71 },
  { id:"a05",  author:"Trivia Bot", subject:"Art", question:"What architectural style features pointed arches ribbed vaults and flying buttresses?", answer:"gothic", ts: Date.now()-DAY*70 },
  { id:"a06",  author:"Trivia Bot", subject:"Art", question:"What Spanish artist co-founded Cubism?", answer:"pablo picasso", ts: Date.now()-DAY*69 },
  { id:"a07",  author:"Trivia Bot", subject:"Art", question:"What is the name of the famous statue of a woman with no arms by the ancient Greeks?", answer:"venus de milo", ts: Date.now()-DAY*68 },
  { id:"a08",  author:"Trivia Bot", subject:"Art", question:"What American artist is famous for his paintings of soup cans?", answer:"andy warhol", ts: Date.now()-DAY*67 },
  { id:"a09",  author:"Trivia Bot", subject:"Art", question:"What country is the artist Frida Kahlo from?", answer:"mexico", ts: Date.now()-DAY*66 },

  // ── Technology (10) ──────────────────────────────────────────────────────
  { id:"t01",  author:"Trivia Bot", subject:"Technology", question:"What does CPU stand for?", answer:"central processing unit", ts: Date.now()-DAY*64 },
  { id:"t02",  author:"Trivia Bot", subject:"Technology", question:"What company created the Android operating system?", answer:"google", ts: Date.now()-DAY*63 },
  { id:"t03",  author:"Trivia Bot", subject:"Technology", question:"What does HTML stand for?", answer:"hypertext markup language", ts: Date.now()-DAY*62 },
  { id:"t04",  author:"Trivia Bot", subject:"Technology", question:"Who co-founded Apple with Steve Jobs?", answer:"steve wozniak", crewNote:"Full name required, matey!", ts: Date.now()-DAY*61 },
  { id:"t06",  author:"Trivia Bot", subject:"Technology", question:"What does GPS stand for?", answer:"global positioning system", ts: Date.now()-DAY*59 },
  { id:"t07",  author:"Trivia Bot", subject:"Technology", question:"Who co-founded Microsoft with Paul Allen in 1975?", answer:"bill gates", crewNote:"Full name required, matey!", ts: Date.now()-DAY*58 },
  { id:"t08",  author:"Trivia Bot", subject:"Technology", question:"What company owns Instagram?", answer:"meta", ts: Date.now()-DAY*57 },
  { id:"t09",  author:"Trivia Bot", subject:"Technology", question:"What does URL stand for?", answer:"uniform resource locator", ts: Date.now()-DAY*56 },
  { id:"t10",  author:"Trivia Bot", subject:"Technology", question:"What programming language is named after a type of snake?", answer:"python", ts: Date.now()-DAY*55 },

  // ── Finance & Stock Market (20) ──────────────────────────────────────────
  { id:"fi01", author:"Trivia Bot", subject:"Finance", question:"What does IPO stand for?", answer:"initial public offering", ts: Date.now()-DAY*54 },
  { id:"fi02", author:"Trivia Bot", subject:"Finance", question:"What US stock exchange is home to the most technology companies?", answer:"nasdaq", ts: Date.now()-DAY*53 },
  { id:"fi04", author:"Trivia Bot", subject:"Finance", question:"What is the term for a market where stock prices are rising?", answer:"bull market", ts: Date.now()-DAY*51 },
  { id:"fi05", author:"Trivia Bot", subject:"Finance", question:"What is the term for a market where stock prices are falling?", answer:"bear market", ts: Date.now()-DAY*50 },
  { id:"fi06", author:"Trivia Bot", subject:"Finance", question:"What does ETF stand for?", answer:"exchange traded fund", ts: Date.now()-DAY*49 },
  { id:"fi07", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Apple?", answer:"aapl", crewNote:"Stock ticker symbol — all caps, matey!", ts: Date.now()-DAY*48 },
  { id:"fi08", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Tesla?", answer:"tsla", crewNote:"Stock ticker symbol — all caps, matey!", ts: Date.now()-DAY*47 },
  { id:"fi09", author:"Trivia Bot", subject:"Finance", question:"What term describes a stock that pays regular cash distributions to shareholders?", answer:"dividend", ts: Date.now()-DAY*46 },
  { id:"fi11", author:"Trivia Bot", subject:"Finance", question:"What does P/E ratio stand for in stock analysis?", answer:"price to earnings ratio", ts: Date.now()-DAY*44 },
  { id:"fi12", author:"Trivia Bot", subject:"Finance", question:"What famous investor is known as the Oracle of Omaha?", answer:"warren buffett", ts: Date.now()-DAY*43 },
  { id:"fi13", author:"Trivia Bot", subject:"Finance", question:"What is the term for spreading investments across different assets to reduce risk?", answer:"diversification", ts: Date.now()-DAY*42 },
  { id:"fi14", author:"Trivia Bot", subject:"Finance", question:"What does FDIC stand for?", answer:"federal deposit insurance corporation", ts: Date.now()-DAY*41 },
  { id:"fi15", author:"Trivia Bot", subject:"Finance", question:"What is the central bank of the United States called?", answer:"federal reserve", ts: Date.now()-DAY*40 },
  { id:"fi17", author:"Trivia Bot", subject:"Finance", question:"What does ROI stand for?", answer:"return on investment", ts: Date.now()-DAY*38 },
  { id:"fi18", author:"Trivia Bot", subject:"Finance", question:"What is the name of the index that tracks 30 large American publicly traded companies?", answer:"dow jones industrial average", ts: Date.now()-DAY*37 },

  // ── Additional Science (10) ───────────────────────────────────────────────
  { id:"s36", author:"Trivia Bot", subject:"Science", question:"What is the name of the process by which plants make food using sunlight?", answer:"photosynthesis", ts: Date.now()-DAY*34 },
  { id:"s37", author:"Trivia Bot", subject:"Science", question:"What planet is closest in size to Earth?", answer:"venus", ts: Date.now()-DAY*33 },
  { id:"s38", author:"Trivia Bot", subject:"Science", question:"What is the scientific name for the study of the universe?", answer:"cosmology", ts: Date.now()-DAY*32 },
  { id:"s39", author:"Trivia Bot", subject:"Science", question:"What is the most abundant element in the universe?", answer:"hydrogen", ts: Date.now()-DAY*31 },
  { id:"s40", author:"Trivia Bot", subject:"Science", question:"What is the term for an animal that eats only plants?", answer:"herbivore", ts: Date.now()-DAY*30 },
  { id:"s41", author:"Trivia Bot", subject:"Science", question:"What bone protects the human brain?", answer:"skull", ts: Date.now()-DAY*29 },
  { id:"s42", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for silver?", answer:"ag", crewNote:"Chemical symbol required — two letters, matey!", ts: Date.now()-DAY*28 },
  { id:"s43", author:"Trivia Bot", subject:"Science", question:"How many pairs of chromosomes do humans have?", answer:"23", ts: Date.now()-DAY*27 },
  { id:"s44", author:"Trivia Bot", subject:"Science", question:"What is the name of the galaxy that contains our solar system?", answer:"milky way", ts: Date.now()-DAY*26 },
  { id:"s45", author:"Trivia Bot", subject:"Science", question:"What vitamin does the human body produce when exposed to sunlight?", answer:"vitamin d", ts: Date.now()-DAY*25 },

  // ── Additional History (10) ───────────────────────────────────────────────
  { id:"h36", author:"Trivia Bot", subject:"History", question:"What was the name of the first permanent English settlement in America founded in 1607?", answer:"jamestown", ts: Date.now()-DAY*24 },
  { id:"h37", author:"Trivia Bot", subject:"History", question:"Who was the first woman to win a Nobel Prize winning it in both Physics and Chemistry?", answer:"marie curie", crewNote:"Full name required, matey!", ts: Date.now()-DAY*23 },
  { id:"h38", author:"Trivia Bot", subject:"History", question:"What year did the Korean War begin?", answer:"1950", ts: Date.now()-DAY*22 },
  { id:"h39", author:"Trivia Bot", subject:"History", question:"What was the name of the plan that provided US aid to rebuild Western Europe after World War II?", answer:"marshall plan", ts: Date.now()-DAY*21 },
  { id:"h40", author:"Trivia Bot", subject:"History", question:"What country was formerly known as Persia?", answer:"iran", ts: Date.now()-DAY*20 },
  { id:"h41", author:"Trivia Bot", subject:"History", question:"Who was the last Tsar of Russia?", answer:"nicholas ii", crewNote:"Include the numeral, matey!", ts: Date.now()-DAY*19 },
  { id:"h43", author:"Trivia Bot", subject:"History", question:"Who was the first woman to serve as US Secretary of State?", answer:"madeleine albright", crewNote:"Full name required, matey!", ts: Date.now()-DAY*17 },
  { id:"h44", author:"Trivia Bot", subject:"History", question:"What treaty ended World War I?", answer:"treaty of versailles", ts: Date.now()-DAY*16 },
  { id:"h45", author:"Trivia Bot", subject:"History", question:"What ancient civilization built the Parthenon?", answer:"greeks", ts: Date.now()-DAY*15 },

  // ── Additional Geography (10) ─────────────────────────────────────────────
  { id:"g31", author:"Trivia Bot", subject:"Geography", question:"What is the capital of South Korea?", answer:"seoul", ts: Date.now()-DAY*14 },
  { id:"g32", author:"Trivia Bot", subject:"Geography", question:"What is the capital of India?", answer:"new delhi", ts: Date.now()-DAY*13 },
  { id:"g33", author:"Trivia Bot", subject:"Geography", question:"What is the longest river in the United States?", answer:"missouri river", ts: Date.now()-DAY*12 },
  { id:"g34", author:"Trivia Bot", subject:"Geography", question:"What African country has the largest population?", answer:"nigeria", ts: Date.now()-DAY*11 },
  { id:"g35", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Australia's most populous state New South Wales?", answer:"sydney", ts: Date.now()-DAY*10 },
  { id:"g36", author:"Trivia Bot", subject:"Geography", question:"What two countries share the island of Hispaniola?", answer:"haiti and dominican republic", crewNote:"Both country names required, matey!", ts: Date.now()-DAY*9 },
  { id:"g37", author:"Trivia Bot", subject:"Geography", question:"What is the name of the sea between Australia and New Zealand?", answer:"tasman sea", ts: Date.now()-DAY*8 },
  { id:"g38", author:"Trivia Bot", subject:"Geography", question:"What is the capital of the Netherlands?", answer:"amsterdam", ts: Date.now()-DAY*7 },
  { id:"g39", author:"Trivia Bot", subject:"Geography", question:"What is the largest island in the world?", answer:"greenland", ts: Date.now()-DAY*6 },
  { id:"g40", author:"Trivia Bot", subject:"Geography", question:"What US state has the most coastline?", answer:"alaska", ts: Date.now()-DAY*5 },

  // ── Additional Pop Culture (10) ───────────────────────────────────────────
  { id:"p31", author:"Trivia Bot", subject:"Pop Culture", question:"What TV show features the characters Ross Rachel Monica Chandler Joey and Phoebe?", answer:"friends", ts: Date.now()-DAY*4 },
  { id:"p32", author:"Trivia Bot", subject:"Pop Culture", question:"What film won the first Academy Award for Best Picture in 1928?", answer:"wings", ts: Date.now()-DAY*3 },
  { id:"p33", author:"Trivia Bot", subject:"Pop Culture", question:"Who played Katniss Everdeen in The Hunger Games films?", answer:"jennifer lawrence", crewNote:"Full name required, matey!", ts: Date.now()-DAY*2 },
  { id:"p34", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of the fictional kingdom in the Disney film Frozen?", answer:"arendelle", ts: Date.now()-DAY*1 },
  { id:"p35", author:"Trivia Bot", subject:"Pop Culture", question:"Who directed the 1993 film Schindler's List?", answer:"steven spielberg", crewNote:"Full name required, matey!", ts: Date.now()-3600000*10 },
  { id:"p36", author:"Trivia Bot", subject:"Pop Culture", question:"What is the best-selling book series of all time?", answer:"harry potter", ts: Date.now()-3600000*9 },
  { id:"p37", author:"Trivia Bot", subject:"Pop Culture", question:"Who played the character of Don Vito Corleone in The Godfather?", answer:"marlon brando", crewNote:"Full name required, matey!", ts: Date.now()-3600000*8 },
  { id:"p38", author:"Trivia Bot", subject:"Pop Culture", question:"What 1994 Disney film features the song Circle of Life?", answer:"the lion king", ts: Date.now()-3600000*7 },
  { id:"p39", author:"Trivia Bot", subject:"Pop Culture", question:"What singer is known as the Queen of Pop?", answer:"madonna", ts: Date.now()-3600000*6 },

  // ── Additional Music (10) ─────────────────────────────────────────────────
  { id:"mu21", author:"Trivia Bot", subject:"Music", question:"What American singer is known as the Boss?", answer:"bruce springsteen", crewNote:"Full name required, matey!", ts: Date.now()-3600000*4 },
  { id:"mu22", author:"Trivia Bot", subject:"Music", question:"What is the name of the lead singer of U2?", answer:"bono", ts: Date.now()-3600000*3 },
  { id:"mu23", author:"Trivia Bot", subject:"Music", question:"How many musicians are in a quartet?", answer:"4", ts: Date.now()-3600000*2 },
  { id:"mu24", author:"Trivia Bot", subject:"Music", question:"What city is considered the birthplace of jazz?", answer:"new orleans", ts: Date.now()-3600000 },
  { id:"mu25", author:"Trivia Bot", subject:"Music", question:"What is the name of Taylor Swift's debut album released in 2006?", answer:"taylor swift", ts: Date.now()-1800000 },
  { id:"mu27", author:"Trivia Bot", subject:"Music", question:"What is the term for the highness or lowness of a musical sound?", answer:"pitch", ts: Date.now()-1600000 },
  { id:"mu28", author:"Trivia Bot", subject:"Music", question:"What band recorded the album Dark Side of the Moon in 1973?", answer:"pink floyd", ts: Date.now()-1500000 },
  { id:"mu30", author:"Trivia Bot", subject:"Music", question:"Who wrote the opera La Traviata?", answer:"giuseppe verdi", crewNote:"Full name required, matey!", ts: Date.now()-1300000 },

  // ── Additional Technology (10) ────────────────────────────────────────────
  { id:"t11", author:"Trivia Bot", subject:"Technology", question:"What does AI stand for?", answer:"artificial intelligence", ts: Date.now()-1200000 },
  { id:"t14", author:"Trivia Bot", subject:"Technology", question:"What programming language is most commonly used for web styling?", answer:"css", ts: Date.now()-900000 },
  { id:"t15", author:"Trivia Bot", subject:"Technology", question:"What is the name of the world's most visited website?", answer:"google", ts: Date.now()-800000 },
  { id:"t16", author:"Trivia Bot", subject:"Technology", question:"What does USB stand for?", answer:"universal serial bus", ts: Date.now()-700000 },
  { id:"t17", author:"Trivia Bot", subject:"Technology", question:"What company makes the Galaxy smartphone?", answer:"samsung", ts: Date.now()-600000 },
  { id:"t18", author:"Trivia Bot", subject:"Technology", question:"What is the name of Amazon's voice assistant?", answer:"alexa", ts: Date.now()-500000 },
  { id:"t19", author:"Trivia Bot", subject:"Technology", question:"What does RAM stand for in computing?", answer:"random access memory", ts: Date.now()-400000 },
  { id:"t20", author:"Trivia Bot", subject:"Technology", question:"What social media platform is known for short video content and was originally called Musical.ly?", answer:"tiktok", ts: Date.now()-300000 },

  // ── Additional Literature (10) ────────────────────────────────────────────
  { id:"l21", author:"Trivia Bot", subject:"Literature", question:"What is the name of the whale hunter in Moby Dick?", answer:"captain ahab", ts: Date.now()-290000 },
  { id:"l22", author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel Brave New World?", answer:"aldous huxley", crewNote:"Full name required, matey!", ts: Date.now()-280000 },
  { id:"l23", author:"Trivia Bot", subject:"Literature", question:"What novel by John Steinbeck follows the Joad family during the Great Depression?", answer:"the grapes of wrath", ts: Date.now()-270000 },
  { id:"l24", author:"Trivia Bot", subject:"Literature", question:"Who wrote the Diary of a Young Girl also known as Anne Frank's diary?", answer:"anne frank", crewNote:"Full name required, matey!", ts: Date.now()-260000 },
  { id:"l25", author:"Trivia Bot", subject:"Literature", question:"What is the name of the orphan boy raised by wolves in Rudyard Kipling's The Jungle Book?", answer:"mowgli", ts: Date.now()-250000 },
  { id:"l26", author:"Trivia Bot", subject:"Literature", question:"Who wrote the play A Midsummer Night's Dream?", answer:"william shakespeare", crewNote:"Full name required, matey!", ts: Date.now()-240000 },
  { id:"l27", author:"Trivia Bot", subject:"Literature", question:"What novel features the character Atticus Finch?", answer:"to kill a mockingbird", ts: Date.now()-230000 },
  { id:"l29", author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel Anna Karenina?", answer:"leo tolstoy", crewNote:"Full name required, matey!", ts: Date.now()-210000 },
  { id:"l30", author:"Trivia Bot", subject:"Literature", question:"What Charles Dickens novel features the character Ebenezer Scrooge?", answer:"a christmas carol", ts: Date.now()-200000 },

  // ── Additional Sports (10) ────────────────────────────────────────────────
  { id:"sp26", author:"Trivia Bot", subject:"Sports", question:"What is the maximum score in a single game of ten-pin bowling?", answer:"300", ts: Date.now()-190000 },
  { id:"sp27", author:"Trivia Bot", subject:"Sports", question:"How many players are on a polo team?", answer:"4", ts: Date.now()-180000 },
  { id:"sp28", author:"Trivia Bot", subject:"Sports", question:"What country did Usain Bolt represent when he set world records in sprinting?", answer:"jamaica", crewNote:"Country name required, matey!", ts: Date.now()-170000 },
  { id:"sp29", author:"Trivia Bot", subject:"Sports", question:"What is the name of the trophy awarded to the winner of the NHL championship?", answer:"stanley cup", ts: Date.now()-160000 },
  { id:"sp30", author:"Trivia Bot", subject:"Sports", question:"How many events are in the Olympic decathlon?", answer:"10", ts: Date.now()-150000 },
  { id:"sp31", author:"Trivia Bot", subject:"Sports", question:"What sport is played at Augusta National Golf Club each April?", answer:"golf", ts: Date.now()-140000 },
  { id:"sp33", author:"Trivia Bot", subject:"Sports", question:"In what sport would you perform a slam dunk?", answer:"basketball", ts: Date.now()-120000 },
  { id:"sp35", author:"Trivia Bot", subject:"Sports", question:"How many players are on each side in a game of American football?", answer:"11", ts: Date.now()-100000 },

  // ── Science & Nature — new batch (20) ────────────────────────────────────
  { id:"sn01", author:"Trivia Bot", subject:"Science", question:"What is the only metal that is liquid at room temperature?", answer:"mercury", ts: Date.now()-DAY*499 },
  { id:"sn02", author:"Trivia Bot", subject:"Science", question:"How many hearts does an octopus have?", answer:"3", ts: Date.now()-DAY*498 },
  { id:"sn03", author:"Trivia Bot", subject:"Science", question:"What is the name of the bone in the upper arm?", answer:"humerus", ts: Date.now()-DAY*497 },
  { id:"sn04", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for potassium?", answer:"k", crewNote:"Chemical symbol required — one letter, matey!", ts: Date.now()-DAY*496 },
  { id:"sn05", author:"Trivia Bot", subject:"Science", question:"What planet has a day longer than its year?", answer:"venus", ts: Date.now()-DAY*495 },
  { id:"sn06", author:"Trivia Bot", subject:"Science", question:"What is the name of the cell that carries oxygen in the blood?", answer:"red blood cell", ts: Date.now()-DAY*494 },
  { id:"sn07", author:"Trivia Bot", subject:"Science", question:"What is the term for the bending of light as it passes through a lens?", answer:"refraction", ts: Date.now()-DAY*493 },
  { id:"sn08", author:"Trivia Bot", subject:"Science", question:"What is the name of the process by which a solid turns directly into a gas?", answer:"sublimation", ts: Date.now()-DAY*492 },
  { id:"sn09", author:"Trivia Bot", subject:"Science", question:"How many legs does a spider have?", answer:"8", ts: Date.now()-DAY*491 },
  { id:"sn10", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for copper?", answer:"cu", crewNote:"Chemical symbol required — two letters, matey!", ts: Date.now()-DAY*490 },
  { id:"sn11", author:"Trivia Bot", subject:"Science", question:"What is the name of the force that opposes motion between two surfaces?", answer:"friction", ts: Date.now()-DAY*489 },
  { id:"sn12", author:"Trivia Bot", subject:"Science", question:"What type of rock is formed from cooled lava?", answer:"igneous", ts: Date.now()-DAY*488 },
  { id:"sn13", author:"Trivia Bot", subject:"Science", question:"What is the name of the pigment that gives skin its color?", answer:"melanin", ts: Date.now()-DAY*487 },
  { id:"sn14", author:"Trivia Bot", subject:"Science", question:"What is the unit of frequency?", answer:"hertz", ts: Date.now()-DAY*486 },
  { id:"sn15", author:"Trivia Bot", subject:"Science", question:"What is the name of the protective layer of gases surrounding Earth?", answer:"atmosphere", ts: Date.now()-DAY*485 },
  { id:"sn16", author:"Trivia Bot", subject:"Science", question:"What is the smallest unit of life?", answer:"cell", ts: Date.now()-DAY*484 },
  { id:"sn17", author:"Trivia Bot", subject:"Science", question:"What gas is produced when baking soda and vinegar are combined?", answer:"carbon dioxide", ts: Date.now()-DAY*483 },
  { id:"sn18", author:"Trivia Bot", subject:"Science", question:"What is the name of the longest bone in the human body?", answer:"femur", ts: Date.now()-DAY*482 },
  { id:"sn20", author:"Trivia Bot", subject:"Science", question:"What is the name of the scientist who developed the theory of general relativity?", answer:"albert einstein", crewNote:"Full name required, matey!", ts: Date.now()-DAY*480 },

  // ── History — new batch (20) ──────────────────────────────────────────────
  { id:"hn01", author:"Trivia Bot", subject:"History", question:"What country was the first to land a rover on the moon in 1970?", answer:"soviet union", ts: Date.now()-DAY*479 },
  { id:"hn02", author:"Trivia Bot", subject:"History", question:"What US President was assassinated in Dallas in 1963?", answer:"john f kennedy", crewNote:"Full name required, matey!", ts: Date.now()-DAY*478 },
  { id:"hn03", author:"Trivia Bot", subject:"History", question:"What year was the Magna Carta signed?", answer:"1215", ts: Date.now()-DAY*477 },
  { id:"hn04", author:"Trivia Bot", subject:"History", question:"What ancient civilization built the Sphinx?", answer:"egyptians", ts: Date.now()-DAY*476 },
  { id:"hn05", author:"Trivia Bot", subject:"History", question:"What war was fought between the US and Britain from 1812 to 1815?", answer:"war of 1812", ts: Date.now()-DAY*475 },
  { id:"hn06", author:"Trivia Bot", subject:"History", question:"What German city was divided by a wall from 1961 to 1989?", answer:"berlin", ts: Date.now()-DAY*474 },
  { id:"hn07", author:"Trivia Bot", subject:"History", question:"Who was the first woman to fly solo across the Atlantic Ocean in 1932?", answer:"amelia earhart", crewNote:"Full name required, matey!", ts: Date.now()-DAY*473 },
  { id:"hn08", author:"Trivia Bot", subject:"History", question:"What year did the Great Depression begin in the United States?", answer:"1929", ts: Date.now()-DAY*472 },
  { id:"hn10", author:"Trivia Bot", subject:"History", question:"What was the name of the first space shuttle to orbit Earth?", answer:"columbia", ts: Date.now()-DAY*470 },
  { id:"hn11", author:"Trivia Bot", subject:"History", question:"In what year was the Eiffel Tower completed?", answer:"1889", ts: Date.now()-DAY*469 },
  { id:"hn12", author:"Trivia Bot", subject:"History", question:"Who painted the ceiling of the Sistine Chapel between 1508 and 1512?", answer:"michelangelo", ts: Date.now()-DAY*468 },
  { id:"hn13", author:"Trivia Bot", subject:"History", question:"What year did the United States purchase the Louisiana Territory from France?", answer:"1803", ts: Date.now()-DAY*467 },
  { id:"hn14", author:"Trivia Bot", subject:"History", question:"What was the name of the ship Charles Darwin sailed on during his famous voyage?", answer:"beagle", ts: Date.now()-DAY*466 },
  { id:"hn15", author:"Trivia Bot", subject:"History", question:"What Roman leader was assassinated on the Ides of March in 44 BC?", answer:"julius caesar", crewNote:"Full name required, matey!", ts: Date.now()-DAY*465 },
  { id:"hn16", author:"Trivia Bot", subject:"History", question:"What year did the Spanish Armada attempt to invade England?", answer:"1588", ts: Date.now()-DAY*464 },
  { id:"hn17", author:"Trivia Bot", subject:"History", question:"What was the name of the first successful powered airplane flight in 1903?", answer:"flyer", ts: Date.now()-DAY*463 },
  { id:"hn18", author:"Trivia Bot", subject:"History", question:"What country did Adolf Hitler come from originally?", answer:"austria", ts: Date.now()-DAY*462 },
  { id:"hn19", author:"Trivia Bot", subject:"History", question:"What year did the Bolshevik Revolution take place in Russia?", answer:"1917", ts: Date.now()-DAY*461 },
  { id:"hn20", author:"Trivia Bot", subject:"History", question:"What US President served the longest term in office?", answer:"franklin d roosevelt", crewNote:"Full name required, matey!", ts: Date.now()-DAY*460 },

  // ── Geography — new batch (20) ────────────────────────────────────────────
  { id:"gn01", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Portugal?", answer:"lisbon", ts: Date.now()-DAY*459 },
  { id:"gn02", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Turkey?", answer:"ankara", ts: Date.now()-DAY*458 },
  { id:"gn03", author:"Trivia Bot", subject:"Geography", question:"What is the longest river in South America?", answer:"amazon", ts: Date.now()-DAY*457 },
  { id:"gn04", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Norway?", answer:"oslo", ts: Date.now()-DAY*456 },
  { id:"gn05", author:"Trivia Bot", subject:"Geography", question:"What country is home to the ancient city of Petra?", answer:"jordan", ts: Date.now()-DAY*455 },
  { id:"gn06", author:"Trivia Bot", subject:"Geography", question:"What is the name of the sea between Italy and Croatia?", answer:"adriatic sea", ts: Date.now()-DAY*454 },
  { id:"gn07", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Sweden?", answer:"stockholm", ts: Date.now()-DAY*453 },
  { id:"gn08", author:"Trivia Bot", subject:"Geography", question:"What US state is known as the Lone Star State?", answer:"texas", ts: Date.now()-DAY*452 },
  { id:"gn09", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Poland?", answer:"warsaw", ts: Date.now()-DAY*451 },
  { id:"gn10", author:"Trivia Bot", subject:"Geography", question:"What is the name of the body of water between England and France?", answer:"english channel", ts: Date.now()-DAY*450 },
  { id:"gn11", author:"Trivia Bot", subject:"Geography", question:"What African country is home to the city of Timbuktu?", answer:"mali", ts: Date.now()-DAY*449 },
  { id:"gn12", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Austria?", answer:"vienna", ts: Date.now()-DAY*448 },
  { id:"gn13", author:"Trivia Bot", subject:"Geography", question:"What is the smallest US state by area?", answer:"rhode island", ts: Date.now()-DAY*447 },
  { id:"gn14", author:"Trivia Bot", subject:"Geography", question:"What country does the island of Sardinia belong to?", answer:"italy", ts: Date.now()-DAY*446 },
  { id:"gn15", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Pakistan?", answer:"islamabad", ts: Date.now()-DAY*445 },
  { id:"gn16", author:"Trivia Bot", subject:"Geography", question:"What is the name of the strait between the Atlantic and Pacific Oceans at the southern tip of South America?", answer:"strait of magellan", ts: Date.now()-DAY*444 },
  { id:"gn17", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Kenya?", answer:"nairobi", ts: Date.now()-DAY*443 },
  { id:"gn18", author:"Trivia Bot", subject:"Geography", question:"What two continents does the country of Russia span?", answer:"europe and asia", crewNote:"Both continents required, matey!", ts: Date.now()-DAY*442 },
  { id:"gn19", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Saudi Arabia?", answer:"riyadh", ts: Date.now()-DAY*441 },
  { id:"gn20", author:"Trivia Bot", subject:"Geography", question:"What is the name of the mountain range running through the center of Italy?", answer:"apennines", ts: Date.now()-DAY*440 },

  // ── Pop Culture — new batch (20) ─────────────────────────────────────────
  { id:"pn01", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of the ship in the TV show Star Trek?", answer:"enterprise", ts: Date.now()-DAY*439 },
  { id:"pn03", author:"Trivia Bot", subject:"Pop Culture", question:"What year was Facebook founded?", answer:"2004", ts: Date.now()-DAY*437 },
  { id:"pn04", author:"Trivia Bot", subject:"Pop Culture", question:"What film features the character Hannibal Lecter played by Anthony Hopkins?", answer:"the silence of the lambs", ts: Date.now()-DAY*436 },
  { id:"pn05", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of the coffee shop in the TV show Friends?", answer:"central perk", ts: Date.now()-DAY*435 },
  { id:"pn06", author:"Trivia Bot", subject:"Pop Culture", question:"Who played Neo in the 1999 film The Matrix?", answer:"keanu reeves", crewNote:"Full name required, matey!", ts: Date.now()-DAY*434 },
  { id:"pn07", author:"Trivia Bot", subject:"Pop Culture", question:"What 1985 film features a time-travelling DeLorean?", answer:"back to the future", ts: Date.now()-DAY*433 },
  { id:"pn09", author:"Trivia Bot", subject:"Pop Culture", question:"Who wrote the novel that the film Jaws is based on?", answer:"peter benchley", crewNote:"Full name required, matey!", ts: Date.now()-DAY*431 },
  { id:"pn10", author:"Trivia Bot", subject:"Pop Culture", question:"What TV show features the fictional Westeros?", answer:"game of thrones", ts: Date.now()-DAY*430 },
  { id:"pn11", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of Tony Stark's AI assistant in the Iron Man films?", answer:"jarvis", ts: Date.now()-DAY*429 },
  { id:"pn12", author:"Trivia Bot", subject:"Pop Culture", question:"What actress played Scarlett O'Hara in Gone with the Wind?", answer:"vivien leigh", crewNote:"Full name required, matey!", ts: Date.now()-DAY*428 },
  { id:"pn13", author:"Trivia Bot", subject:"Pop Culture", question:"What video game franchise features characters Link and Zelda?", answer:"the legend of zelda", ts: Date.now()-DAY*427 },
  { id:"pn14", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of the bar in The Simpsons?", answer:"moes tavern", ts: Date.now()-DAY*426 },
  { id:"pn15", author:"Trivia Bot", subject:"Pop Culture", question:"Who played the Terminator in the 1984 film?", answer:"arnold schwarzenegger", crewNote:"Full name required, matey!", ts: Date.now()-DAY*425 },
  { id:"pn16", author:"Trivia Bot", subject:"Pop Culture", question:"What 1975 film by Steven Spielberg is considered the first summer blockbuster?", answer:"jaws", ts: Date.now()-DAY*424 },
  { id:"pn19", author:"Trivia Bot", subject:"Pop Culture", question:"Who played Forrest Gump's love interest Jenny in the 1994 film?", answer:"robin wright", crewNote:"Full name required, matey!", ts: Date.now()-DAY*421 },

  // ── Sports — new batch (20) ───────────────────────────────────────────────
  { id:"spn01", author:"Trivia Bot", subject:"Sports", question:"How many rings are on the Olympic flag?", answer:"5", ts: Date.now()-DAY*419 },
  { id:"spn02", author:"Trivia Bot", subject:"Sports", question:"What country won the first FIFA World Cup in 1930?", answer:"uruguay", ts: Date.now()-DAY*418 },
  { id:"spn03", author:"Trivia Bot", subject:"Sports", question:"How many players are on a rugby union team?", answer:"15", ts: Date.now()-DAY*417 },
  { id:"spn05", author:"Trivia Bot", subject:"Sports", question:"In what year were women first allowed to compete in the modern Olympic Games?", answer:"1900", ts: Date.now()-DAY*415 },
  { id:"spn06", author:"Trivia Bot", subject:"Sports", question:"What sport is played at the US Open held in Flushing Meadows New York?", answer:"tennis", ts: Date.now()-DAY*414 },
  { id:"spn07", author:"Trivia Bot", subject:"Sports", question:"How many points is a safety worth in American football?", answer:"2", ts: Date.now()-DAY*413 },
  { id:"spn09", author:"Trivia Bot", subject:"Sports", question:"How many players are on a water polo team in the water?", answer:"7", ts: Date.now()-DAY*411 },
  { id:"spn10", author:"Trivia Bot", subject:"Sports", question:"What country has won the most cricket World Cup titles?", answer:"australia", ts: Date.now()-DAY*410 },
  { id:"spn11", author:"Trivia Bot", subject:"Sports", question:"What is the term in baseball when a pitcher strikes out three batters using only three pitches?", answer:"immaculate inning", ts: Date.now()-DAY*409 },
  { id:"spn12", author:"Trivia Bot", subject:"Sports", question:"What is the length of a standard Olympic sprint race in meters?", answer:"100", ts: Date.now()-DAY*408 },
  { id:"spn13", author:"Trivia Bot", subject:"Sports", question:"How many times has Brazil won the FIFA World Cup?", answer:"5", ts: Date.now()-DAY*407 },
  { id:"spn14", author:"Trivia Bot", subject:"Sports", question:"What sport uses a shuttlecock?", answer:"badminton", ts: Date.now()-DAY*406 },
  { id:"spn15", author:"Trivia Bot", subject:"Sports", question:"What is the name of the home stadium of the Dallas Cowboys?", answer:"at&t stadium", ts: Date.now()-DAY*405 },
  { id:"spn17", author:"Trivia Bot", subject:"Sports", question:"What is the name given to a score of three under par on a single hole in golf?", answer:"albatross", ts: Date.now()-DAY*403 },
  { id:"spn18", author:"Trivia Bot", subject:"Sports", question:"What country hosted the 2022 FIFA World Cup?", answer:"qatar", ts: Date.now()-DAY*402 },
  { id:"spn19", author:"Trivia Bot", subject:"Sports", question:"How many players are on each team in a game of ice hockey?", answer:"6", ts: Date.now()-DAY*401 },
  { id:"spn20", author:"Trivia Bot", subject:"Sports", question:"What is the name of the starting position in American football who snaps the ball?", answer:"center", ts: Date.now()-DAY*400 },

  // ── Literature — new batch (20) ───────────────────────────────────────────
  { id:"ln01", author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel Wuthering Heights?", answer:"emily bronte", crewNote:"Full name required, matey!", ts: Date.now()-DAY*399 },
  { id:"ln02", author:"Trivia Bot", subject:"Literature", question:"What novel by George Orwell features the pigs Napoleon and Snowball?", answer:"animal farm", ts: Date.now()-DAY*398 },
  { id:"ln03", author:"Trivia Bot", subject:"Literature", question:"Who wrote the play Othello?", answer:"william shakespeare", crewNote:"Full name required, matey!", ts: Date.now()-DAY*397 },
  { id:"ln04", author:"Trivia Bot", subject:"Literature", question:"What is the name of the narrator in The Great Gatsby?", answer:"nick carraway", crewNote:"Full name required, matey!", ts: Date.now()-DAY*396 },
  { id:"ln05", author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel One Hundred Years of Solitude?", answer:"gabriel garcia marquez", crewNote:"Full name required, matey!", ts: Date.now()-DAY*395 },
  { id:"ln07", author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel The Old Man and the Sea?", answer:"ernest hemingway", crewNote:"Full name required, matey!", ts: Date.now()-DAY*393 },
  { id:"ln09", author:"Trivia Bot", subject:"Literature", question:"Who wrote the play The Importance of Being Earnest?", answer:"oscar wilde", crewNote:"Full name required, matey!", ts: Date.now()-DAY*391 },
  { id:"ln10", author:"Trivia Bot", subject:"Literature", question:"What is the name of Captain Ahab's ship in Moby Dick?", answer:"pequod", ts: Date.now()-DAY*390 },
  { id:"ln11", author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel The Kite Runner?", answer:"khaled hosseini", crewNote:"Full name required, matey!", ts: Date.now()-DAY*389 },
  { id:"ln12", author:"Trivia Bot", subject:"Literature", question:"What Russian author wrote War and Peace?", answer:"leo tolstoy", crewNote:"Full name required, matey!", ts: Date.now()-DAY*388 },
  { id:"ln13", author:"Trivia Bot", subject:"Literature", question:"What is the first name of the character Pip in Great Expectations?", answer:"philip", ts: Date.now()-DAY*387 },
  { id:"ln14", author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel Catch-22?", answer:"joseph heller", crewNote:"Full name required, matey!", ts: Date.now()-DAY*386 },
  { id:"ln15", author:"Trivia Bot", subject:"Literature", question:"What is the name of Sherlock Holmes's housekeeper?", answer:"mrs hudson", ts: Date.now()-DAY*385 },
  { id:"ln16", author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel The Picture of Dorian Gray?", answer:"oscar wilde", crewNote:"Full name required, matey!", ts: Date.now()-DAY*384 },
  { id:"ln17", author:"Trivia Bot", subject:"Literature", question:"What dystopian novel features the concept of Big Brother?", answer:"1984", ts: Date.now()-DAY*383 },
  { id:"ln18", author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel Dracula published in 1897?", answer:"bram stoker", crewNote:"Full name required, matey!", ts: Date.now()-DAY*382 },
  { id:"ln19", author:"Trivia Bot", subject:"Literature", question:"What is the name of Robinson Crusoe's companion on the island?", answer:"friday", ts: Date.now()-DAY*381 },
  { id:"ln20", author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel The Hitchhiker's Guide to the Galaxy?", answer:"douglas adams", crewNote:"Full name required, matey!", ts: Date.now()-DAY*380 },

  // ── Music — new batch (20) ────────────────────────────────────────────────
  { id:"mun02", author:"Trivia Bot", subject:"Music", question:"What is the name of the lead singer of Coldplay?", answer:"chris martin", crewNote:"Full name required, matey!", ts: Date.now()-DAY*378 },
  { id:"mun03", author:"Trivia Bot", subject:"Music", question:"What country does the band ABBA come from?", answer:"sweden", ts: Date.now()-DAY*377 },
  { id:"mun04", author:"Trivia Bot", subject:"Music", question:"What is the term for a musical piece composed for two performers?", answer:"duet", ts: Date.now()-DAY*376 },
  { id:"mun05", author:"Trivia Bot", subject:"Music", question:"Who composed the symphony known as the Pastoral which is his Sixth Symphony?", answer:"beethoven", ts: Date.now()-DAY*375 },
  { id:"mun06", author:"Trivia Bot", subject:"Music", question:"What is the name of the lead singer of Radiohead?", answer:"thom yorke", crewNote:"Full name required, matey!", ts: Date.now()-DAY*374 },
  { id:"mun07", author:"Trivia Bot", subject:"Music", question:"What musical term means gradually getting softer?", answer:"decrescendo", ts: Date.now()-DAY*373 },
  { id:"mun08", author:"Trivia Bot", subject:"Music", question:"What band released the album Rumours in 1977?", answer:"fleetwood mac", ts: Date.now()-DAY*372 },
  { id:"mun09", author:"Trivia Bot", subject:"Music", question:"What is the name of the highest female singing voice?", answer:"soprano", ts: Date.now()-DAY*371 },
  { id:"mun10", author:"Trivia Bot", subject:"Music", question:"What nationality was the composer Frederic Chopin?", answer:"polish", ts: Date.now()-DAY*370 },
  { id:"mun11", author:"Trivia Bot", subject:"Music", question:"What is the name of the instrument that Elvis Presley famously played?", answer:"guitar", ts: Date.now()-DAY*369 },
  { id:"mun12", author:"Trivia Bot", subject:"Music", question:"How many strings does a standard violin have?", answer:"4", ts: Date.now()-DAY*368 },
  { id:"mun13", author:"Trivia Bot", subject:"Music", question:"What band released the album Led Zeppelin IV which features the song Stairway to Heaven?", answer:"led zeppelin", ts: Date.now()-DAY*367 },
  { id:"mun14", author:"Trivia Bot", subject:"Music", question:"What is the name of the musical notation symbol that indicates a note should be held longer?", answer:"fermata", ts: Date.now()-DAY*366 },
  { id:"mun15", author:"Trivia Bot", subject:"Music", question:"What Austrian composer wrote The Marriage of Figaro and Don Giovanni?", answer:"mozart", ts: Date.now()-DAY*365 },
  { id:"mun16", author:"Trivia Bot", subject:"Music", question:"What is the name of the lead singer of the band The Doors?", answer:"jim morrison", crewNote:"Full name required, matey!", ts: Date.now()-DAY*364 },
  { id:"mun17", author:"Trivia Bot", subject:"Music", question:"What decade did punk rock music emerge?", answer:"1970s", ts: Date.now()-DAY*363 },
  { id:"mun19", author:"Trivia Bot", subject:"Music", question:"Who is known as the Father of the Blues?", answer:"w c handy", crewNote:"Full name required, matey!", ts: Date.now()-DAY*361 },
  { id:"mun20", author:"Trivia Bot", subject:"Music", question:"Which singer released the 1971 album What's Going On?", answer:"marvin gaye", crewNote:"Full name required, matey!", ts: Date.now()-DAY*360 },

  // ── Finance & Stock Market — new batch (20) ───────────────────────────────
  { id:"fin02", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Amazon?", answer:"amzn", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*358 },
  { id:"fin03", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Microsoft?", answer:"msft", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*357 },
  { id:"fin05", author:"Trivia Bot", subject:"Finance", question:"What is the name of the investment strategy of regularly investing a fixed amount regardless of price?", answer:"dollar cost averaging", ts: Date.now()-DAY*355 },
  { id:"fin07", author:"Trivia Bot", subject:"Finance", question:"What is the name of the US government bond with a maturity of 10 years?", answer:"treasury note", ts: Date.now()-DAY*353 },
  { id:"fin09", author:"Trivia Bot", subject:"Finance", question:"What does the acronym REIT stand for?", answer:"real estate investment trust", ts: Date.now()-DAY*351 },
  { id:"fin10", author:"Trivia Bot", subject:"Finance", question:"What is the term for the gradual increase in prices over time?", answer:"inflation", ts: Date.now()-DAY*350 },
  { id:"fin11", author:"Trivia Bot", subject:"Finance", question:"What is the name of the financial statement that shows a company's revenues and expenses?", answer:"income statement", ts: Date.now()-DAY*349 },
  { id:"fin14", author:"Trivia Bot", subject:"Finance", question:"What is the maximum amount the FDIC insures per depositor per bank as of 2024?", answer:"250000", crewNote:"Dollar amount in numbers, matey!", ts: Date.now()-DAY*346 },
  { id:"fin16", author:"Trivia Bot", subject:"Finance", question:"What is the name of the index that tracks the 100 largest non-financial companies on the Nasdaq?", answer:"nasdaq 100", ts: Date.now()-DAY*344 },
  { id:"fin17", author:"Trivia Bot", subject:"Finance", question:"What is the term for the interest rate at which banks lend money to each other overnight?", answer:"federal funds rate", ts: Date.now()-DAY*343 },

  // ── Technology — new batch (20) ───────────────────────────────────────────
  { id:"tn01", author:"Trivia Bot", subject:"Technology", question:"What does the acronym HTTP stand for?", answer:"hypertext transfer protocol", ts: Date.now()-DAY*339 },
  { id:"tn03", author:"Trivia Bot", subject:"Technology", question:"What company created the Java programming language?", answer:"sun microsystems", ts: Date.now()-DAY*337 },
  { id:"tn05", author:"Trivia Bot", subject:"Technology", question:"What is the name of the operating system developed by Linus Torvalds in 1991?", answer:"linux", ts: Date.now()-DAY*335 },
  { id:"tn06", author:"Trivia Bot", subject:"Technology", question:"What does PDF stand for?", answer:"portable document format", ts: Date.now()-DAY*334 },
  { id:"tn10", author:"Trivia Bot", subject:"Technology", question:"What is the name of Apple's desktop operating system?", answer:"macos", ts: Date.now()-DAY*330 },
  { id:"tn11", author:"Trivia Bot", subject:"Technology", question:"What does the acronym SQL stand for?", answer:"structured query language", ts: Date.now()-DAY*329 },
  { id:"tn12", author:"Trivia Bot", subject:"Technology", question:"What is the name of the technology that allows devices to communicate wirelessly over short distances?", answer:"bluetooth", ts: Date.now()-DAY*328 },
  { id:"tn13", author:"Trivia Bot", subject:"Technology", question:"Who invented the World Wide Web in 1989?", answer:"tim berners-lee", crewNote:"Full name required, matey!", ts: Date.now()-DAY*327 },
  { id:"tn14", author:"Trivia Bot", subject:"Technology", question:"What does the acronym SSD stand for in computing?", answer:"solid state drive", ts: Date.now()-DAY*326 },
  { id:"tn15", author:"Trivia Bot", subject:"Technology", question:"What is the name of Google's web browser?", answer:"chrome", ts: Date.now()-DAY*325 },
  { id:"tn16", author:"Trivia Bot", subject:"Technology", question:"What company created the PlayStation gaming console?", answer:"sony", ts: Date.now()-DAY*324 },
  { id:"tn17", author:"Trivia Bot", subject:"Technology", question:"What does VPN stand for?", answer:"virtual private network", ts: Date.now()-DAY*323 },
  { id:"tn18", author:"Trivia Bot", subject:"Technology", question:"What is the name of the Microsoft productivity suite that includes Word Excel and PowerPoint?", answer:"microsoft office", ts: Date.now()-DAY*322 },

  // ── Food & Drink — new batch (20) ────────────────────────────────────────
  { id:"fdn01", author:"Trivia Bot", subject:"Food & Drink", question:"What country is the origin of the dish paella?", answer:"spain", ts: Date.now()-DAY*319 },
  { id:"fdn02", author:"Trivia Bot", subject:"Food & Drink", question:"What type of pasta is shaped like small rice grains?", answer:"orzo", ts: Date.now()-DAY*318 },
  { id:"fdn03", author:"Trivia Bot", subject:"Food & Drink", question:"What is the name of the Japanese dish of raw fish served over seasoned rice?", answer:"sushi", ts: Date.now()-DAY*317 },
  { id:"fdn04", author:"Trivia Bot", subject:"Food & Drink", question:"What fruit is used to make the French liqueur Cointreau?", answer:"orange", ts: Date.now()-DAY*316 },
  { id:"fdn06", author:"Trivia Bot", subject:"Food & Drink", question:"What is the name of the spice that gives turmeric its yellow color?", answer:"curcumin", ts: Date.now()-DAY*314 },
  { id:"fdn07", author:"Trivia Bot", subject:"Food & Drink", question:"What is the Italian term for a coffee made with espresso and steamed milk?", answer:"latte", ts: Date.now()-DAY*313 },
  { id:"fdn08", author:"Trivia Bot", subject:"Food & Drink", question:"What cocktail is made with rum lime juice and sugar?", answer:"daiquiri", ts: Date.now()-DAY*312 },
  { id:"fdn09", author:"Trivia Bot", subject:"Food & Drink", question:"What country is the origin of the dish moussaka?", answer:"greece", ts: Date.now()-DAY*311 },
  { id:"fdn10", author:"Trivia Bot", subject:"Food & Drink", question:"What is the name of the Japanese alcoholic drink made from fermented rice?", answer:"sake", ts: Date.now()-DAY*310 },
  { id:"fdn11", author:"Trivia Bot", subject:"Food & Drink", question:"What vegetable is the main ingredient in coleslaw?", answer:"cabbage", ts: Date.now()-DAY*309 },
  { id:"fdn12", author:"Trivia Bot", subject:"Food & Drink", question:"What is the term for a dish cooked slowly in liquid in a covered pot?", answer:"braise", ts: Date.now()-DAY*308 },
  { id:"fdn13", author:"Trivia Bot", subject:"Food & Drink", question:"What country is the origin of the dish kimchi?", answer:"korea", ts: Date.now()-DAY*307 },
  { id:"fdn14", author:"Trivia Bot", subject:"Food & Drink", question:"What is the name of the creamy Italian dessert made with mascarpone and espresso?", answer:"tiramisu", ts: Date.now()-DAY*306 },
  { id:"fdn15", author:"Trivia Bot", subject:"Food & Drink", question:"What grain is used to make bourbon whiskey?", answer:"corn", ts: Date.now()-DAY*305 },
  { id:"fdn16", author:"Trivia Bot", subject:"Food & Drink", question:"What is the name of the French sauce made from egg yolks butter and lemon juice?", answer:"hollandaise", ts: Date.now()-DAY*304 },
  { id:"fdn18", author:"Trivia Bot", subject:"Food & Drink", question:"What is the name of the Italian bread that is flat and topped with olive oil and herbs?", answer:"focaccia", ts: Date.now()-DAY*302 },
  { id:"fdn19", author:"Trivia Bot", subject:"Food & Drink", question:"What is the main alcoholic ingredient in a margarita?", answer:"tequila", ts: Date.now()-DAY*301 },
  { id:"fdn20", author:"Trivia Bot", subject:"Food & Drink", question:"What type of bean is used to make chocolate?", answer:"cacao", ts: Date.now()-DAY*300 },

  // ── Art — new batch (20) ──────────────────────────────────────────────────
  { id:"an01", author:"Trivia Bot", subject:"Art", question:"What art movement was Salvador Dali associated with?", answer:"surrealism", ts: Date.now()-DAY*299 },
  { id:"an02", author:"Trivia Bot", subject:"Art", question:"What French artist is known for his paintings of ballet dancers?", answer:"edgar degas", crewNote:"Full name required, matey!", ts: Date.now()-DAY*298 },
  { id:"an04", author:"Trivia Bot", subject:"Art", question:"What Dutch Golden Age painter created the Girl with a Pearl Earring?", answer:"johannes vermeer", crewNote:"Full name required, matey!", ts: Date.now()-DAY*296 },
  { id:"an05", author:"Trivia Bot", subject:"Art", question:"What Norwegian artist painted The Scream in 1893?", answer:"edvard munch", crewNote:"Full name required, matey!", ts: Date.now()-DAY*295 },
  { id:"an06", author:"Trivia Bot", subject:"Art", question:"What is the name of the art style that uses small dots of color to create an image?", answer:"pointillism", ts: Date.now()-DAY*294 },
  { id:"an07", author:"Trivia Bot", subject:"Art", question:"What Spanish architect designed the Sagrada Familia church in Barcelona?", answer:"antonio gaudi", crewNote:"Full name required, matey!", ts: Date.now()-DAY*293 },
  { id:"an08", author:"Trivia Bot", subject:"Art", question:"What is the name of the famous auction house founded in London in 1744?", answer:"sothebys", ts: Date.now()-DAY*292 },
  { id:"an09", author:"Trivia Bot", subject:"Art", question:"What type of art involves making images by assembling pieces of colored glass or tile?", answer:"mosaic", ts: Date.now()-DAY*291 },
  { id:"an10", author:"Trivia Bot", subject:"Art", question:"What American painter is known for his realistic paintings of rural America including Christina's World?", answer:"andrew wyeth", crewNote:"Full name required, matey!", ts: Date.now()-DAY*290 },
  { id:"an11", author:"Trivia Bot", subject:"Art", question:"What is the term for a painting done on wet plaster on a wall?", answer:"fresco", ts: Date.now()-DAY*289 },
  { id:"an13", author:"Trivia Bot", subject:"Art", question:"What is the name of the Japanese art of paper folding?", answer:"origami", ts: Date.now()-DAY*287 },
  { id:"an15", author:"Trivia Bot", subject:"Art", question:"What post-impressionist artist moved to Tahiti and painted its people?", answer:"paul gauguin", crewNote:"Full name required, matey!", ts: Date.now()-DAY*285 },
  { id:"an16", author:"Trivia Bot", subject:"Art", question:"What is the name of the technique of building up texture with thick paint?", answer:"impasto", ts: Date.now()-DAY*284 },
  { id:"an17", author:"Trivia Bot", subject:"Art", question:"What American architect designed the Guggenheim Museum in New York?", answer:"frank lloyd wright", crewNote:"Full name required, matey!", ts: Date.now()-DAY*283 },
  { id:"an18", author:"Trivia Bot", subject:"Art", question:"What is the term for an artwork made from found objects?", answer:"assemblage", ts: Date.now()-DAY*282 },
  { id:"an19", author:"Trivia Bot", subject:"Art", question:"What Belgian artist is known for painting men in bowler hats in surrealist scenes?", answer:"rene magritte", crewNote:"Full name required, matey!", ts: Date.now()-DAY*281 },
  // ── Batch 3: 500 reviewed closed-ended questions (names, numbers, years, short phrases) ──
  { id:"b3sci001", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for lead?", answer:"pb", crewNote:"Chemical symbol required, matey!", ts: Date.now()-DAY*1000 },
  { id:"b3sci002", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for tin?", answer:"sn", crewNote:"Chemical symbol required, matey!", ts: Date.now()-DAY*999 },
  { id:"b3sci003", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for tungsten?", answer:"w", crewNote:"Chemical symbol required, matey!", ts: Date.now()-DAY*998 },
  { id:"b3sci004", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for helium?", answer:"he", crewNote:"Chemical symbol required, matey!", ts: Date.now()-DAY*997 },
  { id:"b3sci005", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for zinc?", answer:"zn", crewNote:"Chemical symbol required, matey!", ts: Date.now()-DAY*996 },
  { id:"b3sci006", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for sulfur?", answer:"s", crewNote:"Chemical symbol required, matey!", ts: Date.now()-DAY*995 },
  { id:"b3sci007", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for calcium?", answer:"ca", crewNote:"Chemical symbol required, matey!", ts: Date.now()-DAY*994 },
  { id:"b3sci008", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for chlorine?", answer:"cl", crewNote:"Chemical symbol required, matey!", ts: Date.now()-DAY*993 },
  { id:"b3sci009", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for neon?", answer:"ne", crewNote:"Chemical symbol required, matey!", ts: Date.now()-DAY*992 },
  { id:"b3sci010", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for nickel?", answer:"ni", crewNote:"Chemical symbol required, matey!", ts: Date.now()-DAY*991 },
  { id:"b3sci011", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for mercury?", answer:"hg", crewNote:"Chemical symbol required, matey!", ts: Date.now()-DAY*990 },
  { id:"b3sci012", author:"Trivia Bot", subject:"Science", question:"What is the freezing point of water in degrees Fahrenheit?", answer:"32", ts: Date.now()-DAY*989 },
  { id:"b3sci013", author:"Trivia Bot", subject:"Science", question:"What is the boiling point of water in degrees Fahrenheit?", answer:"212", ts: Date.now()-DAY*988 },
  { id:"b3sci014", author:"Trivia Bot", subject:"Science", question:"What term describes an animal that eats both plants and meat?", answer:"omnivore", ts: Date.now()-DAY*987 },
  { id:"b3sci015", author:"Trivia Bot", subject:"Science", question:"What term describes an animal that is active mainly at night?", answer:"nocturnal", ts: Date.now()-DAY*986 },
  { id:"b3sci016", author:"Trivia Bot", subject:"Science", question:"What type of blood vessel carries blood away from the heart?", answer:"artery", ts: Date.now()-DAY*985 },
  { id:"b3sci017", author:"Trivia Bot", subject:"Science", question:"What is the name of the nearest large spiral galaxy to the Milky Way?", answer:"andromeda", ts: Date.now()-DAY*984 },
  { id:"b3sci018", author:"Trivia Bot", subject:"Science", question:"What scale was traditionally used to measure earthquake magnitude?", answer:"richter", ts: Date.now()-DAY*983 },
  { id:"b3sci019", author:"Trivia Bot", subject:"Science", question:"What scale ranks mineral hardness from 1 to 10?", answer:"mohs", ts: Date.now()-DAY*982 },
  { id:"b3sci020", author:"Trivia Bot", subject:"Science", question:"What is the SI unit of force?", answer:"newton", ts: Date.now()-DAY*981 },
  { id:"b3sci021", author:"Trivia Bot", subject:"Science", question:"What is the SI unit of energy?", answer:"joule", ts: Date.now()-DAY*980 },
  { id:"b3sci022", author:"Trivia Bot", subject:"Science", question:"What is the SI unit of power?", answer:"watt", ts: Date.now()-DAY*979 },
  { id:"b3sci023", author:"Trivia Bot", subject:"Science", question:"What is the study of fungi called?", answer:"mycology", ts: Date.now()-DAY*978 },
  { id:"b3sci024", author:"Trivia Bot", subject:"Science", question:"What is the study of birds called?", answer:"ornithology", ts: Date.now()-DAY*977 },
  { id:"b3sci025", author:"Trivia Bot", subject:"Science", question:"What is the study of weather called?", answer:"meteorology", ts: Date.now()-DAY*976 },
  { id:"b3sci026", author:"Trivia Bot", subject:"Science", question:"What is the process by which plants release water vapor through their leaves?", answer:"transpiration", ts: Date.now()-DAY*975 },
  { id:"b3sci027", author:"Trivia Bot", subject:"Science", question:"What antibiotic did Alexander Fleming discover in 1928?", answer:"penicillin", ts: Date.now()-DAY*974 },
  { id:"b3sci028", author:"Trivia Bot", subject:"Science", question:"What type of blood cell helps the body fight infection?", answer:"white blood cell", ts: Date.now()-DAY*973 },
  { id:"b3sci029", author:"Trivia Bot", subject:"Science", question:"What is the name of the giant storm on Jupiter that has raged for centuries?", answer:"great red spot", ts: Date.now()-DAY*972 },
  { id:"b3sci030", author:"Trivia Bot", subject:"Science", question:"What is the atomic number of oxygen?", answer:"8", ts: Date.now()-DAY*971 },
  { id:"b3sci031", author:"Trivia Bot", subject:"Science", question:"What is the atomic number of gold?", answer:"79", ts: Date.now()-DAY*970 },
  { id:"b3sci032", author:"Trivia Bot", subject:"Science", question:"What was the name of the supercontinent that existed about 300 million years ago?", answer:"pangaea", ts: Date.now()-DAY*969 },
  { id:"b3sci033", author:"Trivia Bot", subject:"Science", question:"What is the layer of Earth between the crust and the core?", answer:"mantle", ts: Date.now()-DAY*968 },
  { id:"b3sci034", author:"Trivia Bot", subject:"Science", question:"What is the pH of pure water at room temperature?", answer:"7", ts: Date.now()-DAY*967 },
  { id:"b3sci035", author:"Trivia Bot", subject:"Science", question:"What is the name for the explosion of a massive dying star?", answer:"supernova", ts: Date.now()-DAY*966 },
  { id:"b3sci036", author:"Trivia Bot", subject:"Science", question:"What is the process of cell division that produces two identical cells?", answer:"mitosis", ts: Date.now()-DAY*965 },
  { id:"b3sci037", author:"Trivia Bot", subject:"Science", question:"What molecule carries genetic information in most living organisms?", answer:"dna", ts: Date.now()-DAY*964 },
  { id:"b3sci038", author:"Trivia Bot", subject:"Science", question:"What vitamin prevents scurvy?", answer:"vitamin c", ts: Date.now()-DAY*963 },
  { id:"b3sci039", author:"Trivia Bot", subject:"Science", question:"What unit is used to measure sound intensity?", answer:"decibel", ts: Date.now()-DAY*962 },
  { id:"b3sci040", author:"Trivia Bot", subject:"Science", question:"What is the largest moon of Saturn?", answer:"titan", ts: Date.now()-DAY*961 },
  { id:"b3sci041", author:"Trivia Bot", subject:"Science", question:"What is the largest moon of Jupiter?", answer:"ganymede", ts: Date.now()-DAY*960 },
  { id:"b3sci042", author:"Trivia Bot", subject:"Science", question:"What do we call a scientist who studies fossils?", answer:"paleontologist", ts: Date.now()-DAY*959 },
  { id:"b3sci043", author:"Trivia Bot", subject:"Science", question:"How many planets are in our solar system?", answer:"8", ts: Date.now()-DAY*958 },
  { id:"b3his001", author:"Trivia Bot", subject:"History", question:"Which ancient Greek philosopher tutored Alexander the Great?", answer:"aristotle", ts: Date.now()-DAY*957 },
  { id:"b3his002", author:"Trivia Bot", subject:"History", question:"In what year did the Norman conquest of England take place?", answer:"1066", ts: Date.now()-DAY*956 },
  { id:"b3his003", author:"Trivia Bot", subject:"History", question:"Which English king was executed in 1649?", answer:"charles i", crewNote:"Include the numeral, matey!", ts: Date.now()-DAY*955 },
  { id:"b3his004", author:"Trivia Bot", subject:"History", question:"Who was the first US President to live in the White House?", answer:"john adams", crewNote:"Full name required, matey!", ts: Date.now()-DAY*954 },
  { id:"b3his005", author:"Trivia Bot", subject:"History", question:"Who was the 16th President of the United States?", answer:"abraham lincoln", crewNote:"Full name required, matey!", ts: Date.now()-DAY*953 },
  { id:"b3his006", author:"Trivia Bot", subject:"History", question:"Who was US President when the stock market crashed in 1929?", answer:"herbert hoover", crewNote:"Full name required, matey!", ts: Date.now()-DAY*952 },
  { id:"b3his007", author:"Trivia Bot", subject:"History", question:"In which city was Archduke Franz Ferdinand assassinated in 1914?", answer:"sarajevo", ts: Date.now()-DAY*951 },
  { id:"b3his008", author:"Trivia Bot", subject:"History", question:"Who led the Cuban Revolution that took power in 1959?", answer:"fidel castro", crewNote:"Full name required, matey!", ts: Date.now()-DAY*950 },
  { id:"b3his009", author:"Trivia Bot", subject:"History", question:"Who was the first female Prime Minister of India?", answer:"indira gandhi", crewNote:"Full name required, matey!", ts: Date.now()-DAY*949 },
  { id:"b3his010", author:"Trivia Bot", subject:"History", question:"Which empire was ruled by Suleiman the Magnificent?", answer:"ottoman", ts: Date.now()-DAY*948 },
  { id:"b3his011", author:"Trivia Bot", subject:"History", question:"In what year did the Boston Tea Party take place?", answer:"1773", ts: Date.now()-DAY*947 },
  { id:"b3his012", author:"Trivia Bot", subject:"History", question:"At which battle in 1815 was Napoleon finally defeated?", answer:"waterloo", ts: Date.now()-DAY*946 },
  { id:"b3his013", author:"Trivia Bot", subject:"History", question:"What was the name of the German air force in World War II?", answer:"luftwaffe", ts: Date.now()-DAY*945 },
  { id:"b3his014", author:"Trivia Bot", subject:"History", question:"In what year did the Cuban Missile Crisis take place?", answer:"1962", ts: Date.now()-DAY*944 },
  { id:"b3his015", author:"Trivia Bot", subject:"History", question:"What was the code name of the first atomic bomb test in 1945?", answer:"trinity", ts: Date.now()-DAY*943 },
  { id:"b3his016", author:"Trivia Bot", subject:"History", question:"What was the capital of the Byzantine Empire?", answer:"constantinople", ts: Date.now()-DAY*942 },
  { id:"b3his017", author:"Trivia Bot", subject:"History", question:"Which pharaoh's tomb was discovered by Howard Carter in 1922?", answer:"tutankhamun", ts: Date.now()-DAY*941 },
  { id:"b3his018", author:"Trivia Bot", subject:"History", question:"In what year did the Western Roman Empire fall?", answer:"476", ts: Date.now()-DAY*940 },
  { id:"b3his019", author:"Trivia Bot", subject:"History", question:"Who was the first human to travel into space?", answer:"yuri gagarin", crewNote:"Full name required, matey!", ts: Date.now()-DAY*939 },
  { id:"b3his020", author:"Trivia Bot", subject:"History", question:"Who was the second person to walk on the moon?", answer:"buzz aldrin", crewNote:"Full name required, matey!", ts: Date.now()-DAY*938 },
  { id:"b3his021", author:"Trivia Bot", subject:"History", question:"In what year did Apollo 11 land on the moon?", answer:"1969", ts: Date.now()-DAY*937 },
  { id:"b3his022", author:"Trivia Bot", subject:"History", question:"Which Soviet leader ruled after Lenin died in 1924?", answer:"joseph stalin", crewNote:"Full name required, matey!", ts: Date.now()-DAY*936 },
  { id:"b3his023", author:"Trivia Bot", subject:"History", question:"Which Chinese dynasty built much of the Great Wall as it stands today?", answer:"ming", ts: Date.now()-DAY*935 },
  { id:"b3his024", author:"Trivia Bot", subject:"History", question:"In what year did Hawaii become a US state?", answer:"1959", ts: Date.now()-DAY*934 },
  { id:"b3his025", author:"Trivia Bot", subject:"History", question:"Who was US President during World War I?", answer:"woodrow wilson", crewNote:"Full name required, matey!", ts: Date.now()-DAY*933 },
  { id:"b3his026", author:"Trivia Bot", subject:"History", question:"Which Confederate general surrendered at Appomattox in 1865?", answer:"robert e lee", crewNote:"Full name required, matey!", ts: Date.now()-DAY*932 },
  { id:"b3his027", author:"Trivia Bot", subject:"History", question:"In what year did the Chernobyl nuclear disaster occur?", answer:"1986", ts: Date.now()-DAY*931 },
  { id:"b3his028", author:"Trivia Bot", subject:"History", question:"In what year did the September 11 attacks occur?", answer:"2001", ts: Date.now()-DAY*930 },
  { id:"b3his029", author:"Trivia Bot", subject:"History", question:"Which country was Roald Amundsen from, the first to reach the South Pole?", answer:"norway", ts: Date.now()-DAY*929 },
  { id:"b3his030", author:"Trivia Bot", subject:"History", question:"Who was the first Chancellor of the German Empire in 1871?", answer:"otto von bismarck", crewNote:"Full name required, matey!", ts: Date.now()-DAY*928 },
  { id:"b3his031", author:"Trivia Bot", subject:"History", question:"Which English queen reigned from 1558 to 1603?", answer:"elizabeth i", crewNote:"Include the numeral, matey!", ts: Date.now()-DAY*927 },
  { id:"b3his032", author:"Trivia Bot", subject:"History", question:"Which English king had six wives?", answer:"henry viii", crewNote:"Include the numeral, matey!", ts: Date.now()-DAY*926 },
  { id:"b3his033", author:"Trivia Bot", subject:"History", question:"What British ocean liner was sunk by a German U-boat in 1915?", answer:"lusitania", ts: Date.now()-DAY*925 },
  { id:"b3his034", author:"Trivia Bot", subject:"History", question:"Who was the only President of the Soviet Union?", answer:"mikhail gorbachev", crewNote:"Full name required, matey!", ts: Date.now()-DAY*924 },
  { id:"b3his035", author:"Trivia Bot", subject:"History", question:"In what year was the US Constitution signed?", answer:"1787", ts: Date.now()-DAY*923 },
  { id:"b3his036", author:"Trivia Bot", subject:"History", question:"Which US President signed the Civil Rights Act of 1964?", answer:"lyndon b johnson", crewNote:"Full name required, matey!", ts: Date.now()-DAY*922 },
  { id:"b3his037", author:"Trivia Bot", subject:"History", question:"Who was the first African American President of the United States?", answer:"barack obama", crewNote:"Full name required, matey!", ts: Date.now()-DAY*921 },
  { id:"b3his038", author:"Trivia Bot", subject:"History", question:"In what year was Barack Obama first elected President?", answer:"2008", ts: Date.now()-DAY*920 },
  { id:"b3his039", author:"Trivia Bot", subject:"History", question:"Which French king was known as the Sun King?", answer:"louis xiv", crewNote:"Include the numeral, matey!", ts: Date.now()-DAY*919 },
  { id:"b3his040", author:"Trivia Bot", subject:"History", question:"Which city hosted the first modern Olympic Games in 1896?", answer:"athens", ts: Date.now()-DAY*918 },
  { id:"b3his041", author:"Trivia Bot", subject:"History", question:"What name, meaning rebirth, is given to the European cultural movement of the 14th to 17th centuries?", answer:"renaissance", ts: Date.now()-DAY*917 },
  { id:"b3his042", author:"Trivia Bot", subject:"History", question:"What was the 1918 influenza pandemic commonly called?", answer:"spanish flu", ts: Date.now()-DAY*916 },
  { id:"b3his043", author:"Trivia Bot", subject:"History", question:"The 1982 Falklands War was fought between Britain and which country?", answer:"argentina", ts: Date.now()-DAY*915 },
  { id:"b3his044", author:"Trivia Bot", subject:"History", question:"Which Shoshone woman guided the Lewis and Clark expedition?", answer:"sacagawea", ts: Date.now()-DAY*914 },
  { id:"b3his045", author:"Trivia Bot", subject:"History", question:"Which Portuguese explorer sailed from Europe to India around Africa in 1498?", answer:"vasco da gama", crewNote:"Full name required, matey!", ts: Date.now()-DAY*913 },
  { id:"b3geo001", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Greece?", answer:"athens", ts: Date.now()-DAY*912 },
  { id:"b3geo002", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Thailand?", answer:"bangkok", ts: Date.now()-DAY*911 },
  { id:"b3geo003", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Vietnam?", answer:"hanoi", ts: Date.now()-DAY*910 },
  { id:"b3geo004", author:"Trivia Bot", subject:"Geography", question:"What is the capital of the Philippines?", answer:"manila", ts: Date.now()-DAY*909 },
  { id:"b3geo005", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Peru?", answer:"lima", ts: Date.now()-DAY*908 },
  { id:"b3geo006", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Chile?", answer:"santiago", ts: Date.now()-DAY*907 },
  { id:"b3geo007", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Cuba?", answer:"havana", ts: Date.now()-DAY*906 },
  { id:"b3geo008", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Ireland?", answer:"dublin", ts: Date.now()-DAY*905 },
  { id:"b3geo009", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Scotland?", answer:"edinburgh", ts: Date.now()-DAY*904 },
  { id:"b3geo010", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Finland?", answer:"helsinki", ts: Date.now()-DAY*903 },
  { id:"b3geo011", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Denmark?", answer:"copenhagen", ts: Date.now()-DAY*902 },
  { id:"b3geo012", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Belgium?", answer:"brussels", ts: Date.now()-DAY*901 },
  { id:"b3geo013", author:"Trivia Bot", subject:"Geography", question:"What is the capital of the Czech Republic?", answer:"prague", ts: Date.now()-DAY*900 },
  { id:"b3geo014", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Hungary?", answer:"budapest", ts: Date.now()-DAY*899 },
  { id:"b3geo015", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Iraq?", answer:"baghdad", ts: Date.now()-DAY*898 },
  { id:"b3geo016", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Iran?", answer:"tehran", ts: Date.now()-DAY*897 },
  { id:"b3geo017", author:"Trivia Bot", subject:"Geography", question:"What is the capital of New Zealand?", answer:"wellington", ts: Date.now()-DAY*896 },
  { id:"b3geo018", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Venezuela?", answer:"caracas", ts: Date.now()-DAY*895 },
  { id:"b3geo019", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Nepal?", answer:"kathmandu", ts: Date.now()-DAY*894 },
  { id:"b3geo020", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Iceland?", answer:"reykjavik", ts: Date.now()-DAY*893 },
  { id:"b3geo021", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Texas?", answer:"austin", ts: Date.now()-DAY*892 },
  { id:"b3geo022", author:"Trivia Bot", subject:"Geography", question:"What is the capital of California?", answer:"sacramento", ts: Date.now()-DAY*891 },
  { id:"b3geo023", author:"Trivia Bot", subject:"Geography", question:"What is the capital of New York State?", answer:"albany", ts: Date.now()-DAY*890 },
  { id:"b3geo024", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Florida?", answer:"tallahassee", ts: Date.now()-DAY*889 },
  { id:"b3geo025", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Washington State?", answer:"olympia", ts: Date.now()-DAY*888 },
  { id:"b3geo026", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Pennsylvania?", answer:"harrisburg", ts: Date.now()-DAY*887 },
  { id:"b3geo027", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Nevada?", answer:"carson city", ts: Date.now()-DAY*886 },
  { id:"b3geo028", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Michigan?", answer:"lansing", ts: Date.now()-DAY*885 },
  { id:"b3geo029", author:"Trivia Bot", subject:"Geography", question:"What is the capital of Alaska?", answer:"juneau", ts: Date.now()-DAY*884 },
  { id:"b3geo030", author:"Trivia Bot", subject:"Geography", question:"Which river flows through London?", answer:"thames", ts: Date.now()-DAY*883 },
  { id:"b3geo031", author:"Trivia Bot", subject:"Geography", question:"Which river flows through Paris?", answer:"seine", ts: Date.now()-DAY*882 },
  { id:"b3geo032", author:"Trivia Bot", subject:"Geography", question:"Which river flows through Baghdad?", answer:"tigris", ts: Date.now()-DAY*881 },
  { id:"b3geo033", author:"Trivia Bot", subject:"Geography", question:"What is the longest river in Europe?", answer:"volga", ts: Date.now()-DAY*880 },
  { id:"b3geo034", author:"Trivia Bot", subject:"Geography", question:"What is the longest river in Asia?", answer:"yangtze", ts: Date.now()-DAY*879 },
  { id:"b3geo035", author:"Trivia Bot", subject:"Geography", question:"What is the largest lake in Africa?", answer:"victoria", ts: Date.now()-DAY*878 },
  { id:"b3geo036", author:"Trivia Bot", subject:"Geography", question:"What is the highest mountain in Africa?", answer:"kilimanjaro", ts: Date.now()-DAY*877 },
  { id:"b3geo037", author:"Trivia Bot", subject:"Geography", question:"What is the highest mountain in North America?", answer:"denali", ts: Date.now()-DAY*876 },
  { id:"b3geo038", author:"Trivia Bot", subject:"Geography", question:"What is the largest hot desert in the world?", answer:"sahara", ts: Date.now()-DAY*875 },
  { id:"b3geo039", author:"Trivia Bot", subject:"Geography", question:"What is the largest coral reef system in the world?", answer:"great barrier reef", ts: Date.now()-DAY*874 },
  { id:"b3geo040", author:"Trivia Bot", subject:"Geography", question:"What is the largest country in Africa by area?", answer:"algeria", ts: Date.now()-DAY*873 },
  { id:"b3geo041", author:"Trivia Bot", subject:"Geography", question:"What is the largest island in the Mediterranean Sea?", answer:"sicily", ts: Date.now()-DAY*872 },
  { id:"b3geo042", author:"Trivia Bot", subject:"Geography", question:"What is the tallest waterfall in the world?", answer:"angel falls", ts: Date.now()-DAY*871 },
  { id:"b3geo043", author:"Trivia Bot", subject:"Geography", question:"Which country is known as the Land of the Rising Sun?", answer:"japan", ts: Date.now()-DAY*870 },
  { id:"b3geo044", author:"Trivia Bot", subject:"Geography", question:"Which European country is shaped like a boot?", answer:"italy", ts: Date.now()-DAY*869 },
  { id:"b3geo045", author:"Trivia Bot", subject:"Geography", question:"In which US state is the Grand Canyon?", answer:"arizona", ts: Date.now()-DAY*868 },
  { id:"b3geo046", author:"Trivia Bot", subject:"Geography", question:"Which river forms much of the border between Texas and Mexico?", answer:"rio grande", ts: Date.now()-DAY*867 },
  { id:"b3geo047", author:"Trivia Bot", subject:"Geography", question:"Which Central American country is home to a famous canal linking the Atlantic and Pacific?", answer:"panama", ts: Date.now()-DAY*866 },
  { id:"b3geo048", author:"Trivia Bot", subject:"Geography", question:"Which sea separates southern Europe from northern Africa?", answer:"mediterranean", ts: Date.now()-DAY*865 },
  { id:"b3geo049", author:"Trivia Bot", subject:"Geography", question:"Which mountain range contains Mont Blanc?", answer:"alps", ts: Date.now()-DAY*864 },
  { id:"b3pop001", author:"Trivia Bot", subject:"Pop Culture", question:"Who directed the 1997 film Titanic?", answer:"james cameron", crewNote:"Full name required, matey!", ts: Date.now()-DAY*863 },
  { id:"b3pop002", author:"Trivia Bot", subject:"Pop Culture", question:"Who directed The Lord of the Rings film trilogy?", answer:"peter jackson", crewNote:"Full name required, matey!", ts: Date.now()-DAY*862 },
  { id:"b3pop003", author:"Trivia Bot", subject:"Pop Culture", question:"Who directed the 2010 film Inception?", answer:"christopher nolan", crewNote:"Full name required, matey!", ts: Date.now()-DAY*861 },
  { id:"b3pop004", author:"Trivia Bot", subject:"Pop Culture", question:"Who directed the 1960 thriller Psycho?", answer:"alfred hitchcock", crewNote:"Full name required, matey!", ts: Date.now()-DAY*860 },
  { id:"b3pop005", author:"Trivia Bot", subject:"Pop Culture", question:"Which actor played Captain Jack Sparrow in Pirates of the Caribbean?", answer:"johnny depp", crewNote:"Full name required, matey!", ts: Date.now()-DAY*859 },
  { id:"b3pop006", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of Captain Jack Sparrow's ship?", answer:"black pearl", ts: Date.now()-DAY*858 },
  { id:"b3pop007", author:"Trivia Bot", subject:"Pop Culture", question:"Which actress played Hermione Granger in the Harry Potter films?", answer:"emma watson", crewNote:"Full name required, matey!", ts: Date.now()-DAY*857 },
  { id:"b3pop008", author:"Trivia Bot", subject:"Pop Culture", question:"Which actor played Harry Potter in the film series?", answer:"daniel radcliffe", crewNote:"Full name required, matey!", ts: Date.now()-DAY*856 },
  { id:"b3pop009", author:"Trivia Bot", subject:"Pop Culture", question:"Which actor played Gandalf in the Lord of the Rings films?", answer:"ian mckellen", crewNote:"Full name required, matey!", ts: Date.now()-DAY*855 },
  { id:"b3pop010", author:"Trivia Bot", subject:"Pop Culture", question:"Which actor played Indiana Jones?", answer:"harrison ford", crewNote:"Full name required, matey!", ts: Date.now()-DAY*854 },
  { id:"b3pop011", author:"Trivia Bot", subject:"Pop Culture", question:"Which actor played Rocky Balboa?", answer:"sylvester stallone", crewNote:"Full name required, matey!", ts: Date.now()-DAY*853 },
  { id:"b3pop012", author:"Trivia Bot", subject:"Pop Culture", question:"Which actor played Captain America in the Marvel Cinematic Universe?", answer:"chris evans", crewNote:"Full name required, matey!", ts: Date.now()-DAY*852 },
  { id:"b3pop013", author:"Trivia Bot", subject:"Pop Culture", question:"Which actor played Thor in the Marvel Cinematic Universe?", answer:"chris hemsworth", crewNote:"Full name required, matey!", ts: Date.now()-DAY*851 },
  { id:"b3pop014", author:"Trivia Bot", subject:"Pop Culture", question:"Which actress played Black Widow in the Marvel Cinematic Universe?", answer:"scarlett johansson", crewNote:"Full name required, matey!", ts: Date.now()-DAY*850 },
  { id:"b3pop015", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of the space ranger toy in Toy Story?", answer:"buzz lightyear", crewNote:"Full name required, matey!", ts: Date.now()-DAY*849 },
  { id:"b3pop016", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of Nemo's father in Finding Nemo?", answer:"marlin", ts: Date.now()-DAY*848 },
  { id:"b3pop017", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of the forgetful blue tang fish in Finding Nemo?", answer:"dory", ts: Date.now()-DAY*847 },
  { id:"b3pop018", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of the snowman in Frozen?", answer:"olaf", ts: Date.now()-DAY*846 },
  { id:"b3pop019", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of the young lion who becomes king in The Lion King?", answer:"simba", ts: Date.now()-DAY*845 },
  { id:"b3pop020", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of the princess in Disney's Aladdin?", answer:"jasmine", ts: Date.now()-DAY*844 },
  { id:"b3pop021", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of the green ogre in a popular DreamWorks film series?", answer:"shrek", ts: Date.now()-DAY*843 },
  { id:"b3pop022", author:"Trivia Bot", subject:"Pop Culture", question:"In which fictional town do The Simpsons live?", answer:"springfield", ts: Date.now()-DAY*842 },
  { id:"b3pop023", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of Batman's fictional home city?", answer:"gotham", ts: Date.now()-DAY*841 },
  { id:"b3pop024", author:"Trivia Bot", subject:"Pop Culture", question:"Which sitcom features the character Sheldon Cooper?", answer:"the big bang theory", ts: Date.now()-DAY*840 },
  { id:"b3pop025", author:"Trivia Bot", subject:"Pop Culture", question:"Which sitcom follows Jerry, George, Elaine, and Kramer?", answer:"seinfeld", ts: Date.now()-DAY*839 },
  { id:"b3pop026", author:"Trivia Bot", subject:"Pop Culture", question:"Which sitcom features Ted Mosby telling his kids how he met their mother?", answer:"how i met your mother", ts: Date.now()-DAY*838 },
  { id:"b3pop027", author:"Trivia Bot", subject:"Pop Culture", question:"Which reality competition show features contestants being voted off the island?", answer:"survivor", ts: Date.now()-DAY*837 },
  { id:"b3pop028", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of the child character in The Mandalorian?", answer:"grogu", ts: Date.now()-DAY*836 },
  { id:"b3pop029", author:"Trivia Bot", subject:"Pop Culture", question:"Which actress plays Eleven in Stranger Things?", answer:"millie bobby brown", crewNote:"Full name required, matey!", ts: Date.now()-DAY*835 },
  { id:"b3pop030", author:"Trivia Bot", subject:"Pop Culture", question:"Which company created the Mario video game character?", answer:"nintendo", ts: Date.now()-DAY*834 },
  { id:"b3pop031", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of Mario's brother?", answer:"luigi", ts: Date.now()-DAY*833 },
  { id:"b3pop032", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of Ash's yellow electric mouse in Pokemon?", answer:"pikachu", ts: Date.now()-DAY*832 },
  { id:"b3pop033", author:"Trivia Bot", subject:"Pop Culture", question:"Which princess does Mario rescue from Bowser?", answer:"peach", ts: Date.now()-DAY*831 },
  { id:"b3pop034", author:"Trivia Bot", subject:"Pop Culture", question:"Which blue hedgehog is a famous video game mascot?", answer:"sonic", ts: Date.now()-DAY*830 },
  { id:"b3pop035", author:"Trivia Bot", subject:"Pop Culture", question:"In what year was the original Super Mario Bros. released?", answer:"1985", ts: Date.now()-DAY*829 },
  { id:"b3pop036", author:"Trivia Bot", subject:"Pop Culture", question:"What was the first full-length cel-animated Disney feature film, released in 1937?", answer:"snow white", ts: Date.now()-DAY*828 },
  { id:"b3pop037", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of the wooden puppet who wants to become a real boy?", answer:"pinocchio", ts: Date.now()-DAY*827 },
  { id:"b3pop038", author:"Trivia Bot", subject:"Pop Culture", question:"What is the name of Dorothy's dog in The Wizard of Oz?", answer:"toto", ts: Date.now()-DAY*826 },
  { id:"b3pop039", author:"Trivia Bot", subject:"Pop Culture", question:"Which actor played Wolverine in the X-Men films?", answer:"hugh jackman", crewNote:"Full name required, matey!", ts: Date.now()-DAY*825 },
  { id:"b3pop040", author:"Trivia Bot", subject:"Pop Culture", question:"Which actor played Tony Montana in the 1983 film Scarface?", answer:"al pacino", crewNote:"Full name required, matey!", ts: Date.now()-DAY*824 },
  { id:"b3pop041", author:"Trivia Bot", subject:"Pop Culture", question:"Which actor won an Oscar for playing the Joker in the 2019 film Joker?", answer:"joaquin phoenix", crewNote:"Full name required, matey!", ts: Date.now()-DAY*823 },
  { id:"b3spt001", author:"Trivia Bot", subject:"Sports", question:"Which NBA team did Kobe Bryant play for his entire career?", answer:"lakers", crewNote:"Team nickname is fine, matey!", ts: Date.now()-DAY*822 },
  { id:"b3spt002", author:"Trivia Bot", subject:"Sports", question:"Which NBA team did Michael Jordan win six championships with?", answer:"bulls", crewNote:"Team nickname is fine, matey!", ts: Date.now()-DAY*821 },
  { id:"b3spt003", author:"Trivia Bot", subject:"Sports", question:"Which NFL team plays its home games at Lambeau Field?", answer:"packers", crewNote:"Team nickname is fine, matey!", ts: Date.now()-DAY*820 },
  { id:"b3spt004", author:"Trivia Bot", subject:"Sports", question:"Which MLB team is nicknamed the Bronx Bombers?", answer:"yankees", crewNote:"Team nickname is fine, matey!", ts: Date.now()-DAY*819 },
  { id:"b3spt005", author:"Trivia Bot", subject:"Sports", question:"Which NHL franchise has won the most Stanley Cups?", answer:"canadiens", crewNote:"Team nickname is fine, matey!", ts: Date.now()-DAY*818 },
  { id:"b3spt006", author:"Trivia Bot", subject:"Sports", question:"Which golfer has won a record 18 major championships?", answer:"jack nicklaus", crewNote:"Full name required, matey!", ts: Date.now()-DAY*817 },
  { id:"b3spt007", author:"Trivia Bot", subject:"Sports", question:"Which country won the 2014 FIFA World Cup?", answer:"germany", ts: Date.now()-DAY*816 },
  { id:"b3spt008", author:"Trivia Bot", subject:"Sports", question:"Which country won the 2018 FIFA World Cup?", answer:"france", ts: Date.now()-DAY*815 },
  { id:"b3spt009", author:"Trivia Bot", subject:"Sports", question:"Which country won the 2010 FIFA World Cup?", answer:"spain", ts: Date.now()-DAY*814 },
  { id:"b3spt010", author:"Trivia Bot", subject:"Sports", question:"Which country won the 2022 FIFA World Cup?", answer:"argentina", ts: Date.now()-DAY*813 },
  { id:"b3spt011", author:"Trivia Bot", subject:"Sports", question:"Which city hosted the 2012 Summer Olympics?", answer:"london", ts: Date.now()-DAY*812 },
  { id:"b3spt012", author:"Trivia Bot", subject:"Sports", question:"Which city hosted the 2008 Summer Olympics?", answer:"beijing", ts: Date.now()-DAY*811 },
  { id:"b3spt013", author:"Trivia Bot", subject:"Sports", question:"Which city hosted the 2000 Summer Olympics?", answer:"sydney", ts: Date.now()-DAY*810 },
  { id:"b3spt014", author:"Trivia Bot", subject:"Sports", question:"Which city hosted the 1996 Summer Olympics?", answer:"atlanta", ts: Date.now()-DAY*809 },
  { id:"b3spt015", author:"Trivia Bot", subject:"Sports", question:"Which city hosted the 1992 Summer Olympics?", answer:"barcelona", ts: Date.now()-DAY*808 },
  { id:"b3spt016", author:"Trivia Bot", subject:"Sports", question:"Which city hosted the 1984 Summer Olympics?", answer:"los angeles", ts: Date.now()-DAY*807 },
  { id:"b3spt017", author:"Trivia Bot", subject:"Sports", question:"Who is the NBA's all-time leading scorer?", answer:"lebron james", crewNote:"Full name required, matey!", ts: Date.now()-DAY*806 },
  { id:"b3spt018", author:"Trivia Bot", subject:"Sports", question:"Who holds the MLB record for career home runs with 762?", answer:"barry bonds", crewNote:"Full name required, matey!", ts: Date.now()-DAY*805 },
  { id:"b3spt019", author:"Trivia Bot", subject:"Sports", question:"Who holds the NFL record for career touchdown passes?", answer:"tom brady", crewNote:"Full name required, matey!", ts: Date.now()-DAY*804 },
  { id:"b3spt020", author:"Trivia Bot", subject:"Sports", question:"Which swimmer has won 23 Olympic gold medals?", answer:"michael phelps", crewNote:"Full name required, matey!", ts: Date.now()-DAY*803 },
  { id:"b3spt021", author:"Trivia Bot", subject:"Sports", question:"Which American gymnast won four gold medals at the 2016 Rio Olympics?", answer:"simone biles", crewNote:"Full name required, matey!", ts: Date.now()-DAY*802 },
  { id:"b3spt022", author:"Trivia Bot", subject:"Sports", question:"Which tennis player won a record 14 French Open titles?", answer:"rafael nadal", crewNote:"Full name required, matey!", ts: Date.now()-DAY*801 },
  { id:"b3spt023", author:"Trivia Bot", subject:"Sports", question:"Which Brazilian soccer legend is nicknamed The King of Football?", answer:"pele", ts: Date.now()-DAY*800 },
  { id:"b3spt024", author:"Trivia Bot", subject:"Sports", question:"In which sport is the Ryder Cup contested?", answer:"golf", ts: Date.now()-DAY*799 },
  { id:"b3spt025", author:"Trivia Bot", subject:"Sports", question:"In which sport is the America's Cup contested?", answer:"sailing", ts: Date.now()-DAY*798 },
  { id:"b3spt026", author:"Trivia Bot", subject:"Sports", question:"In which sport is the Heisman Trophy awarded?", answer:"football", ts: Date.now()-DAY*797 },
  { id:"b3spt027", author:"Trivia Bot", subject:"Sports", question:"Which gymnastics apparatus features two handles on a leather-covered body?", answer:"pommel horse", ts: Date.now()-DAY*796 },
  { id:"b3spt028", author:"Trivia Bot", subject:"Sports", question:"What is the term for three consecutive strikes in bowling?", answer:"turkey", ts: Date.now()-DAY*795 },
  { id:"b3spt029", author:"Trivia Bot", subject:"Sports", question:"What is the golf term for one stroke under par on a hole?", answer:"birdie", ts: Date.now()-DAY*794 },
  { id:"b3spt030", author:"Trivia Bot", subject:"Sports", question:"What word is used for a score of zero in tennis?", answer:"love", ts: Date.now()-DAY*793 },
  { id:"b3spt031", author:"Trivia Bot", subject:"Sports", question:"How many points is a shot from beyond the arc worth in basketball?", answer:"3", ts: Date.now()-DAY*792 },
  { id:"b3spt032", author:"Trivia Bot", subject:"Sports", question:"How many minutes are in a regulation NFL game?", answer:"60", ts: Date.now()-DAY*791 },
  { id:"b3spt033", author:"Trivia Bot", subject:"Sports", question:"How many periods are in a regulation NHL game?", answer:"3", ts: Date.now()-DAY*790 },
  { id:"b3spt034", author:"Trivia Bot", subject:"Sports", question:"How many minutes are in a regulation NBA game?", answer:"48", ts: Date.now()-DAY*789 },
  { id:"b3spt035", author:"Trivia Bot", subject:"Sports", question:"How many yards long is an American football field between the goal lines?", answer:"100", ts: Date.now()-DAY*788 },
  { id:"b3spt036", author:"Trivia Bot", subject:"Sports", question:"How many yards must an offense gain for a first down in American football?", answer:"10", ts: Date.now()-DAY*787 },
  { id:"b3spt037", author:"Trivia Bot", subject:"Sports", question:"Which country is the birthplace of cricket?", answer:"england", ts: Date.now()-DAY*786 },
  { id:"b3lit001", author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel Jane Eyre?", answer:"charlotte bronte", crewNote:"Full name required, matey!", ts: Date.now()-DAY*785 },
  { id:"b3lit002", author:"Trivia Bot", subject:"Literature", question:"Who wrote The Lord of the Rings?", answer:"j r r tolkien", crewNote:"Full name required, matey!", ts: Date.now()-DAY*784 },
  { id:"b3lit003", author:"Trivia Bot", subject:"Literature", question:"Who wrote The Chronicles of Narnia?", answer:"c s lewis", crewNote:"Full name required, matey!", ts: Date.now()-DAY*783 },
  { id:"b3lit004", author:"Trivia Bot", subject:"Literature", question:"Who wrote the Harry Potter novels?", answer:"j k rowling", crewNote:"Full name required, matey!", ts: Date.now()-DAY*782 },
  { id:"b3lit005", author:"Trivia Bot", subject:"Literature", question:"Who wrote The Hunger Games?", answer:"suzanne collins", crewNote:"Full name required, matey!", ts: Date.now()-DAY*781 },
  { id:"b3lit006", author:"Trivia Bot", subject:"Literature", question:"Who wrote A Game of Thrones?", answer:"george r r martin", crewNote:"Full name required, matey!", ts: Date.now()-DAY*780 },
  { id:"b3lit007", author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel Lolita?", answer:"vladimir nabokov", crewNote:"Full name required, matey!", ts: Date.now()-DAY*779 },
  { id:"b3lit008", author:"Trivia Bot", subject:"Literature", question:"Who wrote Les Miserables?", answer:"victor hugo", crewNote:"Full name required, matey!", ts: Date.now()-DAY*778 },
  { id:"b3lit009", author:"Trivia Bot", subject:"Literature", question:"Who wrote The Count of Monte Cristo?", answer:"alexandre dumas", crewNote:"Full name required, matey!", ts: Date.now()-DAY*777 },
  { id:"b3lit010", author:"Trivia Bot", subject:"Literature", question:"Who wrote Around the World in Eighty Days?", answer:"jules verne", crewNote:"Full name required, matey!", ts: Date.now()-DAY*776 },
  { id:"b3lit011", author:"Trivia Bot", subject:"Literature", question:"Who wrote The War of the Worlds?", answer:"h g wells", crewNote:"Full name required, matey!", ts: Date.now()-DAY*775 },
  { id:"b3lit012", author:"Trivia Bot", subject:"Literature", question:"Who wrote Treasure Island?", answer:"robert louis stevenson", crewNote:"Full name required, matey!", ts: Date.now()-DAY*774 },
  { id:"b3lit013", author:"Trivia Bot", subject:"Literature", question:"What is the name of the one-legged pirate in Treasure Island?", answer:"long john silver", crewNote:"Full name required, matey!", ts: Date.now()-DAY*773 },
  { id:"b3lit014", author:"Trivia Bot", subject:"Literature", question:"What is the name of the pirate captain in Peter Pan?", answer:"captain hook", crewNote:"Include the title, matey!", ts: Date.now()-DAY*772 },
  { id:"b3lit015", author:"Trivia Bot", subject:"Literature", question:"Who wrote Gulliver's Travels?", answer:"jonathan swift", crewNote:"Full name required, matey!", ts: Date.now()-DAY*771 },
  { id:"b3lit016", author:"Trivia Bot", subject:"Literature", question:"Who wrote Robinson Crusoe?", answer:"daniel defoe", crewNote:"Full name required, matey!", ts: Date.now()-DAY*770 },
  { id:"b3lit017", author:"Trivia Bot", subject:"Literature", question:"Who wrote Fahrenheit 451?", answer:"ray bradbury", crewNote:"Full name required, matey!", ts: Date.now()-DAY*769 },
  { id:"b3lit018", author:"Trivia Bot", subject:"Literature", question:"Who wrote Slaughterhouse-Five?", answer:"kurt vonnegut", crewNote:"Full name required, matey!", ts: Date.now()-DAY*768 },
  { id:"b3lit019", author:"Trivia Bot", subject:"Literature", question:"Who wrote Of Mice and Men?", answer:"john steinbeck", crewNote:"Full name required, matey!", ts: Date.now()-DAY*767 },
  { id:"b3lit020", author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel Beloved?", answer:"toni morrison", crewNote:"Full name required, matey!", ts: Date.now()-DAY*766 },
  { id:"b3lit021", author:"Trivia Bot", subject:"Literature", question:"Who wrote The Color Purple?", answer:"alice walker", crewNote:"Full name required, matey!", ts: Date.now()-DAY*765 },
  { id:"b3lit022", author:"Trivia Bot", subject:"Literature", question:"Who wrote I Know Why the Caged Bird Sings?", answer:"maya angelou", crewNote:"Full name required, matey!", ts: Date.now()-DAY*764 },
  { id:"b3lit023", author:"Trivia Bot", subject:"Literature", question:"Who wrote The Handmaid's Tale?", answer:"margaret atwood", crewNote:"Full name required, matey!", ts: Date.now()-DAY*763 },
  { id:"b3lit024", author:"Trivia Bot", subject:"Literature", question:"Who wrote the Divine Comedy?", answer:"dante alighieri", crewNote:"Full name required, matey!", ts: Date.now()-DAY*762 },
  { id:"b3lit025", author:"Trivia Bot", subject:"Literature", question:"Who wrote the epic poem Paradise Lost?", answer:"john milton", crewNote:"Full name required, matey!", ts: Date.now()-DAY*761 },
  { id:"b3lit026", author:"Trivia Bot", subject:"Literature", question:"Who wrote the poem The Raven?", answer:"edgar allan poe", crewNote:"Full name required, matey!", ts: Date.now()-DAY*760 },
  { id:"b3lit027", author:"Trivia Bot", subject:"Literature", question:"Who wrote the poetry collection Leaves of Grass?", answer:"walt whitman", crewNote:"Full name required, matey!", ts: Date.now()-DAY*759 },
  { id:"b3lit028", author:"Trivia Bot", subject:"Literature", question:"Who wrote the poem The Waste Land?", answer:"t s eliot", crewNote:"Full name required, matey!", ts: Date.now()-DAY*758 },
  { id:"b3lit029", author:"Trivia Bot", subject:"Literature", question:"Which ancient Greek playwright wrote Oedipus Rex?", answer:"sophocles", ts: Date.now()-DAY*757 },
  { id:"b3lit030", author:"Trivia Bot", subject:"Literature", question:"Who wrote The Metamorphosis?", answer:"franz kafka", crewNote:"Full name required, matey!", ts: Date.now()-DAY*756 },
  { id:"b3lit031", author:"Trivia Bot", subject:"Literature", question:"Who wrote the novel The Stranger?", answer:"albert camus", crewNote:"Full name required, matey!", ts: Date.now()-DAY*755 },
  { id:"b3lit032", author:"Trivia Bot", subject:"Literature", question:"Who wrote Alice's Adventures in Wonderland under a pen name?", answer:"lewis carroll", crewNote:"Pen name required, matey!", ts: Date.now()-DAY*754 },
  { id:"b3lit033", author:"Trivia Bot", subject:"Literature", question:"Who wrote Charlie and the Chocolate Factory?", answer:"roald dahl", crewNote:"Full name required, matey!", ts: Date.now()-DAY*753 },
  { id:"b3lit034", author:"Trivia Bot", subject:"Literature", question:"Who wrote Where the Wild Things Are?", answer:"maurice sendak", crewNote:"Full name required, matey!", ts: Date.now()-DAY*752 },
  { id:"b3lit035", author:"Trivia Bot", subject:"Literature", question:"Who wrote The Cat in the Hat under a pen name?", answer:"dr seuss", crewNote:"Pen name required, matey!", ts: Date.now()-DAY*751 },
  { id:"b3lit036", author:"Trivia Bot", subject:"Literature", question:"Who wrote The Giving Tree?", answer:"shel silverstein", crewNote:"Full name required, matey!", ts: Date.now()-DAY*750 },
  { id:"b3lit037", author:"Trivia Bot", subject:"Literature", question:"In which Shakespeare play does the character Prospero appear?", answer:"the tempest", ts: Date.now()-DAY*749 },
  { id:"b3lit038", author:"Trivia Bot", subject:"Literature", question:"Which Shakespeare play features Lady Macbeth?", answer:"macbeth", ts: Date.now()-DAY*748 },
  { id:"b3mus001", author:"Trivia Bot", subject:"Music", question:"Who composed the ballet The Nutcracker?", answer:"tchaikovsky", crewNote:"Last name only, matey!", ts: Date.now()-DAY*747 },
  { id:"b3mus002", author:"Trivia Bot", subject:"Music", question:"Who composed the opera Carmen?", answer:"bizet", crewNote:"Last name only, matey!", ts: Date.now()-DAY*746 },
  { id:"b3mus003", author:"Trivia Bot", subject:"Music", question:"Who composed the orchestral piece Bolero?", answer:"ravel", crewNote:"Last name only, matey!", ts: Date.now()-DAY*745 },
  { id:"b3mus004", author:"Trivia Bot", subject:"Music", question:"Who composed The Rite of Spring?", answer:"stravinsky", crewNote:"Last name only, matey!", ts: Date.now()-DAY*744 },
  { id:"b3mus005", author:"Trivia Bot", subject:"Music", question:"Who composed the Brandenburg Concertos?", answer:"bach", crewNote:"Last name only, matey!", ts: Date.now()-DAY*743 },
  { id:"b3mus006", author:"Trivia Bot", subject:"Music", question:"Who composed Clair de Lune?", answer:"debussy", crewNote:"Last name only, matey!", ts: Date.now()-DAY*742 },
  { id:"b3mus007", author:"Trivia Bot", subject:"Music", question:"Who composed Rhapsody in Blue?", answer:"george gershwin", crewNote:"Full name required, matey!", ts: Date.now()-DAY*741 },
  { id:"b3mus008", author:"Trivia Bot", subject:"Music", question:"Who was the lead singer of The Police?", answer:"sting", ts: Date.now()-DAY*740 },
  { id:"b3mus009", author:"Trivia Bot", subject:"Music", question:"Who is the lead singer of Maroon 5?", answer:"adam levine", crewNote:"Full name required, matey!", ts: Date.now()-DAY*739 },
  { id:"b3mus010", author:"Trivia Bot", subject:"Music", question:"Who is the lead singer of Aerosmith?", answer:"steven tyler", crewNote:"Full name required, matey!", ts: Date.now()-DAY*738 },
  { id:"b3mus011", author:"Trivia Bot", subject:"Music", question:"Who is the lead singer of Metallica?", answer:"james hetfield", crewNote:"Full name required, matey!", ts: Date.now()-DAY*737 },
  { id:"b3mus012", author:"Trivia Bot", subject:"Music", question:"Who wrote and sang Like a Rolling Stone?", answer:"bob dylan", crewNote:"Full name required, matey!", ts: Date.now()-DAY*736 },
  { id:"b3mus013", author:"Trivia Bot", subject:"Music", question:"Which singer had a hit with Umbrella in 2007?", answer:"rihanna", ts: Date.now()-DAY*735 },
  { id:"b3mus014", author:"Trivia Bot", subject:"Music", question:"Which British singer released the album 21 featuring Rolling in the Deep?", answer:"adele", ts: Date.now()-DAY*734 },
  { id:"b3mus015", author:"Trivia Bot", subject:"Music", question:"Which singer released the 1984 album Purple Rain?", answer:"prince", ts: Date.now()-DAY*733 },
  { id:"b3mus016", author:"Trivia Bot", subject:"Music", question:"Which band recorded Hotel California?", answer:"eagles", ts: Date.now()-DAY*732 },
  { id:"b3mus017", author:"Trivia Bot", subject:"Music", question:"Which band recorded Smells Like Teen Spirit?", answer:"nirvana", ts: Date.now()-DAY*731 },
  { id:"b3mus018", author:"Trivia Bot", subject:"Music", question:"Which band recorded Sweet Child o' Mine?", answer:"guns n roses", ts: Date.now()-DAY*730 },
  { id:"b3mus019", author:"Trivia Bot", subject:"Music", question:"Which Australian band recorded Back in Black in 1980?", answer:"acdc", ts: Date.now()-DAY*729 },
  { id:"b3mus020", author:"Trivia Bot", subject:"Music", question:"Which rapper's real name is Marshall Mathers?", answer:"eminem", ts: Date.now()-DAY*728 },
  { id:"b3mus021", author:"Trivia Bot", subject:"Music", question:"Which rapper's real name is Shawn Carter?", answer:"jay z", ts: Date.now()-DAY*727 },
  { id:"b3mus022", author:"Trivia Bot", subject:"Music", question:"What is the stage name of Stefani Germanotta?", answer:"lady gaga", crewNote:"Full stage name, matey!", ts: Date.now()-DAY*726 },
  { id:"b3mus023", author:"Trivia Bot", subject:"Music", question:"Which stringed instrument is also called a fiddle?", answer:"violin", ts: Date.now()-DAY*725 },
  { id:"b3mus024", author:"Trivia Bot", subject:"Music", question:"Which large triangular-framed stringed instrument is plucked and associated with angels?", answer:"harp", ts: Date.now()-DAY*724 },
  { id:"b3mus025", author:"Trivia Bot", subject:"Music", question:"Which brass instrument is played with a slide?", answer:"trombone", ts: Date.now()-DAY*723 },
  { id:"b3mus026", author:"Trivia Bot", subject:"Music", question:"How many strings does a standard bass guitar have?", answer:"4", ts: Date.now()-DAY*722 },
  { id:"b3mus027", author:"Trivia Bot", subject:"Music", question:"What Italian musical term means very loud?", answer:"fortissimo", ts: Date.now()-DAY*721 },
  { id:"b3mus028", author:"Trivia Bot", subject:"Music", question:"What Italian musical term means smooth and connected?", answer:"legato", ts: Date.now()-DAY*720 },
  { id:"b3mus029", author:"Trivia Bot", subject:"Music", question:"What Italian musical term means short and detached?", answer:"staccato", ts: Date.now()-DAY*719 },
  { id:"b3mus030", author:"Trivia Bot", subject:"Music", question:"What is the name of the annual US music award shaped like a gramophone?", answer:"grammy", ts: Date.now()-DAY*718 },
  { id:"b3mus031", author:"Trivia Bot", subject:"Music", question:"Which singer was nicknamed Ol' Blue Eyes?", answer:"frank sinatra", crewNote:"Full name required, matey!", ts: Date.now()-DAY*717 },
  { id:"b3mus032", author:"Trivia Bot", subject:"Music", question:"Who is known as the Godfather of Soul?", answer:"james brown", crewNote:"Full name required, matey!", ts: Date.now()-DAY*716 },
  { id:"b3mus033", author:"Trivia Bot", subject:"Music", question:"Who sang the 1973 hit Piano Man?", answer:"billy joel", crewNote:"Full name required, matey!", ts: Date.now()-DAY*715 },
  { id:"b3mus034", author:"Trivia Bot", subject:"Music", question:"Who sang Rocket Man?", answer:"elton john", crewNote:"Full name required, matey!", ts: Date.now()-DAY*714 },
  { id:"b3mus035", author:"Trivia Bot", subject:"Music", question:"Which band is Dave Grohl the frontman of?", answer:"foo fighters", ts: Date.now()-DAY*713 },
  { id:"b3mus036", author:"Trivia Bot", subject:"Music", question:"Which band's lead singer is Brandon Flowers?", answer:"the killers", ts: Date.now()-DAY*712 },
  { id:"b3mus037", author:"Trivia Bot", subject:"Music", question:"In which English city were The Beatles formed?", answer:"liverpool", ts: Date.now()-DAY*711 },
  { id:"b3mus038", author:"Trivia Bot", subject:"Music", question:"In which Austrian city was Mozart born?", answer:"salzburg", ts: Date.now()-DAY*710 },
  { id:"b3mus039", author:"Trivia Bot", subject:"Music", question:"In which German city was Beethoven born?", answer:"bonn", ts: Date.now()-DAY*709 },
  { id:"b3mus040", author:"Trivia Bot", subject:"Music", question:"From which country was the composer Edvard Grieg?", answer:"norway", ts: Date.now()-DAY*708 },
  { id:"b3mus041", author:"Trivia Bot", subject:"Music", question:"From which country was the composer Jean Sibelius?", answer:"finland", ts: Date.now()-DAY*707 },
  { id:"b3tec001", author:"Trivia Bot", subject:"Technology", question:"Who founded Amazon in 1994?", answer:"jeff bezos", crewNote:"Full name required, matey!", ts: Date.now()-DAY*706 },
  { id:"b3tec002", author:"Trivia Bot", subject:"Technology", question:"Who co-founded Google with Larry Page?", answer:"sergey brin", crewNote:"Full name required, matey!", ts: Date.now()-DAY*705 },
  { id:"b3tec003", author:"Trivia Bot", subject:"Technology", question:"Who founded Facebook?", answer:"mark zuckerberg", crewNote:"Full name required, matey!", ts: Date.now()-DAY*704 },
  { id:"b3tec004", author:"Trivia Bot", subject:"Technology", question:"What does GUI stand for in computing?", answer:"graphical user interface", ts: Date.now()-DAY*703 },
  { id:"b3tec005", author:"Trivia Bot", subject:"Technology", question:"What does LAN stand for in networking?", answer:"local area network", ts: Date.now()-DAY*702 },
  { id:"b3tec006", author:"Trivia Bot", subject:"Technology", question:"What does ROM stand for in computing?", answer:"read only memory", ts: Date.now()-DAY*701 },
  { id:"b3tec007", author:"Trivia Bot", subject:"Technology", question:"What does ISP stand for?", answer:"internet service provider", ts: Date.now()-DAY*700 },
  { id:"b3tec008", author:"Trivia Bot", subject:"Technology", question:"What does DNS stand for in internet technology?", answer:"domain name system", ts: Date.now()-DAY*699 },
  { id:"b3tec009", author:"Trivia Bot", subject:"Technology", question:"What does LED stand for?", answer:"light emitting diode", ts: Date.now()-DAY*698 },
  { id:"b3tec010", author:"Trivia Bot", subject:"Technology", question:"What does IoT stand for?", answer:"internet of things", ts: Date.now()-DAY*697 },
  { id:"b3tec011", author:"Trivia Bot", subject:"Technology", question:"What do the letters QR stand for in QR code?", answer:"quick response", ts: Date.now()-DAY*696 },
  { id:"b3tec012", author:"Trivia Bot", subject:"Technology", question:"What does JPEG stand for?", answer:"joint photographic experts group", ts: Date.now()-DAY*695 },
  { id:"b3tec013", author:"Trivia Bot", subject:"Technology", question:"What does SMS stand for?", answer:"short message service", ts: Date.now()-DAY*694 },
  { id:"b3tec014", author:"Trivia Bot", subject:"Technology", question:"What does GIF stand for?", answer:"graphics interchange format", ts: Date.now()-DAY*693 },
  { id:"b3tec015", author:"Trivia Bot", subject:"Technology", question:"What does PIN stand for in PIN code?", answer:"personal identification number", ts: Date.now()-DAY*692 },
  { id:"b3tec016", author:"Trivia Bot", subject:"Technology", question:"What does VR stand for in technology?", answer:"virtual reality", ts: Date.now()-DAY*691 },
  { id:"b3tec017", author:"Trivia Bot", subject:"Technology", question:"What is the name of Apple's voice assistant?", answer:"siri", ts: Date.now()-DAY*690 },
  { id:"b3tec018", author:"Trivia Bot", subject:"Technology", question:"What is the name of Microsoft's search engine?", answer:"bing", ts: Date.now()-DAY*689 },
  { id:"b3tec019", author:"Trivia Bot", subject:"Technology", question:"In what year was the first iPad released?", answer:"2010", ts: Date.now()-DAY*688 },
  { id:"b3tec020", author:"Trivia Bot", subject:"Technology", question:"In what year was Google founded?", answer:"1998", ts: Date.now()-DAY*687 },
  { id:"b3tec021", author:"Trivia Bot", subject:"Technology", question:"In what year was Amazon founded?", answer:"1994", ts: Date.now()-DAY*686 },
  { id:"b3tec022", author:"Trivia Bot", subject:"Technology", question:"In what year was Apple founded?", answer:"1976", ts: Date.now()-DAY*685 },
  { id:"b3tec023", author:"Trivia Bot", subject:"Technology", question:"In what year was YouTube founded?", answer:"2005", ts: Date.now()-DAY*684 },
  { id:"b3tec024", author:"Trivia Bot", subject:"Technology", question:"What was the name of the first general-purpose electronic computer, completed in 1945?", answer:"eniac", ts: Date.now()-DAY*683 },
  { id:"b3tec025", author:"Trivia Bot", subject:"Technology", question:"Who is considered the first computer programmer for her work on Babbage's Analytical Engine?", answer:"ada lovelace", crewNote:"Full name required, matey!", ts: Date.now()-DAY*682 },
  { id:"b3tec026", author:"Trivia Bot", subject:"Technology", question:"Who designed the Analytical Engine, an early mechanical computer?", answer:"charles babbage", crewNote:"Full name required, matey!", ts: Date.now()-DAY*681 },
  { id:"b3tec027", author:"Trivia Bot", subject:"Technology", question:"Who proposed the famous test for machine intelligence named after him?", answer:"alan turing", crewNote:"Full name required, matey!", ts: Date.now()-DAY*680 },
  { id:"b3tec028", author:"Trivia Bot", subject:"Technology", question:"What programming language did Brendan Eich create in 1995?", answer:"javascript", ts: Date.now()-DAY*679 },
  { id:"b3tec029", author:"Trivia Bot", subject:"Technology", question:"What programming language did Apple introduce in 2014 for iOS and macOS development?", answer:"swift", ts: Date.now()-DAY*678 },
  { id:"b3tec030", author:"Trivia Bot", subject:"Technology", question:"What version control system did Linus Torvalds create?", answer:"git", ts: Date.now()-DAY*677 },
  { id:"b3tec031", author:"Trivia Bot", subject:"Technology", question:"What is the name of OpenAI's popular chatbot launched in 2022?", answer:"chatgpt", ts: Date.now()-DAY*676 },
  { id:"b3tec032", author:"Trivia Bot", subject:"Technology", question:"What cryptocurrency was created by the pseudonymous Satoshi Nakamoto?", answer:"bitcoin", ts: Date.now()-DAY*675 },
  { id:"b3tec033", author:"Trivia Bot", subject:"Technology", question:"What is the smallest unit of data in computing?", answer:"bit", ts: Date.now()-DAY*674 },
  { id:"b3tec034", author:"Trivia Bot", subject:"Technology", question:"How many bits are in a byte?", answer:"8", ts: Date.now()-DAY*673 },
  { id:"b3fin001", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Nvidia?", answer:"nvda", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*672 },
  { id:"b3fin002", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Meta Platforms?", answer:"meta", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*671 },
  { id:"b3fin003", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Netflix?", answer:"nflx", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*670 },
  { id:"b3fin004", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Walmart?", answer:"wmt", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*669 },
  { id:"b3fin005", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Coca-Cola?", answer:"ko", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*668 },
  { id:"b3fin006", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Disney?", answer:"dis", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*667 },
  { id:"b3fin007", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Exxon Mobil?", answer:"xom", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*666 },
  { id:"b3fin008", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for JPMorgan Chase?", answer:"jpm", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*665 },
  { id:"b3fin009", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for McDonald's?", answer:"mcd", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*664 },
  { id:"b3fin010", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Nike?", answer:"nke", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*663 },
  { id:"b3fin011", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Starbucks?", answer:"sbux", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*662 },
  { id:"b3fin012", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Intel?", answer:"intc", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*661 },
  { id:"b3fin013", author:"Trivia Bot", subject:"Finance", question:"What is the stock ticker symbol for Boeing?", answer:"ba", crewNote:"Stock ticker symbol required, matey!", ts: Date.now()-DAY*660 },
  { id:"b3fin014", author:"Trivia Bot", subject:"Finance", question:"What does CEO stand for?", answer:"chief executive officer", ts: Date.now()-DAY*659 },
  { id:"b3fin015", author:"Trivia Bot", subject:"Finance", question:"What does GDP stand for in economics?", answer:"gross domestic product", ts: Date.now()-DAY*658 },
  { id:"b3fin016", author:"Trivia Bot", subject:"Finance", question:"What does APR stand for on a loan or credit card?", answer:"annual percentage rate", ts: Date.now()-DAY*657 },
  { id:"b3fin017", author:"Trivia Bot", subject:"Finance", question:"What does IRA stand for in retirement savings?", answer:"individual retirement account", ts: Date.now()-DAY*656 },
  { id:"b3fin018", author:"Trivia Bot", subject:"Finance", question:"What is the name of the popular employer-sponsored US retirement plan named after a tax code section?", answer:"401k", ts: Date.now()-DAY*655 },
  { id:"b3fin019", author:"Trivia Bot", subject:"Finance", question:"What does SEC stand for in US financial regulation?", answer:"securities and exchange commission", ts: Date.now()-DAY*654 },
  { id:"b3fin020", author:"Trivia Bot", subject:"Finance", question:"What does NYSE stand for?", answer:"new york stock exchange", ts: Date.now()-DAY*653 },
  { id:"b3fin021", author:"Trivia Bot", subject:"Finance", question:"What does CPI stand for in economics?", answer:"consumer price index", ts: Date.now()-DAY*652 },
  { id:"b3fin022", author:"Trivia Bot", subject:"Finance", question:"What does FOMC stand for at the Federal Reserve?", answer:"federal open market committee", ts: Date.now()-DAY*651 },
  { id:"b3fin023", author:"Trivia Bot", subject:"Finance", question:"What is the official currency of Japan?", answer:"yen", ts: Date.now()-DAY*650 },
  { id:"b3fin024", author:"Trivia Bot", subject:"Finance", question:"What currency is used by most countries in the Eurozone?", answer:"euro", ts: Date.now()-DAY*649 },
  { id:"b3fin025", author:"Trivia Bot", subject:"Finance", question:"What is the official currency of the United Kingdom?", answer:"pound", ts: Date.now()-DAY*648 },
  { id:"b3fin026", author:"Trivia Bot", subject:"Finance", question:"What is the official currency of Switzerland?", answer:"franc", ts: Date.now()-DAY*647 },
  { id:"b3fin027", author:"Trivia Bot", subject:"Finance", question:"What is the official currency of India?", answer:"rupee", ts: Date.now()-DAY*646 },
  { id:"b3fin028", author:"Trivia Bot", subject:"Finance", question:"What is the official currency of Mexico?", answer:"peso", ts: Date.now()-DAY*645 },
  { id:"b3fin029", author:"Trivia Bot", subject:"Finance", question:"What is the official currency of Russia?", answer:"ruble", ts: Date.now()-DAY*644 },
  { id:"b3fin030", author:"Trivia Bot", subject:"Finance", question:"What is the official currency of South Korea?", answer:"won", ts: Date.now()-DAY*643 },
  { id:"b3fin031", author:"Trivia Bot", subject:"Finance", question:"What is the official currency of Brazil?", answer:"real", ts: Date.now()-DAY*642 },
  { id:"b3fin032", author:"Trivia Bot", subject:"Finance", question:"What is the basic unit of China's currency, the renminbi?", answer:"yuan", ts: Date.now()-DAY*641 },
  { id:"b3fin033", author:"Trivia Bot", subject:"Finance", question:"Whose portrait appears on the US one-dollar bill?", answer:"george washington", crewNote:"Full name required, matey!", ts: Date.now()-DAY*640 },
  { id:"b3fin034", author:"Trivia Bot", subject:"Finance", question:"Whose portrait appears on the US five-dollar bill?", answer:"abraham lincoln", crewNote:"Full name required, matey!", ts: Date.now()-DAY*639 },
  { id:"b3fin035", author:"Trivia Bot", subject:"Finance", question:"Whose portrait appears on the US ten-dollar bill?", answer:"alexander hamilton", crewNote:"Full name required, matey!", ts: Date.now()-DAY*638 },
  { id:"b3fin036", author:"Trivia Bot", subject:"Finance", question:"Whose portrait appears on the US twenty-dollar bill?", answer:"andrew jackson", crewNote:"Full name required, matey!", ts: Date.now()-DAY*637 },
  { id:"b3fin037", author:"Trivia Bot", subject:"Finance", question:"Whose portrait appears on the US fifty-dollar bill?", answer:"ulysses s grant", crewNote:"Full name required, matey!", ts: Date.now()-DAY*636 },
  { id:"b3fin038", author:"Trivia Bot", subject:"Finance", question:"Whose portrait appears on the US one-hundred-dollar bill?", answer:"benjamin franklin", crewNote:"Full name required, matey!", ts: Date.now()-DAY*635 },
  { id:"b3fin039", author:"Trivia Bot", subject:"Finance", question:"In what year did the Black Monday stock market crash occur?", answer:"1987", ts: Date.now()-DAY*634 },
  { id:"b3fin040", author:"Trivia Bot", subject:"Finance", question:"In what year did Lehman Brothers collapse?", answer:"2008", ts: Date.now()-DAY*633 },
  { id:"b3fin041", author:"Trivia Bot", subject:"Finance", question:"What is the name of the New York street that is the heart of the US financial district?", answer:"wall street", ts: Date.now()-DAY*632 },
  { id:"b3fod001", author:"Trivia Bot", subject:"Food & Drink", question:"What cheese is traditionally used on a Margherita pizza?", answer:"mozzarella", ts: Date.now()-DAY*631 },
  { id:"b3fod002", author:"Trivia Bot", subject:"Food & Drink", question:"What is the main ingredient in traditional pesto sauce?", answer:"basil", ts: Date.now()-DAY*630 },
  { id:"b3fod003", author:"Trivia Bot", subject:"Food & Drink", question:"What Italian hard cheese is named after the city of Parma?", answer:"parmesan", ts: Date.now()-DAY*629 },
  { id:"b3fod004", author:"Trivia Bot", subject:"Food & Drink", question:"What fruit is a key ingredient in a classic Waldorf salad?", answer:"apple", ts: Date.now()-DAY*628 },
  { id:"b3fod005", author:"Trivia Bot", subject:"Food & Drink", question:"What is tofu made from?", answer:"soybeans", ts: Date.now()-DAY*627 },
  { id:"b3fod006", author:"Trivia Bot", subject:"Food & Drink", question:"What is the national dish of Scotland, made from sheep offal?", answer:"haggis", ts: Date.now()-DAY*626 },
  { id:"b3fod007", author:"Trivia Bot", subject:"Food & Drink", question:"What leafy green is the main ingredient in saag paneer?", answer:"spinach", ts: Date.now()-DAY*625 },
  { id:"b3fod008", author:"Trivia Bot", subject:"Food & Drink", question:"What is the name of the cold Spanish tomato soup?", answer:"gazpacho", ts: Date.now()-DAY*624 },
  { id:"b3fod009", author:"Trivia Bot", subject:"Food & Drink", question:"What French dish is a stewed vegetable medley from Provence?", answer:"ratatouille", ts: Date.now()-DAY*623 },
  { id:"b3fod010", author:"Trivia Bot", subject:"Food & Drink", question:"What is the traditional braided Jewish bread called?", answer:"challah", ts: Date.now()-DAY*622 },
  { id:"b3fod011", author:"Trivia Bot", subject:"Food & Drink", question:"What is the name of the Indian flatbread traditionally baked in a tandoor?", answer:"naan", ts: Date.now()-DAY*621 },
  { id:"b3fod012", author:"Trivia Bot", subject:"Food & Drink", question:"What Japanese noodle soup is often topped with pork and a soft-boiled egg?", answer:"ramen", ts: Date.now()-DAY*620 },
  { id:"b3fod013", author:"Trivia Bot", subject:"Food & Drink", question:"What dairy product is the main ingredient in tzatziki?", answer:"yogurt", ts: Date.now()-DAY*619 },
  { id:"b3fod014", author:"Trivia Bot", subject:"Food & Drink", question:"What Italian dessert's name means cooked cream?", answer:"panna cotta", ts: Date.now()-DAY*618 },
  { id:"b3fod015", author:"Trivia Bot", subject:"Food & Drink", question:"What is Italian-style ice cream called?", answer:"gelato", ts: Date.now()-DAY*617 },
  { id:"b3fod016", author:"Trivia Bot", subject:"Food & Drink", question:"What spirit is the base of a mojito?", answer:"rum", ts: Date.now()-DAY*616 },
  { id:"b3fod017", author:"Trivia Bot", subject:"Food & Drink", question:"What spirit is the base of a Moscow Mule?", answer:"vodka", ts: Date.now()-DAY*615 },
  { id:"b3fod018", author:"Trivia Bot", subject:"Food & Drink", question:"What fermented tea drink is made using a SCOBY?", answer:"kombucha", ts: Date.now()-DAY*614 },
  { id:"b3fod019", author:"Trivia Bot", subject:"Food & Drink", question:"What finely ground green tea powder is used in Japanese tea ceremonies?", answer:"matcha", ts: Date.now()-DAY*613 },
  { id:"b3fod020", author:"Trivia Bot", subject:"Food & Drink", question:"What fruit is a prune dried from?", answer:"plum", ts: Date.now()-DAY*612 },
  { id:"b3fod021", author:"Trivia Bot", subject:"Food & Drink", question:"What nut is traditionally used in pesto?", answer:"pine nut", ts: Date.now()-DAY*611 },
  { id:"b3fod022", author:"Trivia Bot", subject:"Food & Drink", question:"What French pastry is filled with cream and topped with chocolate icing?", answer:"eclair", ts: Date.now()-DAY*610 },
  { id:"b3fod023", author:"Trivia Bot", subject:"Food & Drink", question:"What is the name of the thin French pancake?", answer:"crepe", ts: Date.now()-DAY*609 },
  { id:"b3fod024", author:"Trivia Bot", subject:"Food & Drink", question:"What type of plant do vanilla beans come from?", answer:"orchid", ts: Date.now()-DAY*608 },
  { id:"b3fod025", author:"Trivia Bot", subject:"Food & Drink", question:"Which fruit is called the king of fruits in Southeast Asia?", answer:"durian", ts: Date.now()-DAY*607 },
  { id:"b3fod026", author:"Trivia Bot", subject:"Food & Drink", question:"What Italian coffee drink's name means marked or stained?", answer:"macchiato", ts: Date.now()-DAY*606 },
  { id:"b3fod027", author:"Trivia Bot", subject:"Food & Drink", question:"What alcoholic drink is made by fermenting honey?", answer:"mead", ts: Date.now()-DAY*605 },
  { id:"b3fod028", author:"Trivia Bot", subject:"Food & Drink", question:"What grain is the main ingredient in Scotch whisky?", answer:"barley", ts: Date.now()-DAY*604 },
  { id:"b3fod029", author:"Trivia Bot", subject:"Food & Drink", question:"What pasta's name means little worms?", answer:"vermicelli", ts: Date.now()-DAY*603 },
  { id:"b3fod030", author:"Trivia Bot", subject:"Food & Drink", question:"What pasta's name means little tongues?", answer:"linguine", ts: Date.now()-DAY*602 },
  { id:"b3fod031", author:"Trivia Bot", subject:"Food & Drink", question:"What Hawaiian dish consists of cubed raw fish?", answer:"poke", ts: Date.now()-DAY*601 },
  { id:"b3fod032", author:"Trivia Bot", subject:"Food & Drink", question:"What Middle Eastern paste made from ground sesame seeds is used in hummus?", answer:"tahini", ts: Date.now()-DAY*600 },
  { id:"b3art001", author:"Trivia Bot", subject:"Art", question:"Which Spanish surrealist painted The Persistence of Memory?", answer:"salvador dali", crewNote:"Full name required, matey!", ts: Date.now()-DAY*599 },
  { id:"b3art002", author:"Trivia Bot", subject:"Art", question:"Who painted The Birth of Venus?", answer:"sandro botticelli", crewNote:"Full name required, matey!", ts: Date.now()-DAY*598 },
  { id:"b3art003", author:"Trivia Bot", subject:"Art", question:"Who painted The Night Watch?", answer:"rembrandt", ts: Date.now()-DAY*597 },
  { id:"b3art004", author:"Trivia Bot", subject:"Art", question:"Who painted The Garden of Earthly Delights?", answer:"hieronymus bosch", crewNote:"Full name required, matey!", ts: Date.now()-DAY*596 },
  { id:"b3art005", author:"Trivia Bot", subject:"Art", question:"Who painted Las Meninas?", answer:"diego velazquez", crewNote:"Full name required, matey!", ts: Date.now()-DAY*595 },
  { id:"b3art006", author:"Trivia Bot", subject:"Art", question:"Who painted The Kiss, famous for its gold leaf, in 1907?", answer:"gustav klimt", crewNote:"Full name required, matey!", ts: Date.now()-DAY*594 },
  { id:"b3art007", author:"Trivia Bot", subject:"Art", question:"Who painted the Water Lilies series?", answer:"claude monet", crewNote:"Full name required, matey!", ts: Date.now()-DAY*593 },
  { id:"b3art008", author:"Trivia Bot", subject:"Art", question:"Which Japanese artist created The Great Wave off Kanagawa?", answer:"hokusai", ts: Date.now()-DAY*592 },
  { id:"b3art009", author:"Trivia Bot", subject:"Art", question:"Who painted American Gothic?", answer:"grant wood", crewNote:"Full name required, matey!", ts: Date.now()-DAY*591 },
  { id:"b3art010", author:"Trivia Bot", subject:"Art", question:"Who painted Nighthawks?", answer:"edward hopper", crewNote:"Full name required, matey!", ts: Date.now()-DAY*590 },
  { id:"b3art011", author:"Trivia Bot", subject:"Art", question:"Which anonymous street artist created Girl with Balloon?", answer:"banksy", ts: Date.now()-DAY*589 },
  { id:"b3art012", author:"Trivia Bot", subject:"Art", question:"Who sculpted The Thinker?", answer:"auguste rodin", crewNote:"Full name required, matey!", ts: Date.now()-DAY*588 },
  { id:"b3art013", author:"Trivia Bot", subject:"Art", question:"In which city is the Prado Museum?", answer:"madrid", ts: Date.now()-DAY*587 },
  { id:"b3art014", author:"Trivia Bot", subject:"Art", question:"In which city is the Uffizi Gallery?", answer:"florence", ts: Date.now()-DAY*586 },
  { id:"b3art015", author:"Trivia Bot", subject:"Art", question:"In which city is the Rijksmuseum?", answer:"amsterdam", ts: Date.now()-DAY*585 },
  { id:"b3art016", author:"Trivia Bot", subject:"Art", question:"In which Russian city is the Hermitage Museum?", answer:"saint petersburg", ts: Date.now()-DAY*584 },
  { id:"b3art017", author:"Trivia Bot", subject:"Art", question:"What color is made by mixing blue and yellow paint?", answer:"green", ts: Date.now()-DAY*583 },
  { id:"b3art018", author:"Trivia Bot", subject:"Art", question:"Which art movement is Claude Monet associated with?", answer:"impressionism", ts: Date.now()-DAY*582 },
  { id:"b3art019", author:"Trivia Bot", subject:"Art", question:"Which art movement is Andy Warhol associated with?", answer:"pop art", ts: Date.now()-DAY*581 },
  { id:"b3art020", author:"Trivia Bot", subject:"Art", question:"Who painted Composition with Red, Blue and Yellow?", answer:"piet mondrian", crewNote:"Full name required, matey!", ts: Date.now()-DAY*580 },
  { id:"b3art021", author:"Trivia Bot", subject:"Art", question:"Which American painter is famous for his drip paintings?", answer:"jackson pollock", crewNote:"Full name required, matey!", ts: Date.now()-DAY*579 },
  { id:"b3art022", author:"Trivia Bot", subject:"Art", question:"Which Mexican muralist painted Man at the Crossroads?", answer:"diego rivera", crewNote:"Full name required, matey!", ts: Date.now()-DAY*578 },
  { id:"b3art023", author:"Trivia Bot", subject:"Art", question:"Who painted The Arnolfini Portrait?", answer:"jan van eyck", crewNote:"Full name required, matey!", ts: Date.now()-DAY*577 },
  { id:"b3art024", author:"Trivia Bot", subject:"Art", question:"Who painted The Hay Wain?", answer:"john constable", crewNote:"Full name required, matey!", ts: Date.now()-DAY*576 },
  { id:"b3art025", author:"Trivia Bot", subject:"Art", question:"What stone was used for Michelangelo's David?", answer:"marble", ts: Date.now()-DAY*575 },
  { id:"b3art026", author:"Trivia Bot", subject:"Art", question:"What is the art of beautiful handwriting called?", answer:"calligraphy", ts: Date.now()-DAY*574 },
  { id:"b3art027", author:"Trivia Bot", subject:"Art", question:"What is the Japanese art of flower arranging called?", answer:"ikebana", ts: Date.now()-DAY*573 },
  { id:"b3art028", author:"Trivia Bot", subject:"Art", question:"What is a painting of inanimate objects such as fruit and flowers called?", answer:"still life", ts: Date.now()-DAY*572 },
  { id:"b3art029", author:"Trivia Bot", subject:"Art", question:"What type of paint uses egg yolk as a binder?", answer:"tempera", ts: Date.now()-DAY*571 },
  { id:"b3art030", author:"Trivia Bot", subject:"Art", question:"What type of painting uses transparent water-based pigments on paper?", answer:"watercolor", ts: Date.now()-DAY*570 },
  { id:"b3mat001", author:"Trivia Bot", subject:"Math", question:"What is the Roman numeral for 100?", answer:"c", ts: Date.now()-DAY*569 },
  { id:"b3mat002", author:"Trivia Bot", subject:"Math", question:"What is the Roman numeral for 500?", answer:"d", ts: Date.now()-DAY*568 },
  { id:"b3mat003", author:"Trivia Bot", subject:"Math", question:"What is the Roman numeral for 1000?", answer:"m", ts: Date.now()-DAY*567 },
  { id:"b3mat004", author:"Trivia Bot", subject:"Math", question:"What is the Roman numeral for 9?", answer:"ix", ts: Date.now()-DAY*566 },
  { id:"b3mat005", author:"Trivia Bot", subject:"Math", question:"What is the square root of 81?", answer:"9", ts: Date.now()-DAY*565 },
  { id:"b3mat006", author:"Trivia Bot", subject:"Math", question:"What is the square root of 169?", answer:"13", ts: Date.now()-DAY*564 },
  { id:"b3mat007", author:"Trivia Bot", subject:"Math", question:"What is the square root of 225?", answer:"15", ts: Date.now()-DAY*563 },
  { id:"b3mat008", author:"Trivia Bot", subject:"Math", question:"What is 9 multiplied by 9?", answer:"81", ts: Date.now()-DAY*562 },
  { id:"b3mat009", author:"Trivia Bot", subject:"Math", question:"What is 11 multiplied by 11?", answer:"121", ts: Date.now()-DAY*561 },
  { id:"b3mat010", author:"Trivia Bot", subject:"Math", question:"What is 13 multiplied by 7?", answer:"91", ts: Date.now()-DAY*560 },
  { id:"b3mat011", author:"Trivia Bot", subject:"Math", question:"What is 15 multiplied by 15?", answer:"225", ts: Date.now()-DAY*559 },
  { id:"b3mat012", author:"Trivia Bot", subject:"Math", question:"What is 8 multiplied by 12?", answer:"96", ts: Date.now()-DAY*558 },
  { id:"b3mat013", author:"Trivia Bot", subject:"Math", question:"What is 6 multiplied by 9?", answer:"54", ts: Date.now()-DAY*557 },
  { id:"b3mat014", author:"Trivia Bot", subject:"Math", question:"What is 2 to the power of 10?", answer:"1024", ts: Date.now()-DAY*556 },
  { id:"b3mat015", author:"Trivia Bot", subject:"Math", question:"What is 3 cubed?", answer:"27", ts: Date.now()-DAY*555 },
  { id:"b3mat016", author:"Trivia Bot", subject:"Math", question:"What is 5 factorial?", answer:"120", ts: Date.now()-DAY*554 },
  { id:"b3mat017", author:"Trivia Bot", subject:"Math", question:"What is 10 percent of 350?", answer:"35", ts: Date.now()-DAY*553 },
  { id:"b3mat018", author:"Trivia Bot", subject:"Math", question:"What is 25 percent of 80?", answer:"20", ts: Date.now()-DAY*552 },
  { id:"b3mat019", author:"Trivia Bot", subject:"Math", question:"What is 50 percent of 150?", answer:"75", ts: Date.now()-DAY*551 },
  { id:"b3mat020", author:"Trivia Bot", subject:"Math", question:"What is the next prime number after 7?", answer:"11", ts: Date.now()-DAY*550 },
  { id:"b3mat021", author:"Trivia Bot", subject:"Math", question:"How many sides does a pentagon have?", answer:"5", ts: Date.now()-DAY*549 },
  { id:"b3mat022", author:"Trivia Bot", subject:"Math", question:"How many sides does a heptagon have?", answer:"7", ts: Date.now()-DAY*548 },
  { id:"b3mat023", author:"Trivia Bot", subject:"Math", question:"How many sides does a decagon have?", answer:"10", ts: Date.now()-DAY*547 },
  { id:"b3mat024", author:"Trivia Bot", subject:"Math", question:"How many degrees are in a full circle?", answer:"360", ts: Date.now()-DAY*546 },
  { id:"b3mat025", author:"Trivia Bot", subject:"Math", question:"What do you call a triangle with three equal sides?", answer:"equilateral", ts: Date.now()-DAY*545 },
  { id:"b3mat026", author:"Trivia Bot", subject:"Math", question:"What do you call a triangle with exactly two equal sides?", answer:"isosceles", ts: Date.now()-DAY*544 },
  { id:"b3mat027", author:"Trivia Bot", subject:"Math", question:"What do you call a triangle with no equal sides?", answer:"scalene", ts: Date.now()-DAY*543 },
  { id:"b3mat028", author:"Trivia Bot", subject:"Math", question:"What is the longest side of a right triangle called?", answer:"hypotenuse", ts: Date.now()-DAY*542 },
  { id:"b3mat029", author:"Trivia Bot", subject:"Math", question:"What is the distance around a circle called?", answer:"circumference", ts: Date.now()-DAY*541 },
  { id:"b3mat030", author:"Trivia Bot", subject:"Math", question:"What is the distance from the center of a circle to its edge called?", answer:"radius", ts: Date.now()-DAY*540 },
  { id:"b3mat031", author:"Trivia Bot", subject:"Math", question:"What do you call a number divisible only by 1 and itself?", answer:"prime", ts: Date.now()-DAY*539 },
  { id:"b3mat032", author:"Trivia Bot", subject:"Math", question:"What is the result of a division problem called?", answer:"quotient", ts: Date.now()-DAY*538 },
  { id:"b3mat033", author:"Trivia Bot", subject:"Math", question:"What is the middle value in a sorted list of numbers called?", answer:"median", ts: Date.now()-DAY*537 },
  { id:"b3mat034", author:"Trivia Bot", subject:"Math", question:"What is the most frequently occurring value in a data set called?", answer:"mode", ts: Date.now()-DAY*536 },
  { id:"b3mat035", author:"Trivia Bot", subject:"Math", question:"What Greek mathematician wrote the Elements, the foundation of geometry?", answer:"euclid", ts: Date.now()-DAY*535 },
  { id:"b3mat036", author:"Trivia Bot", subject:"Math", question:"What is the next number in the sequence 1, 1, 2, 3, 5, 8?", answer:"13", ts: Date.now()-DAY*534 },
  { id:"b3ani001", author:"Trivia Bot", subject:"Animals", question:"What is the fastest land animal?", answer:"cheetah", ts: Date.now()-DAY*533 },
  { id:"b3ani002", author:"Trivia Bot", subject:"Animals", question:"What is the largest species of shark?", answer:"whale shark", ts: Date.now()-DAY*532 },
  { id:"b3ani003", author:"Trivia Bot", subject:"Animals", question:"What is the largest mammal on Earth?", answer:"blue whale", ts: Date.now()-DAY*531 },
  { id:"b3ani004", author:"Trivia Bot", subject:"Animals", question:"What is the tallest animal in the world?", answer:"giraffe", ts: Date.now()-DAY*530 },
  { id:"b3ani005", author:"Trivia Bot", subject:"Animals", question:"What is a baby kangaroo called?", answer:"joey", ts: Date.now()-DAY*529 },
  { id:"b3ani006", author:"Trivia Bot", subject:"Animals", question:"What is a baby swan called?", answer:"cygnet", ts: Date.now()-DAY*528 },
  { id:"b3ani007", author:"Trivia Bot", subject:"Animals", question:"What is a baby goat called?", answer:"kid", ts: Date.now()-DAY*527 },
  { id:"b3ani008", author:"Trivia Bot", subject:"Animals", question:"What is a group of lions called?", answer:"pride", ts: Date.now()-DAY*526 },
  { id:"b3ani009", author:"Trivia Bot", subject:"Animals", question:"What is a group of crows called?", answer:"murder", ts: Date.now()-DAY*525 },
  { id:"b3ani010", author:"Trivia Bot", subject:"Animals", question:"What is a group of wolves called?", answer:"pack", ts: Date.now()-DAY*524 },
  { id:"b3ani011", author:"Trivia Bot", subject:"Animals", question:"What is the only mammal capable of true flight?", answer:"bat", ts: Date.now()-DAY*523 },
  { id:"b3ani012", author:"Trivia Bot", subject:"Animals", question:"How many legs does an insect have?", answer:"6", ts: Date.now()-DAY*522 },
  { id:"b3ani013", author:"Trivia Bot", subject:"Animals", question:"What is the largest bird in the world?", answer:"ostrich", ts: Date.now()-DAY*521 },
  { id:"b3ani014", author:"Trivia Bot", subject:"Animals", question:"Which tiny bird is famous for being able to fly backward?", answer:"hummingbird", ts: Date.now()-DAY*520 },
  { id:"b3ani015", author:"Trivia Bot", subject:"Animals", question:"What bird is the national bird of the United States?", answer:"bald eagle", crewNote:"Full name of the bird, matey!", ts: Date.now()-DAY*519 },
  { id:"b3ani016", author:"Trivia Bot", subject:"Animals", question:"Which animal is the symbol of the World Wildlife Fund?", answer:"panda", ts: Date.now()-DAY*518 },
  { id:"b3ani017", author:"Trivia Bot", subject:"Animals", question:"Which animal is nicknamed the ship of the desert?", answer:"camel", ts: Date.now()-DAY*517 },
  { id:"b3ani018", author:"Trivia Bot", subject:"Animals", question:"What is the largest species of big cat?", answer:"tiger", ts: Date.now()-DAY*516 },
  { id:"b3ani019", author:"Trivia Bot", subject:"Animals", question:"What is the largest rodent in the world?", answer:"capybara", ts: Date.now()-DAY*515 },
  { id:"b3ani020", author:"Trivia Bot", subject:"Animals", question:"Which egg-laying Australian mammal has a duck-like bill?", answer:"platypus", ts: Date.now()-DAY*514 },
  { id:"b3ani021", author:"Trivia Bot", subject:"Animals", question:"What do giant pandas mainly eat?", answer:"bamboo", ts: Date.now()-DAY*513 },
  { id:"b3ani022", author:"Trivia Bot", subject:"Animals", question:"What do koalas mainly eat?", answer:"eucalyptus", ts: Date.now()-DAY*512 },
  { id:"b3ani023", author:"Trivia Bot", subject:"Animals", question:"What is the largest species of penguin?", answer:"emperor", ts: Date.now()-DAY*511 },
  { id:"b3ani024", author:"Trivia Bot", subject:"Animals", question:"What is a female fox called?", answer:"vixen", ts: Date.now()-DAY*510 },
  { id:"b3ani025", author:"Trivia Bot", subject:"Animals", question:"What is a male swan called?", answer:"cob", ts: Date.now()-DAY*509 },
  { id:"b3ani026", author:"Trivia Bot", subject:"Animals", question:"What is a female deer called?", answer:"doe", ts: Date.now()-DAY*508 },
  { id:"b3ani027", author:"Trivia Bot", subject:"Animals", question:"What is a male sheep called?", answer:"ram", ts: Date.now()-DAY*507 },
  { id:"b3ani028", author:"Trivia Bot", subject:"Animals", question:"What is a female pig called?", answer:"sow", ts: Date.now()-DAY*506 },
  { id:"b3ani029", author:"Trivia Bot", subject:"Animals", question:"What is a baby cow called?", answer:"calf", ts: Date.now()-DAY*505 },
  { id:"b3ani030", author:"Trivia Bot", subject:"Animals", question:"What is a baby horse called?", answer:"foal", ts: Date.now()-DAY*504 },
  { id:"b3ani031", author:"Trivia Bot", subject:"Animals", question:"Which pink bird is famous for standing on one leg?", answer:"flamingo", ts: Date.now()-DAY*503 },
  { id:"b3ani032", author:"Trivia Bot", subject:"Animals", question:"Is a seahorse a fish, a mammal, or a reptile?", answer:"fish", ts: Date.now()-DAY*502 },
  { id:"b3sci044", author:"Trivia Bot", subject:"Science", question:"What is the chemical symbol for platinum?", answer:"pt", crewNote:"Chemical symbol required, matey!", ts: Date.now()-DAY*501 },
];
// Seed questions removed after review (wrong, ambiguous, duplicate, or open-ended).
// The app removes these from Firebase on load. Crew-submitted questions are never touched.
const RETIRED_SEED_IDS = ["a10", "an03", "an12", "an14", "an20", "f05", "f13", "fdn05", "fdn17", "fi03", "fi10", "fi16", "fi19", "fi20", "fin01", "fin04", "fin06", "fin08", "fin12", "fin13", "fin15", "fin18", "fin19", "fin20", "g15", "h42", "hn09", "l14", "l28", "ln06", "ln08", "m14", "mu11", "mu15", "mu17", "mu26", "mu29", "mun01", "mun18", "p19", "p24", "p40", "pn02", "pn08", "pn17", "pn18", "pn20", "sn19", "sp15", "sp18", "sp21", "sp22", "sp32", "sp34", "spn04", "spn08", "spn16", "t05", "t12", "t13", "tn02", "tn04", "tn07", "tn08", "tn09", "tn19", "tn20"];


// ── Utilities ─────────────────────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const now  = () => Date.now();

// Number words map
const NUM_WORDS = {
  zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
  ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,
  seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,
  sixty:60,seventy:70,eighty:80,ninety:90,hundred:100,thousand:1000,
};

function normalize(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Convert number words to digits: "seven" -> "7", "forty six" -> "46"
function wordsToNum(s) {
  const words = s.trim().toLowerCase().split(/[\s-]+/);
  let total = 0, current = 0, valid = true;
  for (const w of words) {
    if (NUM_WORDS[w] !== undefined) {
      const v = NUM_WORDS[w];
      if (v === 100) { current = current === 0 ? 100 : current * 100; }
      else if (v === 1000) { total += (current === 0 ? 1 : current) * 1000; current = 0; }
      else { current += v; }
    } else { valid = false; break; }
  }
  return valid && (total + current) > 0 ? String(total + current) : null;
}

// Convert digits to words for simple numbers
const ONES = ["","one","two","three","four","five","six","seven","eight","nine",
              "ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen",
              "seventeen","eighteen","nineteen"];
const TENS = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
function numToWords(n) {
  const num = parseInt(n, 10);
  if (isNaN(num) || num < 0 || num > 999) return null;
  if (num < 20) return ONES[num] || null;
  if (num < 100) return (TENS[Math.floor(num/10)] + (num%10 ? ONES[num%10] : "")).trim();
  return (ONES[Math.floor(num/100)] + "hundred" + (num%100 ? numToWords(num%100) : "")).trim();
}

// Levenshtein distance for fuzzy matching
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length:m+1}, (_,i) => Array.from({length:n+1}, (_,j) => i===0?j:j===0?i:0));
  for (let i=1;i<=m;i++) for (let j=1;j<=n;j++)
    dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}

// Articles and filler words to strip before comparing
const STRIP_WORDS = new Set(["the","a","an","of","and","or","in","on","at","to","for","by","with","de","la","el","le"]);

// Geographic/common suffixes that can be optionally included or omitted
const STRIP_SUFFIXES = ["river","lake","mountain","mountains","ocean","sea","island","islands","city","republic","kingdom","empire","peninsula","continent","desert","valley","falls","bay","gulf","strait","range","plateau","volcano","glacier","war","street","mount"];

// Common abbreviations — maps short form to full form (normalized, no spaces)
const ABBREVIATIONS = {
  "us":    ["unitedstates","unitedstatesofamerica"],
  "usa":   ["unitedstates","unitedstatesofamerica"],
  "uk":    ["unitedkingdom","greatbritain"],
  "uae":   ["unitedarabemirates"],
  "ussr":  ["sovietunion"],
  "un":    ["unitednations"],
  "eu":    ["europeanunion"],
  "nato":  ["northatlantictreatyorganization"],
  "nyc":   ["newyorkcity","newyork"],
  "la":    ["losangeles"],
  "dc":    ["washingtondc","washington"],
  "nyse":  ["newyorkstockexchange"],
  "fed":   ["federalreserve"],
  "irs":   ["internalrevenueservice"],
  "gop":   ["republicanparty"],
  "wwi":   ["worldwari","worldwarone","firstworldwar"],
  "wwii":  ["worldwarii","worldwartwo","secondworldwar"],
  "bc":    ["beforechrist"],
  "ad":    ["annodomin"],
  "jr":    ["junior"],
  "sr":    ["senior"],
  "dr":    ["doctor"],
  "st":    ["saint","street"],
  "mt":    ["mount","mountain"],
  "ft":    ["fort"],
};

function stripArticles(s) {
  return s.split(" ").filter(w => !STRIP_WORDS.has(w)).join(" ").trim();
}

function stripSuffixes(s) {
  const words = s.split(" ");
  // Strip trailing geographic suffixes
  while (words.length > 1 && STRIP_SUFFIXES.includes(words[words.length-1])) {
    words.pop();
  }
  // Also strip leading geographic prefixes if more than one word remains
  if (words.length > 1 && STRIP_SUFFIXES.includes(words[0])) {
    words.shift();
  }
  return words.join(" ").trim();
}

// Expand abbreviation to its possible full forms
function expandAbbrev(s) {
  return ABBREVIATIONS[s] || null;
}

// Main answer checker — returns true if answer is close enough to correct
function checkAnswer(userAnswer, correctAnswer) {
  const ua = normalize(userAnswer);
  const ca = normalize(correctAnswer);
  if (!ua || !ca) return false;

  // ── STRICT NUMBERS & YEARS ──────────────────────────────────────────────────
  // If the correct answer is a number or a year, the response must be EXACTLY that
  // number: 1976 is not 1776, 2.62 is not 26.2. Digits ("7"), commas ("1,776") and
  // spelled-out numbers ("seven", "forty six") are all fine; near-misses never are.
  const plainNum = s => { const t = s.trim().replace(/,/g, ""); return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
  const caNum0 = plainNum(correctAnswer);
  if (caNum0 !== null) {
    const uaNum0 = plainNum(userAnswer);
    if (uaNum0 !== null) return uaNum0 === caNum0;
    const spelled = wordsToNum(userAnswer.trim().toLowerCase().replace(/[^a-z\s-]/g, ""));
    if (spelled !== null && Number(spelled) === caNum0) return true;
    // A short phrase containing exactly one number, e.g. "in 1776" or "26.2 miles"
    const found = userAnswer.replace(/,/g, "").match(/-?\d+(\.\d+)?/g);
    return !!(found && found.length === 1 && Number(found[0]) === caNum0 && userAnswer.trim().split(/\s+/).length <= 3);
  }

  // Exact match
  if (ua === ca) return true;

  // Strip articles and compare
  const uaNoArt = normalize(stripArticles(userAnswer.trim().toLowerCase()));
  const caNoArt = normalize(stripArticles(correctAnswer.trim().toLowerCase()));
  if (uaNoArt === caNoArt) return true;
  if (uaNoArt === ca || ua === caNoArt) return true;

  // Strip geographic suffixes and compare
  // e.g. "nile river" vs "nile", "rocky mountains" vs "rocky"
  const uaNoSuf = normalize(stripSuffixes(stripArticles(userAnswer.trim().toLowerCase())));
  const caNoSuf = normalize(stripSuffixes(stripArticles(correctAnswer.trim().toLowerCase())));
  if (uaNoSuf === caNoSuf) return true;
  if (uaNoSuf === ca || ua === caNoSuf) return true;
  if (uaNoSuf === caNoArt || uaNoArt === caNoSuf) return true;

  // Abbreviation matching — check if user typed abbreviation for full answer
  // or vice versa
  const uaExpanded = expandAbbrev(ua);
  const caExpanded = expandAbbrev(ca);
  if (uaExpanded && uaExpanded.some(e => e === ca || e === caNoArt || e === caNoSuf)) return true;
  if (caExpanded && caExpanded.some(e => e === ua || e === uaNoArt || e === uaNoSuf)) return true;
  // Also check if the full answer normalizes to match an expansion
  if (uaExpanded && uaExpanded.includes(caNoSuf)) return true;
  if (uaExpanded && uaExpanded.includes(caNoArt)) return true;

  // Number equivalence: accept "7" for "seven" and vice versa
  const uaNum  = wordsToNum(ua)  || (isNaN(Number(ua))  ? null : ua);
  const caNum  = wordsToNum(ca)  || (isNaN(Number(ca))  ? null : ca);
  const uaWord = numToWords(parseInt(ua,10))  ? normalize(numToWords(parseInt(ua,10)))  : ua;
  const caWord = numToWords(parseInt(ca,10))  ? normalize(numToWords(parseInt(ca,10)))  : ca;
  if (uaNum && caNum && uaNum === caNum) return true;
  if (uaWord === caWord) return true;
  if (uaNum === ca || ua === caNum) return true;

  // ── Token matching: extra words, optional middle initials ──
  const ALIAS = { st: "saint" };
  const toks = s => stripSuffixes(stripArticles(s.trim().toLowerCase()))
    .split(/\s+/).map(w => normalize(w)).filter(Boolean).map(w => ALIAS[w] || w);
  const caT = toks(correctAnswer), uaT = toks(userAnswer);
  const hasDigit = w => /\d/.test(w);
  const fuzzyOK  = w => w.length >= 5 && !hasDigit(w);
  const tokMatch = (u, c2) => u === c2 || u === c2 + "s" || c2 === u + "s" ||
    (fuzzyOK(c2) && levenshtein(u, c2) <= 1);

  if (caT.length === 1) {
    // Single-word answer typed with extra words, e.g. "Los Angeles Lakers" for "Lakers"
    const c1 = caT[0];
    if (c1.length >= 4 && !hasDigit(c1) && uaT.length <= 3 && uaT.some(u => tokMatch(u, c1))) return true;
  } else if (caT.length > 1) {
    // Middle initials are optional only when at least two full words remain
    const full = caT.filter(w => w.length > 1);
    const key  = full.length >= 2 ? full : caT;
    if (uaT.length <= caT.length + 3 && key.every(k => uaT.some(u => tokMatch(u, k)))) return true;
  }

  // Answers ending in a Roman numeral also accept the regular number ("Henry 8" for "Henry VIII")
  const ROMAN = { i:1, ii:2, iii:3, iv:4, v:5, vi:6, vii:7, viii:8, ix:9, x:10, xi:11, xii:12, xiii:13, xiv:14, xv:15, xvi:16 };
  if (caT.length > 1 && ROMAN[caT[caT.length - 1]]) {
    const alt = [...caT.slice(0, -1), String(ROMAN[caT[caT.length - 1]])];
    if (alt.length === uaT.length && alt.every((w, i) => tokMatch(uaT[i], w))) return true;
  }

  // ── Typo tolerance on the whole answer ──
  // Never for numbers/years (1946 is NOT 1945), never for very short answers
  // (Au vs Ag), and never for answers ending in a Roman numeral (Henry VII vs VIII)
  const endsRoman = /\s[ivxl]+$/i.test(correctAnswer.trim());
  const maxDistFor = s => s.length <= 8 ? 1 : s.length <= 12 ? 2 : 3;
  // Multi-word answers are handled word-by-word above (so "Vitamin D" can never pass for "Vitamin C")
  const fuzzyWhole = (u, c2) => caT.length === 1 && !endsRoman && c2.length >= 5 && !hasDigit(c2) && levenshtein(u, c2) <= maxDistFor(c2);
  if (fuzzyWhole(ua, ca) || fuzzyWhole(uaNoArt, caNoArt) || fuzzyWhole(uaNoSuf, caNoSuf)) return true;

  return false;
}
// Returns the start timestamp for each leaderboard period
function getPeriodCutoff(period) {
  const now = new Date();
  switch(period) {
    case "daily": {
      // Start of today (midnight)
      const d = new Date(now); d.setHours(0,0,0,0); return d.getTime();
    }
    case "weekly": {
      // Start of this week (Monday midnight)
      const d = new Date(now); d.setHours(0,0,0,0);
      const day = d.getDay(); // 0=Sun, 1=Mon...
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      return d.getTime();
    }
    case "monthly": {
      // Start of this month
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return d.getTime();
    }
    case "yearly": {
      // Start of this year
      const d = new Date(now.getFullYear(), 0, 1);
      return d.getTime();
    }
    case "alltime":
    default:
      return 0;
  }
}

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
function buildDailyQueue(questions, dateStr, usedIds=[]) {
  if (!questions.length) return [];
  const seed = dateSeed(dateStr);
  const usedSet = new Set(usedIds);
  // Filter out already-used questions
  let pool = questions.filter(q => !usedSet.has(q.id));
  // If pool is nearly exhausted (fewer than DAILY_LIMIT left), reset the cycle
  if (pool.length < DAILY_LIMIT) {
    console.log("Question pool cycled — resetting used questions list");
    pool = [...questions]; // start fresh with all questions
  }
  const shuffled = seededShuffle(pool, seed);
  return shuffled.slice(0, Math.min(DAILY_LIMIT, shuffled.length)).map(q => q.id);
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
    html,body{
      height:100%;
      width:100%;
      background:#0f0f0f;
      overscroll-behavior:none;
      overflow-x:hidden;
      position:fixed;
      -webkit-overflow-scrolling:touch;
    }
    #root{
      height:100%;
      width:100%;
      overflow-x:hidden;
      overflow-y:auto;
      position:fixed;
      top:0;left:0;right:0;bottom:0;
      -webkit-overflow-scrolling:touch;
    }
    button{cursor:pointer;transition:opacity .15s,transform .1s;-webkit-tap-highlight-color:transparent;}
    button:active{transform:scale(.97)}
    input,textarea{
      font-size:16px !important;
      -webkit-appearance:none;
      border-radius:0;
    }
    input::placeholder,textarea::placeholder{color:#3a3a3a}
    textarea{font-family:'Lato',sans-serif;resize:vertical}
    ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#111}::-webkit-scrollbar-thumb{background:#333;border-radius:4px}
    img{max-width:100%}
    nav{padding-bottom:env(safe-area-inset-bottom,0px)!important;}
    header{padding-top:env(safe-area-inset-top,0px)!important;}
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
  const [usedQ,setUsedQ]=useState([]);
  const [showPlank,setShowPlank]=useState(false);
  const [notificationsEnabled,setNotificationsEnabled]=useState(pget("notifications_enabled")||false);
  const [plankIsVictim,setPlankIsVictim]=useState(false);
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState("");

  useEffect(()=>{
    // Safety net — if loading takes more than 8 seconds, show app anyway
    const safetyTimer = setTimeout(() => setLoading(false), 8000);
    (async()=>{
      const [q,s,a,at,dl,fl,pu,bo,no,pl,ph,dqRaw,uq] = await Promise.all([
        sget(KEYS.questions), sget(KEYS.scores),   sget(KEYS.answered),
        sget(KEYS.attempts),  sget(KEYS.dailyLog),  sget(KEYS.flags),
        sget(KEYS.pulled),    sget(KEYS.bonuses),   sget(KEYS.notices),
        sget(KEYS.plank),     sget(KEYS.plankHistory), sget(KEYS.dailyQ),
        sget(KEYS.usedQ),
      ]);

      let questions = q  || SEED;
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

      // Sync seed questions with Firebase:
      //  - retire questions removed after review
      //  - refresh seed questions whose text, answer, or crew note was corrected
      //  - add any new seed questions
      // Crew-submitted questions (author other than Trivia Bot) are never touched.
      const retired  = new Set(RETIRED_SEED_IDS);
      const seedById = new Map(SEED.map(x => [x.id, x]));
      let seedChanged = false;
      const synced = [];
      (q || []).forEach(item => {
        if (item.author === "Trivia Bot") {
          if (retired.has(item.id)) { seedChanged = true; return; }
          const sd = seedById.get(item.id);
          if (sd && (item.question !== sd.question || item.answer !== sd.answer || (item.crewNote || "") !== (sd.crewNote || ""))) {
            seedChanged = true;
            synced.push({ ...item, question: sd.question, answer: sd.answer, crewNote: sd.crewNote || "" });
            return;
          }
        }
        synced.push(item);
      });
      const haveIds = new Set(synced.map(x => x.id));
      const missingSeed = SEED.filter(x => !haveIds.has(x.id) && !retired.has(x.id));
      if (seedChanged || missingSeed.length > 0 || !q) {
        questions = [...synced, ...missingSeed];
        await sset(KEYS.questions, questions);
        console.log(`Question sync: +${missingSeed.length} added`);
      } else {
        questions = synced;
      }

      const pulledIds = new Set(pulled.map(p=>p.qid));
      const activeQ   = questions.filter(q=>!pulledIds.has(q.id));
      // Clean usedQ — remove any IDs that no longer exist in the active pool
      const activeIds = new Set(activeQ.map(q => q.id));
      const rawUsedQ  = uq || [];
      const cleanUsedQ = rawUsedQ.filter(id => activeIds.has(id));

      // Only reset when every single active question has been used
      const usedQList = cleanUsedQ.length >= activeQ.length
        ? [] // full cycle complete — start fresh
        : cleanUsedQ;

      let dq = dqRaw;
      if (dq && dq.date === today && dq.qids.some(id => !activeIds.has(id))) {
        // Swap retired questions for fresh ones, keeping slot order so nobody is re-served a question
        const repl = buildDailyQueue(activeQ.filter(x => !dq.qids.includes(x.id)), today, usedQList);
        let ri = 0;
        dq = { date: today, qids: dq.qids.map(id => activeIds.has(id) ? id : (repl[ri++] || id)) };
        await sset(KEYS.dailyQ, dq);
        await sset(KEYS.usedQ, [...new Set([...usedQList, ...dq.qids])]);
      }
      if (!dq || dq.date !== today) {
        dq = { date:today, qids: buildDailyQueue(activeQ, today, usedQList) };
        const newUsedQ = [...new Set([...usedQList, ...dq.qids])];
        await Promise.all([sset(KEYS.dailyQ, dq), sset(KEYS.usedQ, newUsedQ)]);
        setUsedQ(newUsedQ);
      } else {
        setUsedQ(usedQList);
        // If usedQ was cleaned up, save the cleaned version
        if (cleanUsedQ.length !== rawUsedQ.length || usedQList.length !== cleanUsedQ.length) {
          await sset(KEYS.usedQ, usedQList);
        }
      }

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
      clearTimeout(safetyTimer);
      setLoading(false);

      // ── Real-time listeners — update UI when other players make changes ──
      const db = getDB();
      if (db) {
        db.ref("scallywag/" + KEYS.scores).on("value", snap => {
          const val = snap.val(); if(val){ invalidate(KEYS.scores); setScores(val); }
        });
        db.ref("scallywag/" + KEYS.questions).on("value", snap => {
          const val = snap.val(); if(val){ invalidate(KEYS.questions); setQuestions(val); }
        });
        db.ref("scallywag/" + KEYS.flags).on("value", snap => {
          const val = snap.val(); if(val){ invalidate(KEYS.flags); setFlags(val); }
        });
        db.ref("scallywag/" + KEYS.notices).on("value", snap => {
          const val = snap.val(); if(val){ invalidate(KEYS.notices); setNotices(val); }
        });
        // Keep daily log in sync so answered questions persist across browser sessions
        db.ref("scallywag/" + KEYS.dailyLog).on("value", snap => {
          const val = snap.val(); if(val){ invalidate(KEYS.dailyLog); setDailyLog(val); }
        });
        // Keep bonuses in sync
        db.ref("scallywag/" + KEYS.bonuses).on("value", snap => {
          const val = snap.val(); if(val){ invalidate(KEYS.bonuses); setBonuses(val); }
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

  const handleLogin=async name=>{
    if(!name.trim()) return;
    const trimmed = name.trim();
    setUsername(trimmed);
    pset(KEYS.username, trimmed);

    // Re-sync daily log and bonuses from Firebase for this user
    // so answers made on other devices/browsers are recognized
    try {
      invalidate(KEYS.dailyLog);
      invalidate(KEYS.bonuses);
      invalidate(KEYS.notices);
      const [freshDl, freshBo, freshNo] = await Promise.all([
        sget(KEYS.dailyLog),
        sget(KEYS.bonuses),
        sget(KEYS.notices),
      ]);
      if (freshDl) setDailyLog(freshDl);
      if (freshBo) setBonuses(freshBo);
      if (freshNo) setNotices(freshNo);
    } catch(e) {
      console.warn("Re-sync after login failed:", e.message);
    }
  };
  const addScore=async(user,pts)=>{
    const n={...scores};
    if(!n[user])n[user]=[];
    n[user]=[...n[user],{ts:now(),pts}];
    setScores(n);
    // Write directly to Firebase with retry
    const db=getDB();
    if(db){
      let retries=3;
      while(retries>0){
        try{
          await db.ref("scallywag/"+KEYS.scores).set(n);
          try{localStorage.setItem("sg_shared_"+KEYS.scores,JSON.stringify(n));}catch{}
          _cache[KEYS.scores]=n;
          break;
        }catch(e){
          retries--;
          console.warn("addScore write failed, retrying:",e.message);
          if(retries>0) await new Promise(r=>setTimeout(r,1000));
        }
      }
    } else {
      try{localStorage.setItem("sg_shared_"+KEYS.scores,JSON.stringify(n));}catch{}
    }
  };
  const markAnswered=async(qid,user)=>{
    const a={...answered};
    if(!a[qid])a[qid]=[];
    if(!a[qid].includes(user))a[qid]=[...a[qid],user];
    setAnswered(a);
    const db=getDB();
    if(db){
      let retries=3;
      while(retries>0){
        try{
          await db.ref("scallywag/"+KEYS.answered).set(a);
          try{localStorage.setItem("sg_shared_"+KEYS.answered,JSON.stringify(a));}catch{}
          _cache[KEYS.answered]=a;
          break;
        }catch(e){
          retries--;
          if(retries>0) await new Promise(r=>setTimeout(r,1000));
        }
      }
    }
  };
  const recordAttempt=(qid,user,answer,correct)=>{const at={...attempts};if(!at[qid])at[qid]=[];at[qid]=[...at[qid],{user,answer,correct,ts:now()}];sat(at);};
  const markDailyAnswer=(user,qid)=>{const key=`${user}|${todayStr()}`;const n={...dailyLog};if(!n[key])n[key]=[];if(!n[key].includes(qid))n[key]=[...n[key],qid];sdl(n);return n;};
  const dismissPlank=()=>{setShowPlank(false);pset("plank_dismissed",plank?.weekStr);};

  // Force sync all local data to Firebase — used when sync gets out of step
  const forceSyncToFirebase=async()=>{
    const db=getDB();
    if(!db) return false;
    try{
      // Pull fresh from Firebase first
      invalidate(KEYS.scores); invalidate(KEYS.answered); invalidate(KEYS.dailyLog);
      const [freshScores,freshAnswered,freshDailyLog]=await Promise.all([
        sget(KEYS.scores), sget(KEYS.answered), sget(KEYS.dailyLog)
      ]);

      // Merge local scores with Firebase scores (keep highest/most entries)
      const localScores=JSON.parse(localStorage.getItem("sg_shared_"+KEYS.scores)||"{}");
      const mergedScores={...(freshScores||{})};
      Object.entries(localScores).forEach(([user,entries])=>{
        if(!mergedScores[user]) mergedScores[user]=[];
        // Add any local entries not in Firebase (by timestamp)
        const fbTs=new Set((mergedScores[user]||[]).map(e=>e.ts));
        entries.forEach(e=>{ if(!fbTs.has(e.ts)) mergedScores[user].push(e); });
        mergedScores[user].sort((a,b)=>a.ts-b.ts);
      });

      // Merge local dailyLog
      const localDL=JSON.parse(localStorage.getItem("sg_shared_"+KEYS.dailyLog)||"{}");
      const mergedDL={...(freshDailyLog||{})};
      Object.entries(localDL).forEach(([key,qids])=>{
        if(!mergedDL[key]) mergedDL[key]=[];
        const existing=new Set(mergedDL[key]);
        qids.forEach(q=>{ if(!existing.has(q)) mergedDL[key].push(q); });
      });

      // Write merged data back to Firebase
      await Promise.all([
        db.ref("scallywag/"+KEYS.scores).set(mergedScores),
        db.ref("scallywag/"+KEYS.dailyLog).set(mergedDL),
      ]);

      setScores(mergedScores);
      setDailyLog(mergedDL);
      _cache[KEYS.scores]=mergedScores;
      _cache[KEYS.dailyLog]=mergedDL;
      return true;
    }catch(e){
      console.warn("Force sync failed:",e.message);
      return false;
    }
  };
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
    e("main",{style:{flex:1,overflowY:"auto",overflowX:"hidden",width:"100%",WebkitOverflowScrolling:"touch"}},
      screen==="home"&&e(HomeScreen,{username,questions:activeQuestions,scores,dailyAnsweredCount,effectiveLimit,bonusCount,plank,onNavigate:setScreen,onShowPlank:()=>{setPlankIsVictim(plank?.victim===username);setShowPlank(true);}}),
      screen==="play"&&e(PlayScreen,{username,questions:activeQuestions,answered,dailyQ,dailyLog,dailyAnsweredCount,effectiveLimit,flags,pulledIds,
        onCorrect:(qid,ans)=>{addScore(username,10);markAnswered(qid,username);recordAttempt(qid,username,ans,true);const dl=markDailyAnswer(username,qid);if(bonusCount>0){const nb={...bonuses};nb[username]=nb[username]-1;if(nb[username]<=0)delete nb[username];sbo(nb);}return dl;},
        onWrong:(qid,ans)=>{markAnswered(qid,username);recordAttempt(qid,username,ans,false);const dl=markDailyAnswer(username,qid);if(bonusCount>0){const nb={...bonuses};nb[username]=nb[username]-1;if(nb[username]<=0)delete nb[username];sbo(nb);}return dl;},
        onFlag:flagQuestion}),
      screen==="submit"&&e(SubmitScreen,{username,questions,answered,attempts,onSubmit:q=>{const next=[...questions,{...q,id:uid(),author:username,ts:now()}];sv(next);const pids=new Set(pulled.map(p=>p.qid));const aq=next.filter(q=>!pids.has(q.id));const newDq={date:todayStr(),qids:buildDailyQueue(aq,todayStr())};setDailyQ(newDq);sset(KEYS.dailyQ,newDq);showToast("Question added! 🎉");setScreen("home");}}),
      screen==="leaderboard"&&e(LeaderboardScreen,{scores,username,plank,plankHistory}),
      screen==="profile"&&e(ProfileScreen,{username,questions,attempts,scores,dailyLog,plankHistory,onOpenSettings:()=>setScreen("settings")}),
      screen==="settings"&&e(SettingsScreen,{username,userNotices,onBack:()=>setScreen("profile"),notificationsEnabled,setNotificationsEnabled,forceSyncToFirebase,onSaveName:newName=>{if(!newName.trim())return;setUsername(newName.trim());pset(KEYS.username,newName.trim());showToast("Name updated! ⚓");setScreen("home");},onDismissNotice:qid=>dismissNotice(username,qid)})
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
    e("button",{onClick:()=>setScreen("profile"),style:{background:"#161616",border:"1px solid #2a2a2a",borderRadius:24,color:"#888",padding:"7px 14px",fontSize:13,fontFamily:"Lato,sans-serif",display:"flex",alignItems:"center",gap:7,position:"relative"}},
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
  const tabs=[{id:"home",icon:"🏠",label:"Home"},{id:"play",icon:"🎯",label:"Play"},{id:"submit",icon:"✏️",label:"Submit"},{id:"leaderboard",icon:"🏆",label:"Board"},{id:"profile",icon:"🏴‍☠️",label:"Profile"}];
  return e("nav",{style:{position:"fixed",bottom:0,left:0,right:0,height:"calc(68px + env(safe-area-inset-bottom, 0px))",background:"#0a0a0a",borderTop:"1px solid #1c1c1c",display:"flex",zIndex:200}},
    tabs.map(t=>{
      const active=screen===t.id||(t.id==="profile"&&screen==="settings");
      const playBadge=t.id==="play"&&dailyAnsweredCount<effectiveLimit;
      const settingsBadge=t.id==="profile"&&noticeCount>0;
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
    const correct=checkAnswer(answerInput, currentQ.answer);
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
            e("p",{style:{fontSize:21,color:"#e8dcc8",lineHeight:1.55,marginBottom:currentQ.crewNote?10:28,fontFamily:"'Cinzel',serif",fontWeight:700}},currentQ.question),
            currentQ.crewNote&&e("div",{style:{background:"#0a1a0a",border:"1px solid #1a3a1a",borderRadius:10,padding:"8px 14px",marginBottom:20,display:"flex",alignItems:"center",gap:8}},
              e("span",{style:{fontSize:14,flexShrink:0}},"⚓"),
              e("p",{style:{color:"#5a9a5a",fontSize:12,fontStyle:"italic",fontFamily:"Lato,sans-serif"}},currentQ.crewNote)
            ),
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
  const [crewNote,setCrewNote]=useState("");
  const [error,setError]=useState("");
  const [expandedId,setExpandedId]=useState(null);
  const e=React.createElement;
  const myQs=questions.filter(q=>q.author===username).slice().reverse();
  const handle=()=>{
    if(!subject.trim()||!question.trim()||!answer.trim()){setError("All fields are required.");return;}
    onSubmit({subject:subject.trim(),question:question.trim(),answer:normalize(answer),crewNote:crewNote.trim()});
  };
  const fs={width:"100%",background:"#0d0d0d",border:"1px solid #222",borderRadius:10,padding:"13px 16px",color:"#e8dcc8",fontSize:15,fontFamily:"Lato,sans-serif",outline:"none",marginBottom:20,boxSizing:"border-box"};
  const ls={display:"block",color:"#5a4a20",fontSize:11,textTransform:"uppercase",letterSpacing:2.5,marginBottom:8};
  return e("div",{style:{maxWidth:680,margin:"0 auto",padding:"28px 20px 32px"}},
    e("h2",{style:{fontFamily:"'Cinzel',serif",fontSize:24,color:"#d4a017",marginBottom:4}},"Submit a Question"),
    e("p",{style:{color:"#555",fontSize:13,marginBottom:12}},"Stump your crew. Submitting as ",e("strong",{style:{color:"#d4a017"}},username)),
    e("div",{style:{background:"#0a0f0a",border:"1px solid #1a2a1a",borderRadius:10,padding:"10px 14px",marginBottom:22}},
      e("p",{style:{color:"#5a9a5a",fontSize:12,lineHeight:1.5}},"⚓ Keep answers short and checkable — a name, number, year, or a word or two. Skip the 'explain why' questions, matey; the ship can't judge an essay!")
    ),
    e("div",{style:{background:"#121212",border:"1px solid #1e1e1e",borderRadius:16,padding:"28px 24px",marginBottom:28}},
      e("label",{style:ls},"Subject / Category"),
      e("input",{style:fs,placeholder:"e.g. Science, Movies, Sports…",value:subject,onChange:ev=>setSubject(ev.target.value)}),
      e("label",{style:ls},"Your Question"),
      e("textarea",{style:{...fs,minHeight:90},placeholder:"Ask something tricky…",value:question,onChange:ev=>setQuestion(ev.target.value)}),
      e("label",{style:ls},"The Answer"),
      e("input",{style:{...fs,marginBottom:16},placeholder:"Exact answer (case-insensitive)",value:answer,onChange:ev=>setAnswer(ev.target.value)}),
      e("label",{style:ls},"Crew Note (optional)"),
      e("div",{style:{background:"#0a0f0a",border:"1px solid #1a2a1a",borderRadius:8,padding:"8px 12px",marginBottom:8}},
        e("p",{style:{color:"#4a7a4a",fontSize:11}},"⚓ Add a note if yer crew needs guidance answering — e.g. 'Full name required, matey!' or 'Last name only, ye scallywag!'")
      ),
      e("input",{style:{...fs,marginBottom:error?6:20},placeholder:"e.g. Full name required, matey! (optional)",value:crewNote,onChange:ev=>setCrewNote(ev.target.value)}),
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
  const cutoff=getPeriodCutoff(tab);
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

// ── Profile: pirate-themed "Captain's Log" with per-category mastery ─────────────
const CATEGORY_ICONS = { "Science":"🔬","History":"📜","Geography":"🧭","Pop Culture":"🎬","Sports":"🏆","Literature":"📖","Music":"🎵","Technology":"⚙️","Finance":"💰","Food & Drink":"🍖","Art":"🎨","Math":"🔢","Animals":"🐾" };
const CORE_CATEGORIES = Object.keys(CATEGORY_ICONS);
const RANKS = [
  { min:0,    title:"Landlubber",  icon:"🪢" },
  { min:100,  title:"Deckhand",    icon:"⚓" },
  { min:300,  title:"Buccaneer",   icon:"🗡️" },
  { min:600,  title:"First Mate",  icon:"🧭" },
  { min:1000, title:"Captain",     icon:"🏴‍☠️" },
  { min:2000, title:"Pirate Lord", icon:"👑" },
];
function masteryOf(correct, total) {
  if (total < 3) return { title:"Uncharted Waters", color:"#555" };
  const p = Math.round(correct / total * 100);
  if (p >= 90) return { title:"Legend of the Seas", color:"#f5c842" };
  if (p >= 75) return { title:"Seasoned Salt",      color:"#2ecc71" };
  if (p >= 60) return { title:"Able Seaman",        color:"#4ecdc4" };
  if (p >= 40) return { title:"Green Sailor",       color:"#f0814a" };
  return { title:"Landlubber", color:"#e05555" };
}
function dayStreak(dailyLog, username) {
  const days = new Set(Object.keys(dailyLog || {})
    .filter(k => k.startsWith(username + "|") && (dailyLog[k] || []).length > 0)
    .map(k => k.split("|")[1]));
  const fmt = x => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`;
  const d = new Date();
  if (!days.has(fmt(d))) d.setDate(d.getDate() - 1); // today not played yet: streak counts through yesterday
  let streak = 0;
  while (days.has(fmt(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

function ProfileScreen({username,questions,attempts,scores,dailyLog,plankHistory,onOpenSettings}){
  const e = React.createElement;

  // Tally this player's answers by category
  const subjectOf = {};
  (questions || []).forEach(q => { subjectOf[q.id] = q.subject; });
  const cats = {};
  let correct = 0, total = 0;
  Object.entries(attempts || {}).forEach(([qid, list]) => {
    (list || []).forEach(a => {
      if (a.user !== username) return;
      const subj = subjectOf[qid] || "Other";
      if (!cats[subj]) cats[subj] = { correct:0, total:0 };
      cats[subj].total++; total++;
      if (a.correct) { cats[subj].correct++; correct++; }
    });
  });

  const points   = (scores[username] || []).reduce((s, x) => s + x.pts, 0);
  const accuracy = total ? Math.round(correct / total * 100) : 0;
  const rankIdx  = RANKS.reduce((acc, r, i) => points >= r.min ? i : acc, 0);
  const rank     = RANKS[rankIdx], next = RANKS[rankIdx + 1];
  const rankPct  = next ? Math.min(100, Math.round((points - rank.min) / (next.min - rank.min) * 100)) : 100;
  const streak   = dayStreak(dailyLog, username);
  const plankWalks = (plankHistory || []).filter(h => h.victim === username).length;

  // Categories: everything played, plus the core categories not yet visited
  const names = [...Object.keys(cats), ...CORE_CATEGORIES.filter(c => !cats[c])];
  const rows = names.map(n => ({ name:n, ...(cats[n] || { correct:0, total:0 }) }));
  const sortKey = r => r.total >= 3 ? 2000 + Math.round(r.correct / r.total * 100) * 10 + Math.min(r.total, 9)
                     : r.total > 0 ? 1000 + r.total : 0;
  rows.sort((a, b) => sortKey(b) - sortKey(a));
  const ranked = rows.filter(r => r.total >= 3).sort((a, b) => (b.correct/b.total) - (a.correct/a.total));
  const best = ranked.length >= 2 ? ranked[0] : null;
  const worst = ranked.length >= 2 ? ranked[ranked.length - 1] : null;

  const R = 34, C = 2 * Math.PI * R;
  const card = { background:"#121212", border:"1px solid #1e1e1e", borderRadius:16 };
  const label = { color:"#5a4a20", fontSize:11, textTransform:"uppercase", letterSpacing:3, marginBottom:12 };

  return e("div",{style:{maxWidth:680,margin:"0 auto",padding:"22px 20px 32px",width:"100%",overflowX:"hidden"}},

    // Top bar
    e("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}},
      e("div",{style:{fontFamily:"'Cinzel',serif",fontSize:11,color:"#6a5a30",letterSpacing:5,textTransform:"uppercase"}},"Captain's Log"),
      e("button",{onClick:onOpenSettings,"aria-label":"Settings",style:{background:"#161616",border:"1px solid #2a2a2a",borderRadius:20,color:"#888",padding:"6px 14px",fontSize:12,fontFamily:"Lato,sans-serif"}},"⚙️  Settings")
    ),

    // Hero: avatar + rank + progress ring
    e("div",{style:{...card,padding:"22px 20px",marginBottom:14,background:"linear-gradient(160deg,#1a1400 0%,#0e0c00 55%,#0a0a0a 100%)",border:"1px solid #3a2a00",boxShadow:"0 0 40px rgba(212,160,23,.08)"}},
      e("div",{style:{display:"flex",alignItems:"center",gap:16}},
        e("div",{style:{position:"relative",width:84,height:84,flexShrink:0}},
          e("svg",{width:84,height:84,viewBox:"0 0 84 84",style:{position:"absolute",inset:0,transform:"rotate(-90deg)"}},
            e("circle",{cx:42,cy:42,r:R,fill:"none",stroke:"#2a2000",strokeWidth:6}),
            e("circle",{cx:42,cy:42,r:R,fill:"none",stroke:"#d4a017",strokeWidth:6,strokeLinecap:"round",strokeDasharray:`${(accuracy/100)*C} ${C}`,style:{transition:"stroke-dasharray .8s ease"}})
          ),
          e("div",{style:{position:"absolute",inset:10,borderRadius:"50%",background:"#0a0a0a",border:"1px solid #2a2000",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Cinzel',serif",fontSize:26,fontWeight:900,color:"#d4a017"}},username[0].toUpperCase())
        ),
        e("div",{style:{flex:1,minWidth:0}},
          e("div",{style:{fontFamily:"'Cinzel',serif",fontSize:21,fontWeight:700,color:"#e8dcc8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},username),
          e("div",{style:{display:"inline-flex",alignItems:"center",gap:6,marginTop:6,background:"#1a1400",border:"1px solid #3a2a00",borderRadius:20,padding:"3px 12px"}},
            e("span",{style:{fontSize:14}},rank.icon),
            e("span",{style:{fontFamily:"'Cinzel',serif",fontSize:12,color:"#d4a017",letterSpacing:1}},rank.title)
          ),
          e("div",{style:{color:"#555",fontSize:11,marginTop:6}},total ? `${accuracy}% accuracy over ${total} answer${total!==1?"s":""}` : "No voyages logged yet")
        )
      ),
      e("div",{style:{marginTop:18}},
        e("div",{style:{display:"flex",justifyContent:"space-between",marginBottom:6}},
          e("span",{style:{color:"#5a4a20",fontSize:10,textTransform:"uppercase",letterSpacing:2}},next ? `Next rank: ${next.title}` : "Highest rank reached"),
          e("span",{style:{color:"#8a7040",fontSize:11}},next ? `${points} / ${next.min} gold` : `${points} gold`)
        ),
        e("div",{style:{background:"#0a0a0a",borderRadius:20,height:8,overflow:"hidden",border:"1px solid #1e1a00"}},
          e("div",{style:{height:"100%",width:`${rankPct}%`,background:"linear-gradient(90deg,#b8820f,#f5c842)",borderRadius:20,transition:"width .8s ease"}})
        )
      )
    ),

    // Stat tiles
    e("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}},
      ...[
        { icon:"🪙", label:"Gold Plundered", value:points,                accent:"#d4a017" },
        { icon:"🎯", label:"Cannon Accuracy", value:total?`${accuracy}%`:"—", accent:"#4ecdc4" },
        { icon:"🔥", label:"Day Streak",      value:streak,                accent:"#f0814a" },
        { icon:"☠️", label:"Plank Walks",     value:plankWalks,            accent:plankWalks?"#e05555":"#2ecc71" },
      ].map(s => e("div",{key:s.label,style:{...card,padding:"14px 16px",borderLeft:`3px solid ${s.accent}`}},
        e("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between"}},
          e("div",{style:{fontFamily:"'Cinzel',serif",fontSize:24,fontWeight:700,color:s.accent}},s.value),
          e("span",{style:{fontSize:18,opacity:.8}},s.icon)
        ),
        e("div",{style:{color:"#555",fontSize:10,textTransform:"uppercase",letterSpacing:1.5,marginTop:4}},s.label)
      ))
    ),

    // Strongest / weakest waters
    (best && worst) && e("div",{style:{display:"flex",gap:10,marginBottom:20}},
      e("div",{style:{flex:1,background:"#0a1a0f",border:"1px solid #1a3a20",borderRadius:14,padding:"12px 14px"}},
        e("div",{style:{color:"#3a7a4a",fontSize:10,textTransform:"uppercase",letterSpacing:2,marginBottom:4}},"Master of"),
        e("div",{style:{fontFamily:"'Cinzel',serif",fontSize:14,color:"#6fcf8a"}},`${CATEGORY_ICONS[best.name]||"🏴‍☠️"} ${best.name}`)
      ),
      e("div",{style:{flex:1,background:"#1a0a0a",border:"1px solid #3a1515",borderRadius:14,padding:"12px 14px"}},
        e("div",{style:{color:"#7a3a3a",fontSize:10,textTransform:"uppercase",letterSpacing:2,marginBottom:4}},"Rough seas"),
        e("div",{style:{fontFamily:"'Cinzel',serif",fontSize:14,color:"#e07070"}},`${CATEGORY_ICONS[worst.name]||"🏴‍☠️"} ${worst.name}`)
      )
    ),

    // Mastery by category
    e("div",{style:label},"Mastery of the Seven Seas"),
    total === 0 && e("div",{style:{...card,padding:"16px",marginBottom:12,textAlign:"center"}},
      e("p",{style:{color:"#666",fontSize:13,lineHeight:1.6}},"Answer a few questions and yer mastery of each sea will chart itself here, matey. ⚓")
    ),
    rows.map(r => {
      const m = masteryOf(r.correct, r.total);
      const pct = r.total ? Math.round(r.correct / r.total * 100) : 0;
      return e("div",{key:r.name,style:{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"#111",border:"1px solid #1e1e1e",borderRadius:12,marginBottom:8}},
        e("span",{style:{fontSize:22,width:30,textAlign:"center",flexShrink:0,opacity:r.total?1:.45}},CATEGORY_ICONS[r.name]||"🏴‍☠️"),
        e("div",{style:{flex:1,minWidth:0}},
          e("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:6}},
            e("span",{style:{fontFamily:"'Cinzel',serif",fontSize:13,color:r.total?"#e8dcc8":"#666",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},r.name),
            e("span",{style:{fontFamily:"'Cinzel',serif",fontSize:13,fontWeight:700,color:m.color,flexShrink:0,marginLeft:8}},r.total ? `${pct}%` : "—")
          ),
          e("div",{style:{background:"#0a0a0a",borderRadius:10,height:6,overflow:"hidden"}},
            e("div",{style:{height:"100%",width:`${pct}%`,background:m.color,borderRadius:10,transition:"width .6s ease"}})
          ),
          e("div",{style:{display:"flex",justifyContent:"space-between",marginTop:5}},
            e("span",{style:{color:m.color,fontSize:10,textTransform:"uppercase",letterSpacing:1}},m.title),
            e("span",{style:{color:"#555",fontSize:10}},`${r.correct}/${r.total} correct`)
          )
        )
      );
    }),
    e("p",{style:{color:"#333",fontSize:11,textAlign:"center",fontStyle:"italic",marginTop:18,lineHeight:1.6}},"A category needs 3 answers before yer rank in it is judged.")
  );
}

function SettingsScreen({onBack,username,userNotices,notificationsEnabled,setNotificationsEnabled,forceSyncToFirebase,onSaveName,onDismissNotice}){
  const [nameInput,setNameInput]=useState(username);
  const [changed,setChanged]=useState(false);
  const [error,setError]=useState("");
  const [syncStatus,setSyncStatus]=useState(null); // null | "syncing" | "ok" | "fail"
  const e=React.createElement;
  const handleSave=()=>{
    if(!nameInput.trim()){setError("Name can't be empty, matey!");return;}
    if(nameInput.trim()===username){setError("That's already yer name!");return;}
    onSaveName(nameInput.trim());
  };
  return e("div",{style:{maxWidth:480,margin:"0 auto",padding:"36px 24px 32px"}},
    onBack&&e("button",{onClick:onBack,style:{background:"none",border:"none",color:"#8a7040",fontSize:13,padding:"0 0 14px",fontFamily:"Lato,sans-serif"}},"← Back to Profile"),
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
    e("div",{style:{background:"#121212",border:"1px solid #1e1e1e",borderRadius:16,padding:"24px",marginBottom:20}},
      e("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}},
        e("div",null,
          e("p",{style:{fontFamily:"'Cinzel',serif",fontSize:15,color:"#e8dcc8",marginBottom:3}},"🔔 New Question Alerts"),
          e("p",{style:{color:"#555",fontSize:12}},"Get notified when new questions are ready")
        ),
        e("button",{
          onClick: async ()=>{
            if(notificationsEnabled){
              await disableNotifications(username);
              setNotificationsEnabled(false);
            } else {
              const ok = await requestNotificationPermission(username);
              setNotificationsEnabled(ok);
              if(!ok) alert("Notification permission was denied. Check your browser settings to enable it.");
            }
          },
          style:{
            background: notificationsEnabled ? "#1a3a1a" : "#1a1a1a",
            border: notificationsEnabled ? "1px solid #2ecc71" : "1px solid #2a2a2a",
            borderRadius:24, padding:"8px 20px",
            color: notificationsEnabled ? "#2ecc71" : "#666",
            fontSize:13, fontFamily:"Lato,sans-serif", fontWeight:700,
            cursor:"pointer", minWidth:80,
          }
        }, notificationsEnabled ? "ON" : "OFF")
      ),
      notificationsEnabled
        ? e("p",{style:{color:"#2a5a2a",fontSize:12,borderTop:"1px solid #1a2a1a",paddingTop:10}},"✅ Ye will receive notifications when new questions are available!")
        : e("p",{style:{color:"#444",fontSize:12,borderTop:"1px solid #1a1a1a",paddingTop:10}},"Tap OFF to enable — yer browser will ask for permission.")
    ),
    e("div",{style:{background:"#121212",border:"1px solid #1e1e1e",borderRadius:16,padding:"24px",marginBottom:20}},
      e("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}},
        e("div",null,
          e("p",{style:{fontFamily:"'Cinzel',serif",fontSize:15,color:"#e8dcc8",marginBottom:3}},"🔄 Sync My Scores"),
          e("p",{style:{color:"#555",fontSize:12}},"Force sync local scores to Firebase")
        ),
        e("button",{
          onClick:async()=>{
            setSyncStatus("syncing");
            const ok=await forceSyncToFirebase();
            setSyncStatus(ok?"ok":"fail");
            setTimeout(()=>setSyncStatus(null),3000);
          },
          disabled:syncStatus==="syncing",
          style:{
            background:syncStatus==="ok"?"#1a3a1a":syncStatus==="fail"?"#3a1a1a":"#1a1a1a",
            border:syncStatus==="ok"?"1px solid #2ecc71":syncStatus==="fail"?"1px solid #e05555":"1px solid #2a2a2a",
            borderRadius:24,padding:"8px 20px",
            color:syncStatus==="ok"?"#2ecc71":syncStatus==="fail"?"#e05555":"#888",
            fontSize:13,fontFamily:"Lato,sans-serif",fontWeight:700,cursor:"pointer",minWidth:80,
          }
        },
          syncStatus==="syncing"?"Syncing…":syncStatus==="ok"?"Done! ✅":syncStatus==="fail"?"Failed ❌":"Sync Now"
        )
      ),
      e("p",{style:{color:"#444",fontSize:12,borderTop:"1px solid #1a1a1a",paddingTop:10}},"Use this if yer scores or answers aren't showing up for the crew. It merges yer local data with Firebase.")
    ),
    e("div",{style:{background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:14,padding:"18px 20px"}},
      e("p",{style:{color:"#3a3a3a",fontSize:12,lineHeight:1.6}},"⚓  Yer name is saved to this device. Changing it won't affect yer score history — scores are tied to yer previous name.")
    )
  );
}

// ── Boot the app ──────────────────────────────────────────────────────────────
const root = createRoot(document.getElementById("root"));
root.render(React.createElement(App));
