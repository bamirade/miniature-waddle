(function initStudentPage() {
  if (typeof io !== 'function') {
    document.body.innerHTML = '<main><p style="text-align:center;color:var(--error);">Socket.IO unavailable</p></main>';
    return;
  }

  const socket = io();
  let currentPhase = 'lobby';
  let myPlayerId = null;
  let isEliminated = false;
  let hasPicked = false;
  let currentRoundNumber = 0;
  let currentQuestion = null;
  let currentSlotsLeft = [0, 0, 0, 0];
  let roundEndTime = null;
  let timerInterval = null;

  const phases = {
    lobby: document.getElementById('phase-lobby'),
    countdown: document.getElementById('phase-countdown'),
    round: document.getElementById('phase-round'),
    eliminated: document.getElementById('phase-eliminated'),
    results: document.getElementById('phase-results')
  };

  const elements = {
    lobbyPlayerCount: document.getElementById('lobby-player-count'),
    countdownValue: document.getElementById('countdown-value'),
    roundNumber: document.getElementById('round-number'),
    questionText: document.getElementById('question-text'),
    optionsContainer: document.getElementById('options-container'),
    pickStatus: document.getElementById('pick-status'),
    eliminationReason: document.getElementById('elimination-reason'),
    resultsLeaderboard: document.getElementById('results-leaderboard'),
    connectionStatus: document.getElementById('connection-status'),
    connectionText: document.getElementById('connection-text'),
    roundTimer: document.getElementById('round-timer')
  };

  // Connection Status Management
  function updateConnectionStatus(status) {
    if (!elements.connectionStatus || !elements.connectionText) return;

    elements.connectionStatus.className = `connection-status ${status}`;

    const statusText = {
      connecting: 'Connecting...',
      connected: 'Live',
      disconnected: 'Disconnected'
    }[status] || 'Unknown';

    elements.connectionText.textContent = statusText;
  }

  // Round Timer Management
  function startRoundTimer(endsAt) {
    if (!elements.roundTimer) return;

    roundEndTime = endsAt;
    elements.roundTimer.classList.remove('hidden', 'critical');

    if (timerInterval) {
      clearInterval(timerInterval);
    }

    timerInterval = setInterval(() => {
      if (!roundEndTime) {
        clearInterval(timerInterval);
        return;
      }

      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((roundEndTime - now) / 1000));

      if (elements.roundTimer) {
        elements.roundTimer.textContent = `${remaining}s`;

        if (remaining <= 3) {
          elements.roundTimer.classList.add('critical');
        }
      }

      if (remaining === 0) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }, 100);
  }

  function stopRoundTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (elements.roundTimer) {
      elements.roundTimer.classList.add('hidden');
    }
    roundEndTime = null;
  }

  function showPhase(phaseName) {
    Object.keys(phases).forEach((key) => {
      const element = phases[key];
      if (element) {
        element.classList.toggle('hidden', key !== phaseName);
      }
    });
  }

  function renderOptions() {
    if (!currentQuestion || !elements.optionsContainer) {
      return;
    }

    elements.optionsContainer.innerHTML = '';

    const availableOptions = currentQuestion.options.filter((_, index) => {
      return (currentSlotsLeft[index] || 0) > 0;
    });

    // Empty state: all options are full
    if (availableOptions.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      emptyState.innerHTML = `
        <div class="empty-state-icon">⏳</div>
        <p>All options are full</p>
        <p style="font-size: 0.85rem; margin-top: 0.5rem;">Waiting for next round...</p>
      `;
      elements.optionsContainer.appendChild(emptyState);
      return;
    }

    currentQuestion.options.forEach((optionText, index) => {
      const slotsLeft = currentSlotsLeft[index] || 0;

      // Hide options that are full (0 slots left)
      if (slotsLeft === 0) {
        return;
      }

      const button = document.createElement('button');
      button.className = 'option-button';
      button.type = 'button';
      button.disabled = hasPicked || isEliminated;
      button.setAttribute('data-option-index', index);
      button.setAttribute('aria-label', `Option ${String.fromCharCode(65 + index)}: ${optionText}. ${slotsLeft} slot${slotsLeft !== 1 ? 's' : ''} remaining`);

      // Add urgent styling for last slot
      if (slotsLeft === 1 && !hasPicked) {
        button.classList.add('urgent');
        button.setAttribute('aria-description', 'Last slot available! Act fast!');
      }

      const label = document.createElement('span');
      label.className = 'option-label';
      label.textContent = String.fromCharCode(65 + index);

      const text = document.createElement('span');
      text.className = 'option-text';
      text.textContent = optionText;

      const slots = document.createElement('span');
      slots.className = 'option-slots';
      slots.textContent = `${slotsLeft} left`;
      if (slotsLeft <= 1) {
        slots.classList.add('low');
      }

      button.appendChild(label);
      button.appendChild(text);
      button.appendChild(slots);

      button.addEventListener('click', () => {
        if (!hasPicked && !isEliminated) {
          pickOption(index);
        }
      });

      elements.optionsContainer.appendChild(button);
    });
  }

  function pickOption(optionIndex) {
    hasPicked = true;
    socket.emit('player:pick', { option: optionIndex });

    // Visual feedback
    const buttons = elements.optionsContainer.querySelectorAll('.option-button');
    buttons.forEach((btn, idx) => {
      if (idx === optionIndex) {
        btn.classList.add('picked');
        btn.style.borderColor = 'var(--success)';
        btn.style.boxShadow = '0 0 0 2px var(--success), 0 0 16px var(--success-glow)';
      }
    });

    renderOptions();

    if (elements.pickStatus) {
      elements.pickStatus.classList.remove('hidden');
    }

    // Show success toast if available
    if (window.appCommon && window.appCommon.showToast) {
      window.appCommon.showToast('Choice locked in!', 'success', 2000);
    }
  }

  function updateSlots(slotsLeft) {
    currentSlotsLeft = slotsLeft || [0, 0, 0, 0];
    renderOptions();
  }

  function handleElimination(reason) {
    isEliminated = true;
    currentPhase = 'eliminated';
    stopRoundTimer();

    if (elements.eliminationReason) {
      const reasonText = {
        full: 'Option was full when you picked',
        timeout: 'You did not pick in time',
        wrong: 'You picked the wrong answer'
      }[reason] || 'You were eliminated';

      elements.eliminationReason.textContent = reasonText;
    }

    showPhase('eliminated');

    // Show elimination toast
    if (window.appCommon && window.appCommon.showToast) {
      window.appCommon.showToast('You have been eliminated', 'error', 3000);
    }
  }

  function renderResults(resultsData) {
    if (!resultsData || !elements.resultsLeaderboard) {
      return;
    }

    const leaderboard = resultsData.leaderboard || resultsData.top || [];
    elements.resultsLeaderboard.innerHTML = '';

    leaderboard.forEach((entry) => {
      const div = document.createElement('div');
      div.className = 'leaderboard-entry';

      if (entry.id === myPlayerId) {
        div.classList.add('me');
      }

      const rankBadge = document.createElement('div');
      rankBadge.className = 'rank-badge';
      rankBadge.textContent = `#${entry.rank}`;

      const nameDiv = document.createElement('div');
      nameDiv.className = 'player-name';
      nameDiv.textContent = entry.name;

      const statusDiv = document.createElement('div');
      statusDiv.className = 'player-status';
      if (entry.status === 'alive') {
        statusDiv.textContent = 'Winner';
      } else if (entry.eliminatedRound) {
        statusDiv.textContent = `R${entry.eliminatedRound}`;
      }

      div.appendChild(rankBadge);
      div.appendChild(nameDiv);
      div.appendChild(statusDiv);

      elements.resultsLeaderboard.appendChild(div);
    });
  }

  socket.on('connect', () => {
    myPlayerId = socket.id;
    updateConnectionStatus('connected');

    // Re-join with saved nickname (in case of page refresh or disconnect)
    const savedNickname = window.localStorage.getItem('nickname') || 'Player';
    socket.emit('player:join', { name: savedNickname });
    socket.emit('player:ready', {});
  });

  socket.on('disconnect', () => {
    updateConnectionStatus('disconnected');
    stopRoundTimer();
  });

  socket.on('reconnect', () => {
    updateConnectionStatus('connected');
  });

  socket.on('lobby:update', (data) => {
    if (!data) return;

    if (elements.lobbyPlayerCount) {
      elements.lobbyPlayerCount.textContent = `${data.totalPlayers || 0} player(s) joined`;
    }

    // Handle restart: if we're in results and receive lobby update, reset to lobby
    if (data.phase === 'lobby') {
      if (currentPhase === 'results' || currentPhase === 'finished') {
        currentPhase = 'lobby';
        isEliminated = false;
        hasPicked = false;
        currentRoundNumber = 0;
        currentQuestion = null;
      }
      stopRoundTimer();
      showPhase('lobby');
    }
  });

  socket.on('game:state', (data) => {
    if (!data) return;

    const phase = data.phase;

    if (phase === 'lobby') {
      currentPhase = 'lobby';
      isEliminated = false;
      hasPicked = false;
      currentRoundNumber = 0;
      currentQuestion = null;
      showPhase('lobby');
    } else if (phase === 'countdown') {
      currentPhase = 'countdown';
      stopRoundTimer();
      if (data.countdown && elements.countdownValue) {
        elements.countdownValue.textContent = data.countdown.secondsLeft || 3;
      }
      showPhase('countdown');
    } else if (phase === 'round') {
      if (isEliminated) {
        return;
      }

      currentPhase = 'round';
      if (data.round) {
        currentRoundNumber = data.round.roundNumber || 0;
        currentQuestion = data.round.question;
        currentSlotsLeft = data.round.slotsLeft || [0, 0, 0, 0];
        hasPicked = false;

        if (elements.roundNumber) {
          elements.roundNumber.textContent = `Round ${currentRoundNumber}`;
        }
        if (elements.questionText && currentQuestion) {
          elements.questionText.textContent = currentQuestion.text || '';
        }
        if (elements.pickStatus) {
          elements.pickStatus.classList.add('hidden');
        }

        // Start timer if endsAt is provided
        if (data.round.endsAt) {
          startRoundTimer(data.round.endsAt);
        }

        renderOptions();
        showPhase('round');
      }
    } else if (phase === 'reveal') {
      stopRoundTimer();
      if (!isEliminated && currentPhase === 'round') {
        showPhase('round');
      }
    } else if (phase === 'finished') {
      stopRoundTimer();
      currentPhase = 'results';
      if (data.results) {
        renderResults(data.results);
      }
      showPhase('results');
    }
  });

  socket.on('round:new', (data) => {
    if (!data || isEliminated) return;

    currentPhase = 'round';
    currentRoundNumber = data.roundNumber || 0;
    currentQuestion = data.question;
    currentSlotsLeft = data.slotsLeft || [0, 0, 0, 0];
    hasPicked = false;

    if (elements.roundNumber) {
      elements.roundNumber.textContent = `Round ${currentRoundNumber}`;
    }
    if (elements.questionText && currentQuestion) {
      elements.questionText.textContent = currentQuestion.text || '';
    }
    if (elements.pickStatus) {
      elements.pickStatus.classList.add('hidden');
    }

    renderOptions();
    showPhase('round');
  });

  socket.on('round:update', (data) => {
    if (!data) return;

    if (data.type === 'slots' && !isEliminated) {
      updateSlots(data.slotsLeft);
    } else if (data.type === 'elimination') {
      if (data.playerId === myPlayerId) {
        handleElimination(data.reason);
      }
    }
  });

  socket.on('player:result', (data) => {
    if (!data) return;

    if (data.eliminated && data.playerId === myPlayerId) {
      handleElimination(data.reason);
    } else if (data.status === 'accepted' && data.playerId === myPlayerId) {
      updateSlots(data.slotsLeft);
    }
  });

  socket.on('game:results', (data) => {
    if (!data) return;

    stopRoundTimer();
    currentPhase = 'results';
    renderResults(data);
    showPhase('results');
  });

  // Keyboard shortcuts for options (A, B, C, D)
  document.addEventListener('keydown', (event) => {
    if (currentPhase !== 'round' || hasPicked || isEliminated) {
      return;
    }

    const key = event.key.toLowerCase();
    const optionMap = { a: 0, b: 1, c: 2, d: 3 };

    if (key in optionMap) {
      const optionIndex = optionMap[key];
      const slotsLeft = currentSlotsLeft[optionIndex] || 0;

      // Only allow picking if option is available
      if (slotsLeft > 0) {
        pickOption(optionIndex);
        event.preventDefault();
      }
    }
  });

  // Initialize connection status
  updateConnectionStatus('connecting');
  showPhase('lobby');
})();
