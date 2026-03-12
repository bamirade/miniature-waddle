const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));

// ── Sample questions ────────────────────────────────────────────
const QUESTIONS = [
  { question: "What planet is known as the Red Planet?", choices: ["Mars", "Venus"], answer: "Mars" },
  { question: "What is the largest ocean on Earth?", choices: ["Pacific Ocean", "Atlantic Ocean"], answer: "Pacific Ocean" },
  { question: "Who painted the Mona Lisa?", choices: ["Leonardo da Vinci", "Michelangelo"], answer: "Leonardo da Vinci" },
  { question: "What is the chemical symbol for water?", choices: ["H2O", "CO2"], answer: "H2O" },
  { question: "Which country is the Great Wall located in?", choices: ["China", "Japan"], answer: "China" },
  { question: "How many continents are there?", choices: ["7", "6"], answer: "7" },
  { question: "What gas do plants absorb from the atmosphere?", choices: ["Carbon Dioxide", "Oxygen"], answer: "Carbon Dioxide" },
  { question: "What is the hardest natural substance?", choices: ["Diamond", "Iron"], answer: "Diamond" },
  { question: "Which planet is closest to the Sun?", choices: ["Mercury", "Venus"], answer: "Mercury" },
  { question: "What is the speed of light approximately?", choices: ["300,000 km/s", "150,000 km/s"], answer: "300,000 km/s" },
  { question: "What is the powerhouse of the cell?", choices: ["Mitochondria", "Nucleus"], answer: "Mitochondria" },
  { question: "Which element has the symbol 'O'?", choices: ["Oxygen", "Gold"], answer: "Oxygen" },
  { question: "What is the tallest mountain on Earth?", choices: ["Mount Everest", "K2"], answer: "Mount Everest" },
  { question: "Which organ pumps blood through the body?", choices: ["Heart", "Liver"], answer: "Heart" },
  { question: "How many bones are in the adult human body?", choices: ["206", "300"], answer: "206" },
  { question: "What is the largest planet in our solar system?", choices: ["Jupiter", "Saturn"], answer: "Jupiter" },
  { question: "Which animal is the largest mammal?", choices: ["Blue Whale", "Elephant"], answer: "Blue Whale" },
  { question: "What force keeps us on the ground?", choices: ["Gravity", "Magnetism"], answer: "Gravity" },
  { question: "Which language has the most native speakers?", choices: ["Mandarin Chinese", "English"], answer: "Mandarin Chinese" },
  { question: "What is the boiling point of water in Celsius?", choices: ["100°C", "90°C"], answer: "100°C" },
];

// ── Emoji avatars ───────────────────────────────────────────────
const AVATAR_EMOJIS = [
  '🐶','🐱','🐼','🦊','🐸','🐵','🐷','🐰','🐻','🦁',
  '🐮','🐨','🐯','🐔','🦄','🐙','🦋','🐢','🦉','🐧',
  '🐳','🦈','🐲','🐝','🐞','🦀','🐠','🦩','🦜','🐺',
];
function randomEmoji() {
  return AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)];
}

// ── Game state ──────────────────────────────────────────────────
let gameSettings = {
  timer: 15,        // seconds per question
  lives: 3,         // starting lives
  questionCount: 20, // how many questions to use
  enableWager: true,
  enableRevenge: true,
  enablePowerUps: true,
  enableSteal: true, // fastest steals from slowest each round
};
// Wager tuning
const WAGER_MAX_FRACTION = 0.33; // max fraction of a player's score they may wager
const WAGER_WIN_MULTIPLIER = 0.5; // fraction of wager awarded as bonus on correct answer
let players = {}; // id -> { ws, name, emoji, lives, score, streak, alive, powerUp, team, frozen, stats }
let fastestThisRound = null; // { id, name, timeMs, emoji }
let slowestThisRound = null; // { id, name, timeMs }
let stealInfo = null; // { from, to, amount } for reveal display
let hostWs = null;
let gameRunning = false;
let gamePaused = false;
let currentQuestionIdx = -1;
let answersThisRound = new Set();
let questionTimer = null;
let questionStartTime = 0; // ms timestamp when question was sent
let pausedRemaining = 0; // ms remaining when paused
let nextPlayerId = 1;
let teamMode = false;
let isWagerRound = false;
let revengeActive = false;
let activeQuestions = []; // subset of QUESTIONS used for current game
let currentRevenge = { active: false, question: null, answer: null, choices: null, answers: new Set(), timer: null };

