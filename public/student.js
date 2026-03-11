(function initStudentPage() {
  if (typeof io !== 'function') {
    document.body.innerHTML = '<main><p style="text-align:center;color:var(--error);">Socket.IO unavailable</p></main>';
    return;
  }

  const socket = io();
  let currentPhase = 'lobby';
  let myPlayerId = null;
  let myLives = 3;
  let isEliminated = false;
  let hasPicked = false;
  let currentRoundNumber = 0;
  let currentQuestion = null;
  let currentSlotsLeft = [0, 0, 0, 0];
  let roundEndTime = null;
  let timerInterval = null;
  let lastAnnouncement = '';

  const LOCKED_IN_COPY = 'Answer locked. Waiting for reveal.';
  const REVEAL_WAIT_COPY = 'Checking answers...';

  // Prevent accidental navigation during active game
  window.addEventListener('beforeunload', (e) => {
    // Warn if game is in progress (not in lobby phase)
    if (currentPhase && currentPhase !== 'lobby') {
      e.preventDefault();
      e.returnValue = 'Game in progress. Leave anyway?';
      return 'Game in progress. Leave anyway?';
    }
  });

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
    phaseAnnouncer: document.getElementById('phase-announcer'),
    phaseIndicator: document.getElementById('phase-indicator'),
    roundTimer: document.getElementById('round-timer'),
    livesDisplay: document.getElementById('lives-display'),
    livesText: document.getElementById('lives-text')
  };

  // Connection Status Management
  function updateConnectionStatus(status) {
    if (!elements.connectionStatus || !elements.connectionText) return;

    elements.connectionStatus.className = `connection-status ${status}`;

    const statusText = {
      connecting: 'Connecting',
      connected: 'Connected',
      disconnected: 'Offline'
    }[status] || 'Unknown';

    elements.connectionText.textContent = statusText;
    elements.connectionStatus.setAttribute('aria-label', `Connection status: ${statusText}`);
  }

  function announcePhaseMessage(message) {
    if (!elements.phaseAnnouncer || !message || message === lastAnnouncement) {
      return;
    }

    lastAnnouncement = message;
    elements.phaseAnnouncer.textContent = message;
  }

  function setCurrentPhase(phaseName) {
    currentPhase = phaseName;

    const indicatorLabel = {
      lobby: 'Lobby',
      countdown: 'Countdown',
      round: 'Choose Now',
      reveal: 'Reveal',
      eliminated: 'Eliminated',
      results: 'Final Standings'
    }[phaseName] || 'Live';

    if (elements.phaseIndicator) {
      elements.phaseIndicator.textContent = indicatorLabel;
      elements.phaseIndicator.dataset.state = phaseName;
    }

    const message = {
      lobby: "You're in the lobby. Keep this screen open. Round starts on host countdown.",
      countdown: 'Round starts in.',
      round: 'Choose before slots fill.',
      reveal: REVEAL_WAIT_COPY,
      eliminated: 'You have been eliminated. Waiting for final standings.',
      results: 'Final standings.'
    }[phaseName];

    announcePhaseMessage(message);
  }

  function setPickStatus(message, visible, state = 'locked') {
    if (!elements.pickStatus) {
      return;
    }

    elements.pickStatus.textContent = message;
    elements.pickStatus.dataset.state = state;
    elements.pickStatus.classList.toggle('hidden', !visible);
  }

  function resetPickStatus() {
    setPickStatus(LOCKED_IN_COPY, false, 'locked');
  }

  // Round Timer Management
  function startRoundTimer(endsAt) {
    if (!elements.roundTimer) return;

    roundEndTime = endsAt;
    elements.roundTimer.classList.remove('hidden', 'critical');

    if (timerInterval) {
      clearInterval(timerInterval);
    }

    const initialRemaining = Math.max(0, Math.ceil((roundEndTime - Date.now()) / 1000));
    elements.roundTimer.textContent = `${initialRemaining}s`;
    elements.roundTimer.setAttribute('aria-label', `Time remaining: ${initialRemaining} seconds`);

    timerInterval = setInterval(() => {
      if (!roundEndTime) {
        clearInterval(timerInterval);
        return;
      }

      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((roundEndTime - now) / 1000));

      if (elements.roundTimer) {
        elements.roundTimer.textContent = `${remaining}s`;
        elements.roundTimer.setAttribute('aria-label', `Time remaining: ${remaining} seconds`);

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
      elements.roundTimer.classList.remove('critical');
      elements.roundTimer.textContent = '--';
      elements.roundTimer.setAttribute('aria-label', 'Time remaining: -- seconds');
    }
    roundEndTime = null;
  }

  // Lives Display Management
  function updateLivesDisplay(lives) {
    if (!elements.livesDisplay) return;

    myLives = lives;
    const hearts = elements.livesDisplay.querySelectorAll('.heart');

    hearts.forEach((heart, index) => {
      if (index < lives) {
        heart.classList.remove('lost');
      } else {
        heart.classList.add('lost');
      }
    });

    const livesCopy = `${lives} ${lives === 1 ? 'life' : 'lives'} remaining`;
    elements.livesDisplay.setAttribute('aria-label', livesCopy);
    if (elements.livesText) {
      elements.livesText.textContent = livesCopy;
    }

    // Show lives display when game starts
    if (lives > 0 && currentPhase !== 'lobby') {
      elements.livesDisplay.classList.remove('hidden');
    }
  }

  function showLifeLostNotification(reason) {
    // Shake the lives display
    if (elements.livesDisplay) {
      elements.livesDisplay.classList.add('losing-life');
      setTimeout(() => {
        elements.livesDisplay.classList.remove('losing-life');
      }, 500);
    }

    // Create and show life lost notification
    const notification = document.createElement('div');
    notification.className = 'life-lost-notification';

    const reasonText = {
      full: 'OPTION FULL',
      timeout: 'TOO SLOW',
      wrong: 'WRONG ANSWER'
    }[reason] || 'LIFE LOST';

    notification.textContent = `${reasonText} - LIFE LOST!`;
    document.body.appendChild(notification);

    // Remove notification after animation
    setTimeout(() => {
      notification.remove();
    }, 1000);

    // Show toast
    if (window.appCommon && window.appCommon.showToast) {
      window.appCommon.showToast(`You lost a life! ${myLives} remaining`, 'error', 2000);
    }
  }

  function showPhase(phaseName) {
    document.documentElement.setAttribute('data-phase', phaseName);
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
      button.disabled = hasPicked || isEliminated || currentPhase !== 'round';
      button.setAttribute('data-option-index', index);
      button.setAttribute('aria-label', `Option ${String.fromCharCode(65 + index)}: ${optionText}. ${slotsLeft} slot${slotsLeft !== 1 ? 's' : ''} remaining`);

      // Add urgent styling for last slot
      if (slotsLeft === 1 && !hasPicked && currentPhase === 'round') {
        button.classList.add('urgent');
        button.setAttribute('aria-label', `Option ${String.fromCharCode(65 + index)}: ${optionText}. Last slot available, pick now.`);
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
    const pickedButton = elements.optionsContainer.querySelector(`.option-button[data-option-index="${optionIndex}"]`);
    if (pickedButton) {
      pickedButton.classList.add('picked');
      pickedButton.style.borderColor = 'var(--success)';
      pickedButton.style.boxShadow = '0 0 0 2px var(--success), 0 0 16px var(--success-glow)';
    }

    renderOptions();

    setPickStatus(LOCKED_IN_COPY, true, 'locked');

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
    setCurrentPhase('eliminated');
    myLives = 0;
    stopRoundTimer();
    resetPickStatus();

    if (elements.livesDisplay) {
      elements.livesDisplay.classList.add('hidden');
    }

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
        setCurrentPhase('lobby');
        isEliminated = false;
        hasPicked = false;
        currentRoundNumber = 0;
        currentQuestion = null;
        myLives = 3;
        updateLivesDisplay(3);

        // Hide lives display in lobby
        if (elements.livesDisplay) {
          elements.livesDisplay.classList.add('hidden');
        }
      }
      stopRoundTimer();
      resetPickStatus();
      if (currentPhase !== 'lobby') {
        setCurrentPhase('lobby');
      }
      showPhase('lobby');
    }
  });

  socket.on('game:state', (data) => {
    if (!data) return;

    const phase = data.phase;

    if (phase === 'lobby') {
      setCurrentPhase('lobby');
      isEliminated = false;
      hasPicked = false;
      currentRoundNumber = 0;
      currentQuestion = null;
      resetPickStatus();
      showPhase('lobby');
    } else if (phase === 'countdown') {
      setCurrentPhase('countdown');
      stopRoundTimer();
      resetPickStatus();
      if (data.countdown && elements.countdownValue) {
        elements.countdownValue.textContent = data.countdown.secondsLeft || 3;
      }
      showPhase('countdown');
    } else if (phase === 'round') {
      if (isEliminated) {
        return;
      }

      setCurrentPhase('round');
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
        resetPickStatus();

        // Start timer if endsAt is provided
        if (data.round.endsAt) {
          startRoundTimer(data.round.endsAt);
        }

        renderOptions();
        showPhase('round');
      }
    } else if (phase === 'reveal') {
      stopRoundTimer();
      if (!isEliminated) {
        setCurrentPhase('reveal');
        setPickStatus(REVEAL_WAIT_COPY, true, 'reveal');
        renderOptions();
        showPhase('round');
      }
    } else if (phase === 'finished') {
      stopRoundTimer();
      setCurrentPhase('results');
      resetPickStatus();
      if (data.results) {
        renderResults(data.results);
      }
      showPhase('results');
    }
  });

  socket.on('round:new', (data) => {
    if (!data || isEliminated) return;

    setCurrentPhase('round');
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
    resetPickStatus();

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

    if (data.status === 'error') {
      if (window.appCommon && window.appCommon.showToast) {
        window.appCommon.showToast(data.reason, 'error');
      } else {
        alert(data.reason);
      }
      // Redirect back to join page after a short delay
      setTimeout(() => {
        window.location.assign('/');
      }, 3000);
    } else if (data.status === 'life_lost' && data.playerId === myPlayerId) {
      // Handle life lost from pick result
      if (typeof data.livesRemaining === 'number') {
        updateLivesDisplay(data.livesRemaining);
        showLifeLostNotification(data.reason);
      }
    } else if (data.eliminated && data.playerId === myPlayerId) {
      handleElimination(data.reason);
    } else if (data.status === 'accepted' && data.playerId === myPlayerId) {
      updateSlots(data.slotsLeft);
    }
  });

  socket.on('game:results', (data) => {
    if (!data) return;

    stopRoundTimer();
    setCurrentPhase('results');
    resetPickStatus();
    renderResults(data);
    showPhase('results');

    // Hide lives display
    if (elements.livesDisplay) {
      elements.livesDisplay.classList.add('hidden');
    }
  });

  // Handle countdown starting
  socket.on('game:countdownStarted', (data) => {
    if (!data || isEliminated) return;

    setCurrentPhase('countdown');
    stopRoundTimer();
    resetPickStatus();

    // Initialize lives display for new game
    myLives = 3;
    updateLivesDisplay(3);

    if (elements.countdownValue) {
      elements.countdownValue.textContent = data.secondsLeft || 3;
    }
    showPhase('countdown');
  });

  // Handle countdown ticks
  socket.on('game:countdownTick', (data) => {
    if (!data || isEliminated) return;

    if (elements.countdownValue) {
      elements.countdownValue.textContent = data.secondsLeft || 0;
    }
  });

  // Handle round start
  socket.on('game:roundStarted', (data) => {
    if (!data || isEliminated) return;

    setCurrentPhase('round');
    currentRoundNumber = data.roundNumber || 0;
    currentQuestion = data.question;
    currentSlotsLeft = data.slotsLeft || [0, 0, 0, 0];
    hasPicked = false;

    // Show lives display
    updateLivesDisplay(myLives);

    if (elements.roundNumber) {
      elements.roundNumber.textContent = `Round ${currentRoundNumber}`;
    }
    if (elements.questionText && currentQuestion) {
      elements.questionText.textContent = currentQuestion.text || '';
    }
    resetPickStatus();

    // Start timer
    if (data.endsAt) {
      startRoundTimer(data.endsAt);
    }

    renderOptions();
    showPhase('round');
  });

  // Handle slot updates
  socket.on('game:roundSlots', (data) => {
    if (!data || isEliminated) return;

    updateSlots(data.slotsLeft);
  });

  // Handle life lost event
  socket.on('game:playerLifeLost', (data) => {
    if (!data || data.playerId !== myPlayerId) return;

    // Update lives and show notification
    if (typeof data.livesRemaining === 'number') {
      updateLivesDisplay(data.livesRemaining);
      showLifeLostNotification(data.reason);
    }
  });

  // Handle player elimination
  socket.on('game:playerEliminated', (data) => {
    if (!data || data.playerId !== myPlayerId) return;

    handleElimination(data.reason);
  });

  // Handle round reveal
  socket.on('game:roundReveal', (data) => {
    if (!data || isEliminated) return;

    stopRoundTimer();
    setCurrentPhase('reveal');
    setPickStatus(REVEAL_WAIT_COPY, true, 'reveal');
    renderOptions();
    showPhase('round');
  });

  // Handle game finished
  socket.on('game:finished', (data) => {
    if (!data) return;

    stopRoundTimer();
    setCurrentPhase('results');
    resetPickStatus();
    renderResults(data);
    showPhase('results');

    // Hide lives display
    if (elements.livesDisplay) {
      elements.livesDisplay.classList.add('hidden');
    }
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
  setCurrentPhase('lobby');
  showPhase('lobby');
  resetPickStatus();
})();
