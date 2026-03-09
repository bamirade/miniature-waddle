(function initHostPage() {
  if (typeof io !== 'function') {
    document.body.innerHTML = '<main><p style="text-align:center;color:var(--error);">Socket.IO unavailable</p></main>';
    return;
  }

  const socket = io();
  let currentPhase = 'lobby';
  let lobbyData = null;
  let currentRound = null;

  const elements = {
    qrCode: document.getElementById('qr-code'),
    joinUrl: document.getElementById('join-url'),
    statTotal: document.getElementById('stat-total'),
    statReady: document.getElementById('stat-ready'),
    statAlive: document.getElementById('stat-alive'),
    playerList: document.getElementById('player-list'),
    startButton: document.getElementById('start-button'),
    countdownCard: document.getElementById('countdown-card'),
    countdownValue: document.getElementById('countdown-value'),
    roundCard: document.getElementById('round-card'),
    roundNumber: document.getElementById('round-number'),
    roundTimer: document.getElementById('round-timer'),
    questionText: document.getElementById('question-text'),
    optionsDisplay: document.getElementById('options-display'),
    resultsCard: document.getElementById('results-card'),
    podium: document.getElementById('podium')
  };

  function initJoinInfo() {
    fetch('/config')
      .then((res) => res.json())
      .then((config) => {
        const joinUrl = config.joinUrl || 'http://localhost:3000/';
        if (elements.joinUrl) {
          elements.joinUrl.textContent = joinUrl;
        }

        if (elements.qrCode && typeof QRCode === 'function') {
          elements.qrCode.innerHTML = '';
          new QRCode(elements.qrCode, {
            text: joinUrl,
            width: 160,
            height: 160,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
          });
        }
      })
      .catch(() => {
        if (elements.joinUrl) {
          elements.joinUrl.textContent = 'Error loading join URL';
        }
      });
  }

  function updateStats(data) {
    if (!data) return;

    if (elements.statTotal) {
      elements.statTotal.textContent = data.totalPlayers || 0;
    }
    if (elements.statReady) {
      elements.statReady.textContent = data.readyCount || 0;
    }
    if (elements.statAlive) {
      elements.statAlive.textContent = data.aliveCount || 0;
    }
  }

  function renderPlayerList(players) {
    if (!elements.playerList || !players) return;

    if (players.length === 0) {
      elements.playerList.innerHTML = '<p class="muted">No players yet</p>';
      return;
    }

    elements.playerList.innerHTML = '';

    players.forEach((player) => {
      const entry = document.createElement('div');
      entry.className = 'player-entry';

      const badge = document.createElement('div');
      badge.className = 'player-status-badge';

      let badgeClass = '';
      let metaText = '';
      if (player.status === 'eliminated') {
        badgeClass = 'eliminated';
        metaText = `R${player.eliminatedRound || '?'} - ${player.eliminationReason || 'out'}`;
      } else if (player.status === 'alive') {
        if (currentPhase === 'lobby' && player.ready) {
          badgeClass = 'ready';
          metaText = 'ready';
        } else {
          badgeClass = 'alive';
          metaText = 'alive';
        }
      }

      badge.classList.add(badgeClass);

      const name = document.createElement('div');
      name.className = 'player-name';
      name.textContent = player.name || 'Player';

      const meta = document.createElement('div');
      meta.className = 'player-meta';
      meta.textContent = metaText;

      entry.appendChild(badge);
      entry.appendChild(name);
      if (metaText) {
        entry.appendChild(meta);
      }

      elements.playerList.appendChild(entry);
    });
  }

  function updateStartButton(canStart, phase) {
    if (!elements.startButton) return;

    if (phase === 'finished') {
      elements.startButton.textContent = 'New Game';
      elements.startButton.disabled = false;
    } else if (phase === 'lobby') {
      elements.startButton.textContent = 'Start Game';
      elements.startButton.disabled = !canStart;
    } else {
      elements.startButton.disabled = true;
    }
  }

  function showCard(cardName) {
    const cards = {
      countdown: elements.countdownCard,
      round: elements.roundCard,
      results: elements.resultsCard
    };

    Object.keys(cards).forEach((key) => {
      const card = cards[key];
      if (card) {
        card.classList.toggle('hidden', key !== cardName);
      }
    });

    if (cardName === null) {
      Object.values(cards).forEach((card) => {
        if (card) card.classList.add('hidden');
      });
    }
  }

  function renderOptions(question, capacities, pickedCounts, slotsLeft) {
    if (!elements.optionsDisplay || !question) return;

    elements.optionsDisplay.innerHTML = '';

    question.options.forEach((optionText, index) => {
      const capacity = capacities[index] || 0;
      const picked = pickedCounts[index] || 0;
      const slots = slotsLeft[index] || 0;
      const percentage = capacity > 0 ? Math.round((picked / capacity) * 100) : 0;

      const bar = document.createElement('div');
      bar.className = 'option-bar';

      const header = document.createElement('div');
      header.className = 'option-header';

      const label = document.createElement('div');
      label.className = 'option-label';
      label.textContent = String.fromCharCode(65 + index);

      const text = document.createElement('div');
      text.className = 'option-text';
      text.textContent = optionText;

      header.appendChild(label);
      header.appendChild(text);

      const stats = document.createElement('div');
      stats.className = 'option-stats';

      const pickedStat = document.createElement('div');
      pickedStat.className = 'option-stat';
      pickedStat.innerHTML = `<span class="option-stat-label">Picked:</span><span class="option-stat-value">${picked}</span>`;

      const capacityStat = document.createElement('div');
      capacityStat.className = 'option-stat';
      capacityStat.innerHTML = `<span class="option-stat-label">Capacity:</span><span class="option-stat-value">${capacity}</span>`;

      const slotsStat = document.createElement('div');
      slotsStat.className = 'option-stat';
      slotsStat.innerHTML = `<span class="option-stat-label">Slots left:</span><span class="option-stat-value">${slots}</span>`;

      stats.appendChild(pickedStat);
      stats.appendChild(capacityStat);
      stats.appendChild(slotsStat);

      const progress = document.createElement('div');
      progress.className = 'option-progress';

      const fill = document.createElement('div');
      fill.className = 'option-progress-fill';
      fill.style.width = `${percentage}%`;
      fill.textContent = `${picked} / ${capacity}`;

      if (slots === 0) {
        fill.classList.add('full');
      }

      progress.appendChild(fill);

      bar.appendChild(header);
      bar.appendChild(stats);
      bar.appendChild(progress);

      elements.optionsDisplay.appendChild(bar);
    });
  }

  function renderResults(resultsData) {
    if (!elements.podium || !resultsData) return;

    const top = resultsData.top || [];
    elements.podium.innerHTML = '';

    top.forEach((entry) => {
      const podiumEntry = document.createElement('div');
      podiumEntry.className = 'podium-entry';

      const rank = document.createElement('div');
      rank.className = 'podium-rank';
      rank.textContent = `#${entry.rank}`;

      const name = document.createElement('div');
      name.className = 'podium-name';
      name.textContent = entry.name;

      podiumEntry.appendChild(rank);
      podiumEntry.appendChild(name);

      elements.podium.appendChild(podiumEntry);
    });
  }

  socket.on('connect', () => {
    initJoinInfo();
  });

  socket.on('lobby:update', (data) => {
    if (!data) return;

    lobbyData = data;
    currentPhase = data.phase || 'lobby';

    updateStats(data);
    renderPlayerList(data.players || []);
    updateStartButton(data.canStart, data.phase || 'lobby');
  });

  socket.on('game:state', (data) => {
    if (!data) return;

    const phase = data.phase;

    if (phase === 'lobby') {
      currentPhase = 'lobby';
      showCard(null);
      if (data.lobby) {
        updateStats(data.lobby);
        renderPlayerList(data.lobby.players || []);
        updateStartButton(data.lobby.canStart, phase);
      }
    } else if (phase === 'countdown') {
      currentPhase = 'countdown';
      if (data.countdown && elements.countdownValue) {
        elements.countdownValue.textContent = data.countdown.secondsLeft || 3;
      }
      showCard('countdown');
    } else if (phase === 'round') {
      currentPhase = 'round';
      if (data.round) {
        currentRound = data.round;

        if (elements.roundNumber) {
          elements.roundNumber.textContent = `Round ${data.round.roundNumber || 1}`;
        }
        if (elements.questionText && data.round.question) {
          elements.questionText.textContent = data.round.question.text || '';
        }

        renderOptions(
          data.round.question,
          data.round.capacities || [0, 0, 0, 0],
          data.round.pickedCounts || [0, 0, 0, 0],
          data.round.slotsLeft || [0, 0, 0, 0]
        );

        showCard('round');
      }

      if (data.lobby) {
        updateStats(data.lobby);
        renderPlayerList(data.lobby.players || []);
      }
    } else if (phase === 'reveal') {
      if (currentRound && data.round) {
        renderOptions(
          data.round.question,
          data.round.capacities || [0, 0, 0, 0],
          data.round.pickedCounts || [0, 0, 0, 0],
          data.round.slotsLeft || [0, 0, 0, 0]
        );
      }

      if (data.lobby) {
        renderPlayerList(data.lobby.players || []);
      }
    } else if (phase === 'finished') {
      currentPhase = 'finished';
      if (data.results) {
        renderResults(data.results);
        showCard('results');
      }

      if (data.lobby) {
        updateStats(data.lobby);
        renderPlayerList(data.lobby.players || []);
        updateStartButton(false, 'finished');
      }
    }
  });

  socket.on('round:new', (data) => {
    if (!data) return;

    currentPhase = 'round';
    currentRound = data;

    if (elements.roundNumber) {
      elements.roundNumber.textContent = `Round ${data.roundNumber || 1}`;
    }
    if (elements.questionText && data.question) {
      elements.questionText.textContent = data.question.text || '';
    }

    renderOptions(
      data.question,
      data.capacities || [0, 0, 0, 0],
      data.pickedCounts || [0, 0, 0, 0],
      data.slotsLeft || [0, 0, 0, 0]
    );

    showCard('round');
  });

  socket.on('round:update', (data) => {
    if (!data || !currentRound) return;

    if (data.type === 'slots' && currentPhase === 'round') {
      renderOptions(
        currentRound.question,
        data.capacities || [0, 0, 0, 0],
        data.pickedCounts || [0, 0, 0, 0],
        data.slotsLeft || [0, 0, 0, 0]
      );
    } else if (data.type === 'reveal') {
      if (data.question) {
        currentRound.question = data.question;
      }
      renderOptions(
        data.question || currentRound.question,
        currentRound.capacities || [0, 0, 0, 0],
        data.pickedByOption ? data.pickedByOption.map((arr) => arr.length) : [0, 0, 0, 0],
        [0, 0, 0, 0]
      );
    }
  });

  socket.on('game:results', (data) => {
    if (!data) return;

    currentPhase = 'finished';
    renderResults(data);
    showCard('results');
  });

  if (elements.startButton) {
    elements.startButton.addEventListener('click', () => {
      socket.emit('host:start', {});
      elements.startButton.disabled = true;
    });
  }

  initJoinInfo();
})();