const TEAMS = [
  { name: 'Red', color: '#f44336', icon: '🔴' },
  { name: 'Blue', color: '#2196f3', icon: '🔵' },
];

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(msg);
  });
}

function sendTo(ws, data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

function playerList() {
  return Object.values(players)
    .map((p) => ({
      name: p.name,
      emoji: p.emoji,
      lives: p.lives,
      score: p.score,
      streak: p.streak,
      alive: p.alive,
      powerUp: p.powerUp,
      team: p.team,
      spectating: !p.alive && p.lives <= 0,
    }))
    .sort((a, b) => b.score - a.score || b.lives - a.lives);
}

function teamScores() {
  const scores = {};
  TEAMS.forEach((t) => { scores[t.name] = 0; });
  Object.values(players).forEach((p) => {
    if (p.team && scores[p.team] !== undefined) scores[p.team] += p.score;
  });
  return TEAMS.map((t) => ({ name: t.name, color: t.color, icon: t.icon, score: scores[t.name] }));
}

// Compute rank position for each player id
function getRanks() {
  const sorted = Object.entries(players)
    .map(([id, p]) => ({ id, score: p.score, lives: p.lives }))
    .sort((a, b) => b.score - a.score || b.lives - a.lives);
  const ranks = {};
  sorted.forEach((s, i) => { ranks[s.id] = i + 1; });
  return ranks;
}

// Speed bonus: 1000 base, up to 500 bonus for speed, streak multiplier
function calcPoints(answerTimeMs, streak) {
  const timeFraction = Math.max(0, 1 - answerTimeMs / (gameSettings.timer * 1000));
  const speedBonus = Math.round(timeFraction * 500);
  const base = 1000 + speedBonus;
  const multiplier = streak >= 5 ? 2 : streak >= 3 ? 1.5 : 1;
  return Math.round(base * multiplier);
}

function sendLobbyUpdate() {
  const list = playerList();
  const payload = { type: "lobby", players: list, teamMode };
  if (hostWs) sendTo(hostWs, payload);
  Object.values(players).forEach((p) =>
    sendTo(p.ws, payload)
  );
}

function sendQuestion() {
  currentQuestionIdx++;
  if (currentQuestionIdx >= activeQuestions.length) {
    endGame();
    return;
  }

  answersThisRound = new Set();
  fastestThisRound = null;
  slowestThisRound = null;
  stealInfo = null;
  questionStartTime = Date.now();
  isWagerRound = gameSettings.enableWager && (currentQuestionIdx + 1) % 10 === 0;
  // Reset wagers for this question so players must submit a fresh wager
  if (isWagerRound) {
    Object.values(players).forEach((p) => { p.wager = null; });
  }
  const q = activeQuestions[currentQuestionIdx];
  const aliveCount = Object.values(players).filter((p) => p.alive).length;
  const totalPlayers = Object.keys(players).length;

  // Apply freeze power-ups: find players who have freeze, pick a random opponent to freeze
  if (gameSettings.enablePowerUps) {
    Object.entries(players).forEach(([id, p]) => {
      if (p.alive && p.powerUp === 'freeze') {
        const targets = Object.entries(players).filter(([tid, tp]) => tid !== id && tp.alive && !tp.frozen);
        if (targets.length > 0) {
          const [tid, tp] = targets[Math.floor(Math.random() * targets.length)];
          tp.frozen = 3; // frozen for 3 seconds
          sendTo(tp.ws, { type: 'frozen', frozenBy: p.name, duration: 3 });
          sendTo(p.ws, { type: 'freeze-used', target: tp.name });
          // Schedule server-side unfreeze after duration so server will accept answers again
          setTimeout(() => {
            try { tp.frozen = 0; } catch (e) {}
          }, 3000);
        }
        p.powerUp = null;
      }
    });
  }

  // Host sees full question
  sendTo(hostWs, {
    type: "question",
    index: currentQuestionIdx,
    total: activeQuestions.length,
    question: q.question,
    choices: q.choices,
    aliveCount,
    totalPlayers,
    timeLimit: gameSettings.timer,
    wager: isWagerRound,
  });

  // Students see question + two choices + their streak
  Object.entries(players).forEach(([id, p]) => {
    if (!p.alive) {
      // Spectators still see the question
      sendTo(p.ws, {
        type: "spectate-question",
        index: currentQuestionIdx,
        total: activeQuestions.length,
        question: q.question,
        choices: q.choices,
        timeLimit: gameSettings.timer,
        wager: isWagerRound,
      });
      return;
    }
    sendTo(p.ws, {
      type: "question",
      index: currentQuestionIdx,
      total: activeQuestions.length,
      question: q.question,
      choices: q.choices,
      streak: p.streak,
      powerUp: p.powerUp,
      timeLimit: gameSettings.timer,
      wager: isWagerRound,
      score: p.score,
      frozen: p.frozen || 0,
    });
  });

  // Timer
  questionTimer = setTimeout(() => {
    // Anyone who didn't answer loses a life and breaks streak
    Object.entries(players).forEach(([id, p]) => {
      if (p.alive && !answersThisRound.has(id)) {
        p.lives--;
        p.stats.livesLost++;
        p.stats.wrong++;
        p.streak = 0;
        if (p.lives <= 0) p.alive = false;
      }
    });
    revealAnswer();
  }, gameSettings.timer * 1000);
}

function revealAnswer() {
  const q = activeQuestions[currentQuestionIdx];

  // Point steal: fastest correct steals from slowest correct
  if (gameSettings.enableSteal && fastestThisRound && slowestThisRound && fastestThisRound.id !== slowestThisRound.id) {
    const stealAmt = 150;
    const victim = players[slowestThisRound.id];
    const thief = players[fastestThisRound.id];
    if (victim && thief && victim.score >= stealAmt) {
      victim.score -= stealAmt;
      thief.score += stealAmt;
      stealInfo = { from: victim.name, fromEmoji: victim.emoji, to: thief.name, toEmoji: thief.emoji, amount: stealAmt };
    }
  }

  // Clear frozen status for next round
  Object.values(players).forEach(p => { p.frozen = 0; });

  const list = playerList();
  const ranks = getRanks();
  const aliveCount = Object.values(players).filter((p) => p.alive).length;

  sendTo(hostWs, {
    type: "reveal",
    answer: q.answer,
    players: list,
    index: currentQuestionIdx,
    total: activeQuestions.length,
    aliveCount,
    fastest: fastestThisRound ? fastestThisRound.name : null,
    fastestEmoji: fastestThisRound ? fastestThisRound.emoji : null,
    steal: stealInfo,
    teamMode,
    teamScores: teamMode ? teamScores() : null,
    wager: isWagerRound,
  });

  Object.entries(players).forEach(([id, p]) => {
    if (!p.alive && !p._lastPoints) {
      // Spectators see reveal too
      sendTo(p.ws, {
        type: "spectate-reveal",
        answer: q.answer,
        players: list,
        wager: isWagerRound,
        lives: p.lives,
      });
      return;
    }
    sendTo(p.ws, {
      type: "reveal",
      answer: q.answer,
      lives: p.lives,
      alive: p.alive,
      score: p.score,
      streak: p.streak,
      rank: ranks[id] || 0,
      totalPlayers: Object.keys(players).length,
      pointsEarned: p._lastPoints || 0,
      shieldUsed: p._shieldUsed || false,
      wasDouble: p._wasDouble || false,
      newPowerUp: p._newPowerUp || null,
      powerUp: p.powerUp,
      steal: stealInfo,
    });
    delete p._lastPoints;
    delete p._shieldUsed;
    delete p._wasDouble;
    delete p._newPowerUp;
  });

  // Next question after 4 seconds (with intermission every 5 questions)
  setTimeout(() => {
    const anyAlive = Object.values(players).some((p) => p.alive);
    const eliminated = Object.values(players).filter((p) => !p.alive);
    if (!anyAlive) {
      endGame();
    } else if (gameSettings.enableRevenge && eliminated.length > 0 && (currentQuestionIdx + 1) % 7 === 0 && currentQuestionIdx + 1 < activeQuestions.length) {
      startRevengeRound();
    } else if ((currentQuestionIdx + 1) % 5 === 0 && currentQuestionIdx + 1 < activeQuestions.length) {
      sendIntermission();
    } else {
      sendQuestion();
    }
  }, 4000);
}

function sendIntermission() {
  const list = playerList();
  const streakLeader = Object.values(players)
    .filter((p) => p.alive && p.streak >= 2)
    .sort((a, b) => b.streak - a.streak)[0];
  broadcast({
    type: "intermission",
    rankings: list,
    questionsCompleted: currentQuestionIdx + 1,
    questionsTotal: activeQuestions.length,
    streakLeader: streakLeader
      ? { name: streakLeader.name, emoji: streakLeader.emoji, streak: streakLeader.streak }
      : null,
    teamMode,
    teamScores: teamMode ? teamScores() : null,
  });
  setTimeout(() => sendQuestion(), 6000);
}

function endGame() {
  gameRunning = false;
  gamePaused = false;
  revengeActive = false;

  // Compute awards
  const allPlayers = Object.values(players);
  const awards = [];
  // Speed Demon: fastest avg response time (min 3 answers)
  const withAnswers = allPlayers.filter(p => p.stats.answers >= 3);
  if (withAnswers.length > 0) {
    const fastest = withAnswers.reduce((a, b) => (a.stats.totalTime / a.stats.answers) < (b.stats.totalTime / b.stats.answers) ? a : b);
    awards.push({ title: 'Speed Demon', icon: '\u26A1', name: fastest.name, emoji: fastest.emoji, detail: Math.round(fastest.stats.totalTime / fastest.stats.answers) + 'ms avg' });
  }
  // Iron Will: never lost a life
  const ironWill = allPlayers.filter(p => p.stats.livesLost === 0 && p.stats.answers > 0);
  if (ironWill.length > 0) {
    ironWill.forEach(p => awards.push({ title: 'Iron Will', icon: '\uD83D\uDEE1\uFE0F', name: p.name, emoji: p.emoji, detail: 'Never lost a life' }));
  }
  // Hot Streak: longest streak
  const streakSorted = [...allPlayers].sort((a, b) => b.stats.bestStreak - a.stats.bestStreak);
  if (streakSorted.length > 0 && streakSorted[0].stats.bestStreak >= 3) {
    const s = streakSorted[0];
    awards.push({ title: 'Hot Streak', icon: '\uD83D\uDD25', name: s.name, emoji: s.emoji, detail: s.stats.bestStreak + ' in a row' });
  }
  // Comeback Kid: lowest score at intermission who ended top half (approximate: lost lives but still alive)
  const comebackCandidates = allPlayers.filter(p => p.stats.livesLost > 0 && p.alive);
  if (comebackCandidates.length > 0) {
    const ranked = [...allPlayers].sort((a, b) => b.score - a.score);
    const topHalf = ranked.slice(0, Math.ceil(ranked.length / 2));
    const comeback = comebackCandidates.find(p => topHalf.some(t => t.name === p.name));
    if (comeback) {
      awards.push({ title: 'Comeback Kid', icon: '\uD83D\uDCAA', name: comeback.name, emoji: comeback.emoji, detail: 'Survived ' + comeback.stats.livesLost + ' life loss(es)' });
    }
  }

  const rankings = allPlayers
    .map((p) => ({
      name: p.name, emoji: p.emoji, score: p.score, lives: p.lives, team: p.team,
      stats: {
        accuracy: p.stats.answers > 0 ? Math.round((p.stats.correct / p.stats.answers) * 100) : 0,
        avgTime: p.stats.answers > 0 ? Math.round(p.stats.totalTime / p.stats.answers) : 0,
        bestStreak: p.stats.bestStreak,
        correct: p.stats.correct,
        wrong: p.stats.wrong,
      },
    }))
    .sort((a, b) => b.score - a.score || b.lives - a.lives);

  broadcast({ type: "finished", rankings, awards, teamMode, teamScores: teamMode ? teamScores() : null });
}

function resetGame() {
  gameRunning = false;
  gamePaused = false;
  pausedRemaining = 0;
  currentQuestionIdx = -1;
  answersThisRound = new Set();
  isWagerRound = false;
  revengeActive = false;
  stealInfo = null;
  fastestThisRound = null;
  slowestThisRound = null;
  // Build active question set based on settings
  const shuffled = [...QUESTIONS].sort(() => Math.random() - 0.5);
  activeQuestions = shuffled.slice(0, Math.min(gameSettings.questionCount, QUESTIONS.length));
  if (questionTimer) clearTimeout(questionTimer);
  Object.values(players).forEach((p) => {
    p.lives = gameSettings.lives;
    p.score = 0;
    p.streak = 0;
    p.alive = true;
    p.powerUp = null;
    p.wager = null;
    p.frozen = 0;
    p.stats = { correct: 0, wrong: 0, totalTime: 0, answers: 0, bestStreak: 0, livesLost: 0 };
    // keep emoji and team across restarts
  });
}

// ── Revenge Round ─────────────────────────────────────────────
function startRevengeRound() {
  revengeActive = true;
  const eliminated = Object.entries(players).filter(([, p]) => !p.alive);
  if (eliminated.length === 0) { revengeActive = false; sendQuestion(); return; }

  // Pick a random question from remaining pool (don't advance index)
  const remainingQs = activeQuestions.filter((_, i) => i > currentQuestionIdx);
  const rq = remainingQs.length > 0 ? remainingQs[Math.floor(Math.random() * remainingQs.length)] : activeQuestions[Math.floor(Math.random() * activeQuestions.length)];
  const REVENGE_TIME = 10;

  // Initialize global revenge state so main message handler can process answers
  if (currentRevenge.timer) { clearTimeout(currentRevenge.timer); }
  currentRevenge.active = true;
  currentRevenge.question = rq.question;
  currentRevenge.answer = rq.answer;
  currentRevenge.choices = rq.choices;
  currentRevenge.answers = new Set();

  // Notify everyone
  broadcast({
    type: "revenge-start",
    question: rq.question,
    choices: rq.choices,
    timeLimit: REVENGE_TIME,
    eliminatedNames: eliminated.map(([, p]) => p.name),
  });

  // Timer for revenge round: finalize after REVENGE_TIME seconds
  currentRevenge.timer = setTimeout(() => {
    const revived = eliminated.filter(([id]) => players[id] && players[id].alive).map(([, p]) => p.name);
    broadcast({ type: "revenge-end", answer: rq.answer, revived });
    revengeActive = false;
    currentRevenge.active = false;
    currentRevenge.answers.clear();
    currentRevenge.timer = null;
    // Continue game after brief pause
    setTimeout(() => sendQuestion(), 3000);
  }, REVENGE_TIME * 1000);
}

function assignTeams() {
  const ids = Object.keys(players);
  // Shuffle for fairness
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  ids.forEach((id, i) => {
    players[id].team = TEAMS[i % TEAMS.length].name;
  });
}

// ── WebSocket handling ──────────────────────────────────────────
wss.on("connection", (ws) => {
  let playerId = null;
  let isHost = false;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "host-join": {
        isHost = true;
        hostWs = ws;
        sendTo(ws, { type: "host-ok" });
        sendTo(ws, { type: "lobby", players: playerList(), teamMode });
        sendTo(ws, { type: "settings-updated", settings: gameSettings });
        break;
      }

      case "register": {
        const name = String(msg.name || "").trim().slice(0, 30);
        if (!name) {
          sendTo(ws, { type: "error", message: "Name is required" });
          return;
        }
        if (gameRunning) {
          sendTo(ws, { type: "error", message: "Game already in progress" });
          return;
        }
        playerId = String(nextPlayerId++);
        const emoji = randomEmoji();
        players[playerId] = {
          ws,
          name,
          emoji,
          lives: gameSettings.lives,
          score: 0,
          streak: 0,
          alive: true,
          powerUp: null,
          team: null,
          wager: null,
          frozen: 0,
          stats: { correct: 0, wrong: 0, totalTime: 0, answers: 0, bestStreak: 0, livesLost: 0 },
        };
        // Auto-assign team if team mode is on
        if (teamMode) {
          const counts = {};
          TEAMS.forEach((t) => { counts[t.name] = 0; });
          Object.values(players).forEach((p) => {
            if (p.team) counts[p.team] = (counts[p.team] || 0) + 1;
          });
          const smallest = TEAMS.reduce((a, b) => (counts[a.name] <= counts[b.name] ? a : b));
          players[playerId].team = smallest.name;
        }
        sendTo(ws, { type: "registered", name, emoji, lives: gameSettings.lives, team: players[playerId].team, teamMode });
        sendLobbyUpdate();
        break;
      }

      case "start": {
        if (!isHost) return;
        if (Object.keys(players).length === 0) {
          sendTo(ws, { type: "error", message: "No players have joined" });
          return;
        }
        resetGame();
        if (teamMode) assignTeams();
        gameRunning = true;
        broadcast({ type: "game-start", teamMode });
        setTimeout(() => sendQuestion(), 2000);
        break;
      }

      case "answer": {
        if (!gameRunning || !playerId || !players[playerId]) return;
        if (revengeActive) return;
        const p = players[playerId];
        if (!p.alive) return;
        if (answersThisRound.has(playerId)) return;
        // Ignore answers while player is frozen
        if (p.frozen && p.frozen > 0) {
          sendTo(ws, { type: 'answer-ignored', reason: 'frozen' });
          return;
        }
        answersThisRound.add(playerId);

        const q = activeQuestions[currentQuestionIdx];
        const answerTime = Date.now() - questionStartTime;

        // Track stats
        p.stats.totalTime += answerTime;
        p.stats.answers++;

        // Track fastest correct answer
        if (msg.choice === q.answer && (!fastestThisRound || answerTime < fastestThisRound.timeMs)) {
          fastestThisRound = { id: playerId, name: p.name, emoji: p.emoji, timeMs: answerTime };
        }
        // Track slowest correct answer (for steal)
        if (msg.choice === q.answer && (!slowestThisRound || answerTime > slowestThisRound.timeMs)) {
          slowestThisRound = { id: playerId, name: p.name, timeMs: answerTime };
        }

        // Wager round: capture/validate wager (either via place-wager earlier or included here)
        if (isWagerRound) {
          if (typeof msg.wager === 'number') {
            const amt = Math.max(0, Math.floor(msg.wager));
            const maxAllowed = Math.floor(p.score * WAGER_MAX_FRACTION);
            p.wager = Math.min(amt, maxAllowed);
          }
          if (p.wager === null || p.wager === undefined) p.wager = 0;
        }

        if (msg.choice === q.answer) {
          p.streak++;
          p.stats.correct++;
          if (p.streak > p.stats.bestStreak) p.stats.bestStreak = p.streak;
          if (isWagerRound && p.wager > 0) {
            // Wager grants a moderated bonus in addition to normal points
            const basePts = calcPoints(answerTime, p.streak);
            const wagerBonus = Math.round(p.wager * WAGER_WIN_MULTIPLIER);
            let finalPts = basePts + wagerBonus;
            p._wasDouble = false;
            if (p.powerUp === 'double') {
              finalPts = finalPts * 2;
              p._wasDouble = true;
              p.powerUp = null;
            }
            p.score += finalPts;
            p._lastPoints = finalPts;
          } else {
            const pts = calcPoints(answerTime, p.streak);
            const finalPts = p.powerUp === 'double' ? pts * 2 : pts;
            p.score += finalPts;
            p._lastPoints = finalPts;
            p._wasDouble = p.powerUp === 'double';
            if (p.powerUp === 'double') p.powerUp = null;
          }
          // Award power-up randomly on streak (shield, double, or freeze)
          if (gameSettings.enablePowerUps && p.streak >= 3 && !p.powerUp && Math.random() < 0.25) {
            const r = Math.random();
            p.powerUp = r < 0.33 ? 'double' : r < 0.66 ? 'shield' : 'freeze';
            p._newPowerUp = p.powerUp;
          }
        } else if (p.powerUp === 'shield') {
          p.powerUp = null;
          p._shieldUsed = true;
          p.streak = 0;
          p._lastPoints = 0;
          p.stats.wrong++;
        } else {
          p.streak = 0;
          p.stats.wrong++;
          if (isWagerRound && p.wager > 0) {
            p.score = Math.max(0, p.score - p.wager);
            p._lastPoints = -p.wager;
          } else {
            p.lives--;
            p.stats.livesLost++;
            p._lastPoints = 0;
            if (p.lives <= 0) p.alive = false;
          }
        }
        p.wager = null;

        sendTo(ws, { type: "answer-ack" });

        // Update host with live answer count
        if (hostWs) {
          const aliveCount = Object.values(players).filter(
            (pl) => pl.alive
          ).length;
          sendTo(hostWs, {
            type: "answer-count",
            answered: answersThisRound.size,
            total: aliveCount,
          });
        }

        // If all alive players answered, skip timer
        const aliveIds = Object.entries(players)
          .filter(([, pl]) => pl.alive)
          .map(([id]) => id);
        if (aliveIds.every((id) => answersThisRound.has(id))) {
          clearTimeout(questionTimer);
          revealAnswer();
        }
        break;
      }

      case "revenge-answer": {
        // Eliminated players submit answers during an active revenge round
        if (!gameRunning || !playerId || !players[playerId]) return;
        if (!currentRevenge || !currentRevenge.active) return;
        const rp = players[playerId];
        // Only eliminated players participate
        if (rp.alive) return;
        if (currentRevenge.answers.has(playerId)) return;
        currentRevenge.answers.add(playerId);
        if (typeof msg.choice === 'string' && msg.choice === currentRevenge.answer) {
          rp.alive = true;
          rp.lives = 1;
          rp.streak = 0;
          sendTo(rp.ws, { type: "revenge-result", revived: true });
        } else {
          sendTo(rp.ws, { type: "revenge-result", revived: false, answer: currentRevenge.answer });
        }
        break;
      }

      case "restart": {
        if (!isHost) return;
        resetGame();
        sendLobbyUpdate();
        broadcast({ type: "restarted" });
        break;
      }

      case "toggle-teams": {
        if (!isHost || gameRunning) return;
        teamMode = !teamMode;
        // Re-assign teams or clear
        if (teamMode) {
          assignTeams();
        } else {
          Object.values(players).forEach((p) => { p.team = null; });
        }
        sendLobbyUpdate();
        break;
      }

      case "pause": {
        if (!isHost || !gameRunning || gamePaused) return;
        gamePaused = true;
        // Capture how much time remains on the question timer
        const elapsed = Date.now() - questionStartTime;
        pausedRemaining = Math.max(0, gameSettings.timer * 1000 - elapsed);
        clearTimeout(questionTimer);
        broadcast({ type: "paused" });
        break;
      }

      case "resume": {
        if (!isHost || !gameRunning || !gamePaused) return;
        gamePaused = false;
        questionStartTime = Date.now() - (gameSettings.timer * 1000 - pausedRemaining);
        questionTimer = setTimeout(() => {
          Object.entries(players).forEach(([id, p]) => {
            if (p.alive && !answersThisRound.has(id)) {
              p.lives--;
              p.streak = 0;
              if (p.lives <= 0) p.alive = false;
            }
          });
          revealAnswer();
        }, pausedRemaining);
        broadcast({ type: "resumed", remaining: pausedRemaining });
        break;
      }

      case "skip": {
        if (!isHost || !gameRunning) return;
        gamePaused = false;
        clearTimeout(questionTimer);
        // No penalty for unanswered on skip
        revealAnswer();
        break;
      }

      case "kick": {
        if (!isHost) return;
        const kickName = String(msg.name || "");
        const kickEntry = Object.entries(players).find(([, p]) => p.name === kickName);
        if (!kickEntry) return;
        const [kickId, kickPlayer] = kickEntry;
        sendTo(kickPlayer.ws, { type: "kicked" });
        try { kickPlayer.ws.close(); } catch (e) {}
        delete players[kickId];
        if (!gameRunning) {
          sendLobbyUpdate();
        } else if (hostWs) {
          const aliveCount = Object.values(players).filter((pl) => pl.alive).length;
          sendTo(hostWs, { type: "answer-count", answered: answersThisRound.size, total: aliveCount });
        }
        break;
      }

      case "update-emoji": {
        if (!playerId || !players[playerId]) return;
        const newEmoji = String(msg.emoji || "");
        if (newEmoji.length === 0 || newEmoji.length > 4) return;
        players[playerId].emoji = newEmoji;
        sendTo(ws, { type: "emoji-updated", emoji: newEmoji });
        if (!gameRunning) sendLobbyUpdate();
        break;
      }

      case "update-settings": {
        if (!isHost || gameRunning) return;
        if (typeof msg.timer === 'number' && [5, 10, 15, 20, 30].includes(msg.timer)) gameSettings.timer = msg.timer;
        if (typeof msg.lives === 'number' && msg.lives >= 1 && msg.lives <= 5) gameSettings.lives = Math.floor(msg.lives);
        if (typeof msg.questionCount === 'number' && [5, 10, 15, 20].includes(msg.questionCount)) gameSettings.questionCount = msg.questionCount;
        if (typeof msg.enableWager === 'boolean') gameSettings.enableWager = msg.enableWager;
        if (typeof msg.enableRevenge === 'boolean') gameSettings.enableRevenge = msg.enableRevenge;
        if (typeof msg.enablePowerUps === 'boolean') gameSettings.enablePowerUps = msg.enablePowerUps;
        if (typeof msg.enableSteal === 'boolean') gameSettings.enableSteal = msg.enableSteal;
        sendTo(ws, { type: 'settings-updated', settings: gameSettings });
        break;
      }

      case "reaction": {
        if (!playerId || !players[playerId] || !gameRunning) return;
        const emoji = String(msg.emoji || "");
        if (!["\uD83D\uDE31", "\uD83C\uDF89", "\uD83D\uDE24", "\uD83E\uDD2F"].includes(emoji)) return;
        // Allow both alive players and spectators to react
        if (hostWs)
          sendTo(hostWs, {
            type: "reaction",
            name: players[playerId].name,
            emoji,
            avatar: players[playerId].emoji,
          });
        break;
      }
      case "place-wager": {
        if (!gameRunning || !playerId || !players[playerId]) {
          sendTo(ws, { type: 'error', message: 'Cannot place wager right now' });
          return;
        }
        if (!isWagerRound) {
          sendTo(ws, { type: 'error', message: 'Not a wager round' });
          return;
        }
        const p = players[playerId];
        if (!p.alive) {
          sendTo(ws, { type: 'error', message: 'Eliminated players cannot wager' });
          return;
        }
        const raw = Math.max(0, Math.floor(Number(msg.amount) || 0));
        const maxAllowed = Math.floor(p.score * WAGER_MAX_FRACTION);
        if (maxAllowed <= 0) {
          sendTo(ws, { type: 'error', message: 'Not enough points to place a wager' });
          return;
        }
        const amount = Math.min(raw, maxAllowed);
        p.wager = amount;
        sendTo(ws, { type: 'wager-placed', amount });
        if (hostWs) sendTo(hostWs, { type: 'wager-placed', name: p.name, amount });
        break;
      }
    }
  });

  ws.on("close", () => {
    if (isHost) {
      hostWs = null;
    }
    if (playerId && players[playerId]) {
      delete players[playerId];
      if (!gameRunning) sendLobbyUpdate();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
