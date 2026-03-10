(function initHostPage() {
  if (typeof io !== 'function') {
    document.body.innerHTML = '<main><p style="text-align:center;color:var(--error);">Socket.IO unavailable</p></main>';
    return;
  }

  const socket = io();
  let currentPhase = 'lobby';
  let previousPhase = null;
  let lobbyData = null;
  let currentRound = null;
  let flashTimerInterval = null;
  let flashEndTime = null;

  // Prevent accidental host dashboard close during active game
  window.addEventListener('beforeunload', (e) => {
    // Warn if game is in progress
    if (currentPhase && currentPhase !== 'lobby') {
      e.preventDefault();
      e.returnValue = 'Game in progress. Close dashboard anyway?';
      return 'Game in progress. Close dashboard anyway?';
    }
  });

  // AI Simulation
  let aiSimulation = null;
  if (window.AISimulation) {
    try {
      aiSimulation = new window.AISimulation();
      if (aiSimulation && typeof aiSimulation.init === 'function') {
        aiSimulation.init(() => io('/', {
          forceNew: true,
          reconnection: true,
          timeout: 8000
        }));
      }
    } catch (err) {
      console.warn('AI Simulation init failed:', err);
      aiSimulation = null;
    }
  }

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
    podium: document.getElementById('podium'),
    flashOverlay: document.getElementById('flash-overlay'),
    flashQuestion: document.getElementById('flash-question'),
    flashOptions: document.getElementById('flash-options'),
    flashTimer: document.getElementById('flash-timer'),
    flashRound: document.getElementById('flash-round'),
    // AI Controls
    aiToggleButton: document.getElementById('ai-toggle-button'),
    aiBotCountSlider: document.getElementById('ai-bot-count-slider'),
    aiBotCountValue: document.getElementById('ai-bot-count-value'),
    aiDifficultySelect: document.getElementById('ai-difficulty-select'),
    aiStatus: document.getElementById('ai-status')
  };

  function initJoinInfo() {
    fetch('/config')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Server returned status ${res.status}`);
        }
        return res.json();
      })
      .then((config) => {
        if (!config || typeof config !== 'object') {
          throw new Error('Invalid config response');
        }
        const joinUrl = config.joinUrl || `http://${config.ip || 'localhost'}:${config.port || 3000}/`;
        if (elements.joinUrl) {
          elements.joinUrl.textContent = joinUrl;
        }

        if (elements.qrCode && typeof QRCode === 'function') {
          try {
            elements.qrCode.innerHTML = '';
            new QRCode(elements.qrCode, {
              text: joinUrl,
              width: 160,
              height: 160,
              colorDark: '#000000',
              colorLight: '#ffffff',
              correctLevel: QRCode.CorrectLevel.M
            });
          } catch (err) {
            console.warn('QR code generation failed:', err);
          }
        }
      })
      .catch((err) => {
        console.error('Failed to load config:', err);
        if (elements.joinUrl) {
          elements.joinUrl.textContent = 'Error: Cannot load join URL';
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
          // Show lives for alive players during game
          if (currentPhase !== 'lobby' && typeof player.lives === 'number') {
            metaText = `${player.lives} ❤️`;
          } else {
            metaText = 'alive';
          }
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

  // Flash Overlay Management
  function showFlashOverlay(question, roundNumber, endsAt, slotsLeft) {
    if (!elements.flashOverlay || !question) return;

    // Set round number
    if (elements.flashRound) {
      elements.flashRound.textContent = `Round ${roundNumber}`;
    }

    // Set question text
    if (elements.flashQuestion) {
      elements.flashQuestion.textContent = question.text || '';
    }

    // Render options
    renderFlashOptions(question, slotsLeft);

    // Start timer
    if (endsAt) {
      startFlashTimer(endsAt);
    }

    // Show overlay
    elements.flashOverlay.classList.remove('hidden');
  }

  function hideFlashOverlay() {
    if (elements.flashOverlay) {
      elements.flashOverlay.classList.add('hidden');
    }
    stopFlashTimer();
  }

  function renderFlashOptions(question, slotsLeft) {
    if (!elements.flashOptions || !question) return;

    elements.flashOptions.innerHTML = '';

    question.options.forEach((optionText, index) => {
      const slots = slotsLeft ? slotsLeft[index] : 1;

      const option = document.createElement('div');
      option.className = 'flash-option';
      option.setAttribute('data-option-index', index);

      if (slots === 0) {
        option.classList.add('full');
      }

      const label = document.createElement('div');
      label.className = 'flash-option-label';
      label.textContent = String.fromCharCode(65 + index);

      const text = document.createElement('div');
      text.className = 'flash-option-text';
      text.textContent = optionText;

      option.appendChild(label);
      option.appendChild(text);

      elements.flashOptions.appendChild(option);
    });
  }

  function startFlashTimer(endsAt) {
    if (!elements.flashTimer) return;

    flashEndTime = endsAt;
    elements.flashTimer.classList.remove('critical');

    if (flashTimerInterval) {
      clearInterval(flashTimerInterval);
    }

    flashTimerInterval = setInterval(() => {
      if (!flashEndTime) {
        clearInterval(flashTimerInterval);
        return;
      }

      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((flashEndTime - now) / 1000));

      if (elements.flashTimer) {
        elements.flashTimer.textContent = `${remaining}s`;

        if (remaining <= 3) {
          elements.flashTimer.classList.add('critical');
        }
      }

      if (remaining === 0) {
        clearInterval(flashTimerInterval);
        flashTimerInterval = null;
      }
    }, 100);
  }

  function stopFlashTimer() {
    if (flashTimerInterval) {
      clearInterval(flashTimerInterval);
      flashTimerInterval = null;
    }
    flashEndTime = null;
  }

  function updateFlashOptions(slotsLeft) {
    if (!elements.flashOptions || !currentRound || !currentRound.question) return;

    const options = elements.flashOptions.querySelectorAll('.flash-option');
    options.forEach((option, index) => {
      const slots = slotsLeft ? slotsLeft[index] : 1;
      if (slots === 0) {
        option.classList.add('full');
      } else {
        option.classList.remove('full');
      }
    });
  }

  function renderOptions(question, capacities, pickedCounts, slotsLeft) {
    if (!elements.optionsDisplay || !question) return;

    elements.optionsDisplay.innerHTML = '';

    question.options.forEach((optionText, index) => {
      const capacity = capacities[index] || 0;
      const picked = pickedCounts[index] || 0;
      const slots = slotsLeft[index] || 0;
      const percentage = capacity > 0 ? Math.round((picked / capacity) * 100) : 0;

      // Hide options that are full (0 slots left)
      if (slots === 0) {
        return;
      }

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
    const newPhase = data.phase || 'lobby';
    onPhaseChange(newPhase);

    updateStats(data);
    renderPlayerList(data.players || []);
    updateStartButton(data.canStart, data.phase || 'lobby');
  });

  socket.on('game:state', (data) => {
    if (!data) return;

    const phase = data.phase;
    onPhaseChange(phase);

    if (phase === 'lobby') {
      currentPhase = 'lobby';
      hideFlashOverlay();
      showCard(null);
      if (data.lobby) {
        updateStats(data.lobby);
        renderPlayerList(data.lobby.players || []);
        updateStartButton(data.lobby.canStart, phase);
      }
    } else if (phase === 'countdown') {
      currentPhase = 'countdown';
      hideFlashOverlay();
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

        // Show flash overlay
        showFlashOverlay(
          data.round.question,
          data.round.roundNumber || 1,
          data.round.endsAt,
          data.round.slotsLeft || [0, 0, 0, 0]
        );

        showCard('round');
      }

      if (data.lobby) {
        updateStats(data.lobby);
        renderPlayerList(data.lobby.players || []);
      }
    } else if (phase === 'reveal') {
      hideFlashOverlay();
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
      hideFlashOverlay();
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

    onPhaseChange('round');
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

    // Show flash overlay
    showFlashOverlay(
      data.question,
      data.roundNumber || 1,
      data.endsAt,
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

      // Update flash overlay
      updateFlashOptions(data.slotsLeft || [0, 0, 0, 0]);
    } else if (data.type === 'reveal') {
      hideFlashOverlay();
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

    onPhaseChange('finished');
    hideFlashOverlay();
    renderResults(data);
    showCard('results');
  });

  // Handle life lost events
  socket.on('game:playerLifeLost', (data) => {
    if (!data || !lobbyData) return;

    // Update player's lives in local lobby data
    const player = (lobbyData.players || []).find(p => p.id === data.playerId);
    if (player && typeof data.livesRemaining === 'number') {
      player.lives = data.livesRemaining;
      renderPlayerList(lobbyData.players || []);
    }
  });

  // Handle player elimination events
  socket.on('game:playerEliminated', (data) => {
    if (!data || !lobbyData) return;

    // Update player's status in local lobby data
    const player = (lobbyData.players || []).find(p => p.id === data.playerId);
    if (player) {
      player.status = 'eliminated';
      player.lives = 0;
      player.eliminatedRound = data.roundNumber;
      player.eliminationReason = data.reason;
      renderPlayerList(lobbyData.players || []);
      updateStats({
        ...lobbyData,
        aliveCount: (lobbyData.players || []).filter(p => p.status === 'alive').length
      });
    }
  });

  if (elements.startButton) {
    elements.startButton.addEventListener('click', () => {
      socket.emit('host:start', {});
      elements.startButton.disabled = true;
    });
  }

  // AI Simulation Controls
  function updateAIStatus(enabled) {
    if (!elements.aiStatus) return;

    if (!aiSimulation) {
      elements.aiStatus.textContent = 'AI simulation unavailable';
      elements.aiStatus.classList.remove('active');
      return;
    }

    if (enabled) {
      const status = aiSimulation.getStatus();
      const joinedCount = status.joinedCount || 0;
      const targetCount = status.targetBotCount || status.botCount || 0;
      const readyCount = status.readyCount || 0;
      elements.aiStatus.textContent = `${joinedCount}/${targetCount} joined, ${readyCount} ready`;
      elements.aiStatus.classList.add('active');
    } else {
      elements.aiStatus.textContent = 'AI bots disabled';
      elements.aiStatus.classList.remove('active');
    }
  }

  function updateAIControls() {
    if (!aiSimulation) {
      if (elements.aiToggleButton) {
        elements.aiToggleButton.disabled = true;
      }
      if (elements.aiBotCountSlider) {
        elements.aiBotCountSlider.disabled = true;
      }
      if (elements.aiDifficultySelect) {
        elements.aiDifficultySelect.disabled = true;
      }
      updateAIStatus(false);
      return;
    }

    const status = aiSimulation.getStatus();
    const isLobby = currentPhase === 'lobby';

    // Update toggle button
    if (elements.aiToggleButton) {
      elements.aiToggleButton.textContent = status.enabled ? 'Disable AI Bots' : 'Enable AI Bots';
      elements.aiToggleButton.classList.toggle('active', status.enabled);

      // Can only toggle AI in lobby phase or when disabling
      elements.aiToggleButton.disabled = !isLobby && !status.enabled;
    }

    // Update slider and select - disabled when bots are active or not in lobby
    if (elements.aiBotCountSlider) {
      elements.aiBotCountSlider.disabled = status.enabled || !isLobby;
    }
    if (elements.aiDifficultySelect) {
      elements.aiDifficultySelect.disabled = status.enabled || !isLobby;
    }

    updateAIStatus(status.enabled);
  }

  if (aiSimulation && elements.aiToggleButton) {
    elements.aiToggleButton.addEventListener('click', () => {
      const status = aiSimulation.getStatus();

      if (status.enabled) {
        aiSimulation.disable();
        if (window.appCommon && window.appCommon.showToast) {
          window.appCommon.showToast('AI bots disabled', 'info', 2000);
        }
      } else {
        if (currentPhase === 'lobby') {
          const botCount = parseInt(elements.aiBotCountSlider?.value || 5, 10);
          const difficulty = elements.aiDifficultySelect?.value || 'medium';

          const enabled = aiSimulation.enable({
            count: botCount,
            difficulty: difficulty
          });

          if (enabled && window.appCommon && window.appCommon.showToast) {
            window.appCommon.showToast(`${botCount} AI bots enabled`, 'success', 2000);
          }

          if (!enabled && window.appCommon && window.appCommon.showToast) {
            window.appCommon.showToast('Failed to enable AI bots', 'error', 2500);
          }
        }
      }

      updateAIControls();
    });
  }

  if (elements.aiBotCountSlider && elements.aiBotCountValue) {
    elements.aiBotCountSlider.addEventListener('input', (e) => {
      const value = e.target.value;
      elements.aiBotCountValue.textContent = value;

      if (aiSimulation) {
        aiSimulation.setBotCount(parseInt(value, 10));
      }
    });
  }

  if (elements.aiDifficultySelect && aiSimulation) {
    elements.aiDifficultySelect.addEventListener('change', (e) => {
      const difficulty = e.target.value;
      aiSimulation.setDifficulty(difficulty);
    });
  }

  // Update AI controls when phase changes
  function onPhaseChange(newPhase) {
    // Disable bots when returning to lobby from finished state (game restart)
    // Don't disable if already in lobby or during initial join
    if (currentPhase === 'finished' && newPhase === 'lobby' && aiSimulation) {
      const status = aiSimulation.getStatus();
      if (status.enabled) {
        aiSimulation.disable();
      }
    }

    previousPhase = currentPhase;
    currentPhase = newPhase;
    updateAIControls();
  }

  initJoinInfo();
  updateAIControls();
})();
