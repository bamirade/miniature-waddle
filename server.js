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
const QUESTION_TIME = 15; // seconds per question
let players = {}; // id -> { ws, name, emoji, lives, score, streak, alive, powerUp, team }
let fastestThisRound = null; // { id, name, timeMs }
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
  const timeFraction = Math.max(0, 1 - answerTimeMs / (QUESTION_TIME * 1000));
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
  if (currentQuestionIdx >= QUESTIONS.length) {
    endGame();
    return;
  }

  answersThisRound = new Set();
  fastestThisRound = null;
  questionStartTime = Date.now();
  const q = QUESTIONS[currentQuestionIdx];
  const aliveCount = Object.values(players).filter((p) => p.alive).length;
  const totalPlayers = Object.keys(players).length;

  // Host sees full question
  sendTo(hostWs, {
    type: "question",
    index: currentQuestionIdx,
    total: QUESTIONS.length,
    question: q.question,
    choices: q.choices,
    aliveCount,
    totalPlayers,
    timeLimit: QUESTION_TIME,
  });

  // Students see question + two choices + their streak
  Object.entries(players).forEach(([id, p]) => {
    if (!p.alive) return;
    sendTo(p.ws, {
      type: "question",
      index: currentQuestionIdx,
      total: QUESTIONS.length,
      question: q.question,
      choices: q.choices,
      streak: p.streak,
      powerUp: p.powerUp,
      timeLimit: QUESTION_TIME,
    });
  });

  // Timer
  questionTimer = setTimeout(() => {
    // Anyone who didn't answer loses a life and breaks streak
    Object.entries(players).forEach(([id, p]) => {
      if (p.alive && !answersThisRound.has(id)) {
        p.lives--;
        p.streak = 0;
        if (p.lives <= 0) p.alive = false;
      }
    });
    revealAnswer();
  }, QUESTION_TIME * 1000);
}

function revealAnswer() {
  const q = QUESTIONS[currentQuestionIdx];
  const list = playerList();
  const ranks = getRanks();
  const aliveCount = Object.values(players).filter((p) => p.alive).length;

  sendTo(hostWs, {
    type: "reveal",
    answer: q.answer,
    players: list,
    index: currentQuestionIdx,
    total: QUESTIONS.length,
    aliveCount,
    fastest: fastestThisRound ? fastestThisRound.name : null,
    fastestEmoji: fastestThisRound ? fastestThisRound.emoji : null,
    teamMode,
    teamScores: teamMode ? teamScores() : null,
  });

  Object.entries(players).forEach(([id, p]) => {
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
    });
    delete p._lastPoints;
    delete p._shieldUsed;
    delete p._wasDouble;
    delete p._newPowerUp;
  });

  // Next question after 4 seconds (with intermission every 5 questions)
  setTimeout(() => {
    const anyAlive = Object.values(players).some((p) => p.alive);
    if (!anyAlive) {
      endGame();
    } else if ((currentQuestionIdx + 1) % 5 === 0 && currentQuestionIdx + 1 < QUESTIONS.length) {
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
    questionsTotal: QUESTIONS.length,
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
  const rankings = Object.values(players)
    .map((p) => ({ name: p.name, emoji: p.emoji, score: p.score, lives: p.lives, team: p.team }))
    .sort((a, b) => b.score - a.score || b.lives - a.lives);

  broadcast({ type: "finished", rankings, teamMode, teamScores: teamMode ? teamScores() : null });
}

function resetGame() {
  gameRunning = false;
  gamePaused = false;
  pausedRemaining = 0;
  currentQuestionIdx = -1;
  answersThisRound = new Set();
  if (questionTimer) clearTimeout(questionTimer);
  Object.values(players).forEach((p) => {
    p.lives = 3;
    p.score = 0;
    p.streak = 0;
    p.alive = true;
    p.powerUp = null;
    // keep emoji and team across restarts
  });
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
          lives: 3,
          score: 0,
          streak: 0,
          alive: true,
          powerUp: null,
          team: null,
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
        sendTo(ws, { type: "registered", name, emoji, lives: 3, team: players[playerId].team, teamMode });
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
        const p = players[playerId];
        if (!p.alive) return;
        if (answersThisRound.has(playerId)) return;
        answersThisRound.add(playerId);

        const q = QUESTIONS[currentQuestionIdx];
        const answerTime = Date.now() - questionStartTime;

        // Track fastest correct answer
        if (msg.choice === q.answer && (!fastestThisRound || answerTime < fastestThisRound.timeMs)) {
          fastestThisRound = { id: playerId, name: p.name, emoji: p.emoji, timeMs: answerTime };
        }

        if (msg.choice === q.answer) {
          p.streak++;
          const pts = calcPoints(answerTime, p.streak);
          const finalPts = p.powerUp === 'double' ? pts * 2 : pts;
          p.score += finalPts;
          p._lastPoints = finalPts;
          p._wasDouble = p.powerUp === 'double';
          if (p.powerUp === 'double') p.powerUp = null;
          // Award power-up randomly on streak
          if (p.streak >= 3 && !p.powerUp && Math.random() < 0.25) {
            p.powerUp = Math.random() < 0.5 ? 'double' : 'shield';
            p._newPowerUp = p.powerUp;
          }
        } else if (p.powerUp === 'shield') {
          p.powerUp = null;
          p._shieldUsed = true;
          p.streak = 0;
          p._lastPoints = 0;
        } else {
          p.streak = 0;
          p.lives--;
          p._lastPoints = 0;
          if (p.lives <= 0) p.alive = false;
        }

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
        pausedRemaining = Math.max(0, QUESTION_TIME * 1000 - elapsed);
        clearTimeout(questionTimer);
        broadcast({ type: "paused" });
        break;
      }

      case "resume": {
        if (!isHost || !gameRunning || !gamePaused) return;
        gamePaused = false;
        questionStartTime = Date.now() - (QUESTION_TIME * 1000 - pausedRemaining);
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

      case "reaction": {
        if (!playerId || !players[playerId] || !gameRunning) return;
        const emoji = String(msg.emoji || "");
        if (!["\uD83D\uDE31", "\uD83C\uDF89", "\uD83D\uDE24", "\uD83E\uDD2F"].includes(emoji)) return;
        if (hostWs)
          sendTo(hostWs, {
            type: "reaction",
            name: players[playerId].name,
            emoji,
            avatar: players[playerId].emoji,
          });
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
