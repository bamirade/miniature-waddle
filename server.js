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
  {
    question: "What planet is known as the Red Planet?",
    choices: ["Mars", "Venus"],
    answer: "Mars",
  },
  {
    question: "What is the largest ocean on Earth?",
    choices: ["Pacific Ocean", "Atlantic Ocean"],
    answer: "Pacific Ocean",
  },
  {
    question: "Who painted the Mona Lisa?",
    choices: ["Leonardo da Vinci", "Michelangelo"],
    answer: "Leonardo da Vinci",
  },
  {
    question: "What is the chemical symbol for water?",
    choices: ["H2O", "CO2"],
    answer: "H2O",
  },
  {
    question: "Which country is the Great Wall located in?",
    choices: ["China", "Japan"],
    answer: "China",
  },
  {
    question: "How many continents are there?",
    choices: ["7", "6"],
    answer: "7",
  },
  {
    question: "What gas do plants absorb from the atmosphere?",
    choices: ["Carbon Dioxide", "Oxygen"],
    answer: "Carbon Dioxide",
  },
  {
    question: "What is the hardest natural substance?",
    choices: ["Diamond", "Iron"],
    answer: "Diamond",
  },
  {
    question: "Which planet is closest to the Sun?",
    choices: ["Mercury", "Venus"],
    answer: "Mercury",
  },
  {
    question: "What is the speed of light approximately?",
    choices: ["300,000 km/s", "150,000 km/s"],
    answer: "300,000 km/s",
  },
];

// ── Game state ──────────────────────────────────────────────────
let players = {}; // id -> { ws, name, lives, score, alive }
let hostWs = null;
let gameRunning = false;
let currentQuestionIdx = -1;
let answersThisRound = new Set();
let questionTimer = null;
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
  return Object.values(players).map((p) => ({
    name: p.name,
    lives: p.lives,
    score: p.score,
    alive: p.alive,
  }));
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
  const q = QUESTIONS[currentQuestionIdx];

  // Host sees full question
  sendTo(hostWs, {
    type: "question",
    index: currentQuestionIdx,
    total: QUESTIONS.length,
    question: q.question,
    choices: q.choices,
  });

  // Students see question + two choices
  Object.values(players).forEach((p) => {
    if (!p.alive) return;
    sendTo(p.ws, {
      type: "question",
      index: currentQuestionIdx,
      total: QUESTIONS.length,
      question: q.question,
      choices: q.choices,
    });
  });

  // 15-second timer per question
  questionTimer = setTimeout(() => {
    // Anyone who didn't answer loses a life
    Object.entries(players).forEach(([id, p]) => {
      if (p.alive && !answersThisRound.has(id)) {
        p.lives--;
        if (p.lives <= 0) p.alive = false;
      }
    });
    revealAnswer();
  }, 15000);
}

function revealAnswer() {
  const q = QUESTIONS[currentQuestionIdx];
  const list = playerList();

  sendTo(hostWs, {
    type: "reveal",
    answer: q.answer,
    players: list,
    index: currentQuestionIdx,
    total: QUESTIONS.length,
  });

  Object.values(players).forEach((p) => {
    sendTo(p.ws, {
      type: "reveal",
      answer: q.answer,
      lives: p.lives,
      alive: p.alive,
      score: p.score,
    });
  });

  // Next question after 4 seconds
  setTimeout(() => {
    const anyAlive = Object.values(players).some((p) => p.alive);
    if (!anyAlive) {
      endGame();
    } else {
      sendQuestion();
    }
  }, 4000);
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
    p.alive = true;
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
          alive: true,
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
        if (msg.choice === q.answer) {
          p.score++;
        } else {
          p.lives--;
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
