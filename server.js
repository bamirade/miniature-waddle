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

// ── Game state ──────────────────────────────────────────────────
const QUESTION_TIME = 15; // seconds per question
let players = {}; // id -> { ws, name, lives, score, streak, alive, powerUp }
let fastestThisRound = null; // { id, name, timeMs }
let hostWs = null;
let gameRunning = false;
let currentQuestionIdx = -1;
let answersThisRound = new Set();
let questionTimer = null;
let questionStartTime = 0; // ms timestamp when question was sent
let nextPlayerId = 1;

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
      lives: p.lives,
      score: p.score,
      streak: p.streak,
      alive: p.alive,
      powerUp: p.powerUp,
    }))
    .sort((a, b) => b.score - a.score || b.lives - a.lives);
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
  if (hostWs) sendTo(hostWs, { type: "lobby", players: list });
  Object.values(players).forEach((p) =>
    sendTo(p.ws, { type: "lobby", players: list })
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
      ? { name: streakLeader.name, streak: streakLeader.streak }
      : null,
  });
  setTimeout(() => sendQuestion(), 6000);
}

function endGame() {
  gameRunning = false;
  const rankings = Object.values(players)
    .map((p) => ({ name: p.name, score: p.score, lives: p.lives }))
    .sort((a, b) => b.score - a.score || b.lives - a.lives);

  broadcast({ type: "finished", rankings });
}

function resetGame() {
  gameRunning = false;
  currentQuestionIdx = -1;
  answersThisRound = new Set();
  if (questionTimer) clearTimeout(questionTimer);
  Object.values(players).forEach((p) => {
    p.lives = 3;
    p.score = 0;
    p.streak = 0;
    p.alive = true;
    p.powerUp = null;
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
        sendTo(ws, { type: "lobby", players: playerList() });
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
        players[playerId] = {
          ws,
          name,
          lives: 3,
          score: 0,
          streak: 0,
          alive: true,
          powerUp: null,
        };
        sendTo(ws, { type: "registered", name, lives: 3 });
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
        gameRunning = true;
        broadcast({ type: "game-start" });
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
          fastestThisRound = { id: playerId, name: p.name, timeMs: answerTime };
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

      case "reaction": {
        if (!playerId || !players[playerId] || !gameRunning) return;
        const emoji = String(msg.emoji || "");
        if (!["\uD83D\uDE31", "\uD83C\uDF89", "\uD83D\uDE24", "\uD83E\uDD2F"].includes(emoji)) return;
        if (hostWs)
          sendTo(hostWs, {
            type: "reaction",
            name: players[playerId].name,
            emoji,
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
