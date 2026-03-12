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
  let currentRevealData = null;
  let hostConfig = null;
  let healthPollTimer = null;
  let flashTimerInterval = null;
  let flashEndTime = null;
  let roundTimerInterval = null;
  let roundEndTime = null;

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
    copyJoinButton: document.getElementById('copy-join-button'),
    joinCopyStatus: document.getElementById('join-copy-status'),
    joinMetaMode: document.getElementById('join-meta-mode'),
    joinMetaServer: document.getElementById('join-meta-server'),
    joinMetaStatus: document.getElementById('join-meta-status'),
    hostPhaseTitle: document.getElementById('host-phase-title'),
    hostPhaseHint: document.getElementById('host-phase-hint'),
    statTotal: document.getElementById('stat-total'),
    statReady: document.getElementById('stat-ready'),
    statAlive: document.getElementById('stat-alive'),
    readinessMeterFill: document.getElementById('readiness-meter-fill'),
    readinessSummary: document.getElementById('readiness-summary'),
    playerList: document.getElementById('player-list'),
    startButton: document.getElementById('start-button'),
    startButtonHelp: document.getElementById('start-button-help'),
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

  function setJoinCopyStatus(message, type) {
    if (!elements.joinCopyStatus) {
      return;
    }

    elements.joinCopyStatus.textContent = message || '';
    elements.joinCopyStatus.dataset.state = type || '';
  }

  function renderJoinQr(joinUrl) {
    if (!elements.qrCode) {
      return;
    }

    const image = document.createElement('img');
    image.src = `/qr.svg?text=${encodeURIComponent(joinUrl)}`;
    image.alt = 'QR code for student join';
    image.loading = 'eager';

    elements.qrCode.innerHTML = '';
    elements.qrCode.appendChild(image);
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      return '--';
    }

    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    }

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }

    return `${seconds}s`;
  }

  function updateJoinMetaFromConfig(config) {
    hostConfig = config || hostConfig;

    if (!hostConfig) {
      return;
    }

    if (elements.joinMetaMode) {
      const labelSetCopy = hostConfig.labelSet === 'yes_no' ? 'Yes/No' : 'True/False';
      elements.joinMetaMode.textContent = `${labelSetCopy} | v${hostConfig.version || '?'}`;
    }

    if (elements.joinMetaServer) {
      elements.joinMetaServer.textContent = `${hostConfig.hostIp || 'localhost'}:${hostConfig.port || 3000}`;
    }
  }

  function updateJoinMetaFromHealth(snapshot) {
    if (!snapshot || !elements.joinMetaStatus) {
      return;
    }

    const phaseLabel = String(snapshot.phase || currentPhase || 'lobby').toUpperCase();
    elements.joinMetaStatus.textContent = `${phaseLabel} | up ${formatDuration(snapshot.uptimeMs)}`;
  }

  function pollHealth() {
    fetch('/health')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Server returned status ${res.status}`);
        }
        return res.json();
      })
      .then((snapshot) => {
        updateJoinMetaFromHealth(snapshot);
      })
      .catch(() => {
        if (elements.joinMetaStatus) {
          elements.joinMetaStatus.textContent = 'Heartbeat unavailable';
        }
      });
  }

  function ensureHealthPolling() {
    pollHealth();

    if (healthPollTimer) {
      clearInterval(healthPollTimer);
    }

    healthPollTimer = window.setInterval(pollHealth, 15000);
  }

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
        hostConfig = config;
        const joinUrl = config.joinUrl || `http://${config.ip || 'localhost'}:${config.port || 3000}/`;
        if (elements.joinUrl) {
          elements.joinUrl.textContent = joinUrl;
        }

        updateJoinMetaFromConfig(config);
        renderJoinQr(joinUrl);
        if (elements.copyJoinButton) {
          elements.copyJoinButton.disabled = false;
        }

        ensureHealthPolling();
      })
      .catch((err) => {
        console.error('Failed to load config:', err);
        if (elements.joinUrl) {
          elements.joinUrl.textContent = 'Error: Cannot load join URL';
        }
        if (elements.joinMetaStatus) {
          elements.joinMetaStatus.textContent = 'Config unavailable';
        }
      });
  }

  function updatePhaseBanner() {
    if (!elements.hostPhaseTitle || !elements.hostPhaseHint) {
      return;
    }

    let title = 'Lobby';
    let hint = 'Share the join code so students can connect.';

    if (currentPhase === 'lobby') {
      const totalPlayers = lobbyData && typeof lobbyData.totalPlayers === 'number' ? lobbyData.totalPlayers : 0;
      const readyCount = lobbyData && typeof lobbyData.readyCount === 'number' ? lobbyData.readyCount : 0;

      if (totalPlayers > 0) {
        if (readyCount === 0) {
          hint = `${totalPlayers} joined — no one ready yet. Ask students to tap Ready.`;
        } else if (readyCount === totalPlayers) {
          hint = `All ${totalPlayers} ready. Launch when the class is settled.`;
        } else {
          hint = `${readyCount} of ${totalPlayers} ready. Waiting for more.`;
        }
      }
    } else if (currentPhase === 'countdown') {
      title = 'Round starts in';
      hint = 'Project the countdown so everyone can prepare to answer.';
    } else if (currentPhase === 'round') {
      const roundNumber = currentRound && currentRound.roundNumber ? currentRound.roundNumber : 1;
      title = `Round ${roundNumber} live`;
      hint = 'Students are choosing now. Options disappear when slots are full.';
    } else if (currentPhase === 'reveal') {
      title = 'Round result';
      hint = 'Correct answer highlighted. Pick counts and incident summary shown below.';
    } else if (currentPhase === 'finished') {
      title = 'Final standings';
      hint = 'Review the podium or start a new game.';
    }

    const titleChanged = elements.hostPhaseTitle.textContent !== title;
    const hintChanged = elements.hostPhaseHint.textContent !== hint;

    elements.hostPhaseTitle.textContent = title;
    elements.hostPhaseHint.textContent = hint;

    if (titleChanged || hintChanged) {
      replayMotionClass(document.getElementById('host-phase-banner'), 'phase-banner-shift');
    }
  }

  function updateStats(data) {
    if (!data) return;

    const totalPlayers = data.totalPlayers || 0;
    const readyCount = data.readyCount || 0;
    const aliveCount = data.aliveCount || 0;

    updateStatValue(elements.statTotal, totalPlayers, `${totalPlayers} total players`);
    updateStatValue(elements.statReady, readyCount, `${readyCount} players ready`);
    updateStatValue(elements.statAlive, aliveCount, `${aliveCount} players alive`);
    updateReadinessSummary(totalPlayers, readyCount, aliveCount, data.phase || currentPhase);
  }

  function updateReadinessSummary(totalPlayers, readyCount, aliveCount, phase) {
    if (elements.readinessMeterFill) {
      const percent = totalPlayers > 0 ? Math.round((readyCount / totalPlayers) * 100) : 0;
      elements.readinessMeterFill.style.width = `${percent}%`;
    }

    if (!elements.readinessSummary) {
      return;
    }

    if (phase === 'finished') {
      elements.readinessSummary.textContent = `${aliveCount} player(s) survived. New game launch is available now.`;
      return;
    }

    if (phase !== 'lobby') {
      elements.readinessSummary.textContent = `${aliveCount} player(s) still alive. Ready check is locked during active rounds.`;
      return;
    }

    if (totalPlayers === 0) {
      elements.readinessSummary.textContent = 'Waiting for students to join the room.';
      return;
    }

    if (readyCount === 0) {
      elements.readinessSummary.textContent = 'At least one student must tap Ready before launch.';
      return;
    }

    if (readyCount === totalPlayers) {
      elements.readinessSummary.textContent = `Full check-in complete: ${readyCount}/${totalPlayers} ready.`;
      return;
    }

    elements.readinessSummary.textContent = `${readyCount}/${totalPlayers} ready. Launch is unlocked, but more check-ins can still arrive.`;
  }

  function renderPlayerList(players) {
    if (!elements.playerList || !players) return;

    elements.playerList.setAttribute('aria-label', `${players.length} players in game`);

    if (players.length === 0) {
      elements.playerList.innerHTML = '<p class="muted">No players yet</p>';
      return;
    }

    elements.playerList.innerHTML = '';

    players.forEach((player) => {
      const entry = document.createElement('div');
      entry.className = 'player-entry';
      entry.setAttribute('role', 'listitem');

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

    let helperText = 'Enabled when at least one player is connected and ready.';

    if (phase === 'finished') {
      elements.startButton.textContent = 'New Game';
      elements.startButton.disabled = false;
      helperText = 'Final standings locked. Launch a new game when ready.';
    } else if (phase === 'lobby') {
      elements.startButton.textContent = 'Start Game';
      elements.startButton.disabled = !canStart;
      helperText = canStart
        ? 'Class is ready. Launch when you want the countdown to begin.'
        : 'Waiting for at least one ready player before launch.';
    } else {
      elements.startButton.textContent = 'Start Game';
      elements.startButton.disabled = true;
      helperText = 'Game is in progress. Launch control unlocks after final standings.';
    }

    if (elements.startButtonHelp) {
      elements.startButtonHelp.textContent = helperText;
    }
  }

  function getOptionCount(question) {
    const optionLength = question && Array.isArray(question.options) ? question.options.length : 0;
    return optionLength > 0 ? optionLength : 2;
  }

  function createOptionNumberFallback(question) {
    return new Array(getOptionCount(question)).fill(0);
  }

  function createPickedByOptionFallback(question) {
    return Array.from({ length: getOptionCount(question) }, () => []);
  }

  function normalizeOptionNumberArray(values, question) {
    const fallback = createOptionNumberFallback(question);
    if (!Array.isArray(values)) {
      return fallback;
    }

    return fallback.map((_, index) => {
      const value = values[index];
      return typeof value === 'number' ? value : 0;
    });
  }

  function normalizePickedByOption(values, question) {
    const fallback = createPickedByOptionFallback(question);
    if (!Array.isArray(values)) {
      return fallback;
    }

    return fallback.map((_, index) => {
      const value = values[index];
      return Array.isArray(value) ? value : [];
    });
  }

  function deriveOptionKeys(options) {
    const normalizedOptions = Array.isArray(options) ? options : [];
    const usedKeys = new Set();

    return normalizedOptions.map((optionText, index) => {
      const letters = String(optionText || '').toUpperCase().match(/[A-Z]/g) || [];
      for (const letter of letters) {
        if (!usedKeys.has(letter)) {
          usedKeys.add(letter);
          return letter;
        }
      }

      const fallback = `${index + 1}`;
      usedKeys.add(fallback);
      return fallback;
    });
  }

  function getOptionKey(optionText, index, options) {
    const keys = deriveOptionKeys(Array.isArray(options) ? options : [optionText]);
    return keys[index] || `${index + 1}`;
  }

  function replayMotionClass(element, className) {
    if (!element || !className) {
      return;
    }

    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  function updateStatValue(element, value, ariaLabel) {
    if (!element) {
      return;
    }

    const nextValue = String(value || 0);
    const hasChanged = element.textContent !== nextValue;

    element.textContent = nextValue;
    if (ariaLabel) {
      element.setAttribute('aria-label', ariaLabel);
    }

    if (hasChanged) {
      replayMotionClass(element, 'updated');
      replayMotionClass(element.parentElement, 'updated');
    }
  }

  function showCard(cardName) {
    const cards = {
      countdown: elements.countdownCard,
      round: elements.roundCard,
      results: elements.resultsCard
    };

    let activeCard = null;

    Object.keys(cards).forEach((key) => {
      const card = cards[key];
      if (card) {
        const isActive = key === cardName;
        card.classList.toggle('hidden', !isActive);

        if (isActive) {
          activeCard = card;
        }
      }
    });

    if (cardName === null) {
      Object.values(cards).forEach((card) => {
        if (card) card.classList.add('hidden');
      });
      return;
    }

    if (activeCard) {
      replayMotionClass(activeCard, 'card-enter');
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
    replayMotionClass(elements.flashOverlay, 'overlay-enter');
  }

  function hideFlashOverlay() {
    if (elements.flashOverlay) {
      elements.flashOverlay.classList.add('hidden');
    }
    stopFlashTimer();
  }

  function renderFlashOptions(question, slotsLeft) {
    if (!elements.flashOptions || !question) return;

    const normalizedSlotsLeft = normalizeOptionNumberArray(slotsLeft, question);
    elements.flashOptions.innerHTML = '';

    question.options.forEach((optionText, index) => {
      const slots = normalizedSlotsLeft[index] || 0;

      const option = document.createElement('div');
      option.className = 'flash-option';
      option.setAttribute('data-option-index', index);

      if (slots === 0) {
        option.classList.add('full');
      }

      const label = document.createElement('div');
      label.className = 'flash-option-label';
      label.textContent = getOptionKey(optionText, index, question.options);

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

  function updateRoundTimerUI(remaining) {
    if (!elements.roundTimer) return;

    elements.roundTimer.textContent = `${remaining}s`;
    elements.roundTimer.setAttribute('aria-label', `Time remaining: ${remaining} seconds`);
    elements.roundTimer.classList.toggle('critical', remaining <= 3);
  }

  function startRoundTimer(endsAt) {
    if (!elements.roundTimer || !endsAt) return;

    roundEndTime = endsAt;
    elements.roundTimer.classList.remove('critical');

    if (roundTimerInterval) {
      clearInterval(roundTimerInterval);
    }

    const initialRemaining = Math.max(0, Math.ceil((roundEndTime - Date.now()) / 1000));
    updateRoundTimerUI(initialRemaining);

    roundTimerInterval = setInterval(() => {
      if (!roundEndTime) {
        clearInterval(roundTimerInterval);
        return;
      }

      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((roundEndTime - now) / 1000));
      updateRoundTimerUI(remaining);

      if (remaining === 0) {
        clearInterval(roundTimerInterval);
        roundTimerInterval = null;
      }
    }, 100);
  }

  function stopRoundTimer() {
    if (roundTimerInterval) {
      clearInterval(roundTimerInterval);
      roundTimerInterval = null;
    }

    roundEndTime = null;
    if (elements.roundTimer) {
      elements.roundTimer.classList.remove('critical');
      elements.roundTimer.textContent = '--';
      elements.roundTimer.setAttribute('aria-label', 'Time remaining: -- seconds');
    }
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

    const normalizedCapacities = normalizeOptionNumberArray(capacities, question);
    const normalizedPickedCounts = normalizeOptionNumberArray(pickedCounts, question);
    const normalizedSlotsLeft = normalizeOptionNumberArray(slotsLeft, question);

    elements.optionsDisplay.innerHTML = '';

    question.options.forEach((optionText, index) => {
      const capacity = normalizedCapacities[index] || 0;
      const picked = normalizedPickedCounts[index] || 0;
      const slots = normalizedSlotsLeft[index] || 0;
      const percentage = capacity > 0 ? Math.round((picked / capacity) * 100) : 0;

      // Hide options that are full (0 slots left)
      if (slots === 0) {
        return;
      }

      const bar = document.createElement('div');
      bar.className = 'option-bar';
      bar.setAttribute('role', 'listitem');

      const header = document.createElement('div');
      header.className = 'option-header';

      const label = document.createElement('div');
      label.className = 'option-label';
      label.textContent = getOptionKey(optionText, index, question.options);

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

  // Render round reveal recap: correct answer, all options with pick counts, incident chips
  function renderRevealRecap(data) {
    if (!elements.optionsDisplay || !data || !data.question) return;

    currentRevealData = data;
    elements.optionsDisplay.innerHTML = '';
    elements.optionsDisplay.setAttribute('aria-label', 'Round reveal');

    const correctIndex = data.question.answerIndex;
    const options = data.question.options || [];
    const pickedByOption = normalizePickedByOption(data.pickedByOption, data.question);
    const lostLivesThisRound = data.lostLivesThisRound || [];
    const eliminatedThisRound = data.eliminatedThisRound || [];

    // Correct answer banner
    const correctBanner = document.createElement('div');
    correctBanner.className = 'reveal-correct-banner';
    correctBanner.setAttribute('role', 'status');
    correctBanner.setAttribute('aria-label', `Correct answer: ${options[correctIndex] || ''}`);

    const correctLabel = document.createElement('span');
    correctLabel.className = 'reveal-correct-label';
    correctLabel.textContent = 'Correct';

    const correctLetter = document.createElement('span');
    correctLetter.className = 'reveal-correct-letter';
    correctLetter.textContent = getOptionKey(options[correctIndex], correctIndex, options);

    const correctText = document.createElement('span');
    correctText.className = 'reveal-correct-text';
    correctText.textContent = options[correctIndex] || '';

    correctBanner.appendChild(correctLabel);
    correctBanner.appendChild(correctLetter);
    correctBanner.appendChild(correctText);
    elements.optionsDisplay.appendChild(correctBanner);

    // All option bars with pick counts (shown even when slots were full)
    options.forEach((optionText, index) => {
      const pickedArr = pickedByOption[index];
      const pickedCount = Array.isArray(pickedArr) ? pickedArr.length : (pickedArr || 0);
      const isCorrect = index === correctIndex;

      const bar = document.createElement('div');
      bar.className = 'option-bar reveal-option-bar';
      if (isCorrect) bar.classList.add('correct');
      bar.setAttribute('role', 'listitem');
      bar.setAttribute('aria-label', `${optionText}. ${pickedCount} picked.`);

      const header = document.createElement('div');
      header.className = 'option-header';

      const label = document.createElement('div');
      label.className = 'option-label';
      label.textContent = getOptionKey(optionText, index, options);

      const text = document.createElement('div');
      text.className = 'option-text';
      text.textContent = optionText;

      const countBadge = document.createElement('div');
      countBadge.className = 'reveal-pick-count';
      countBadge.textContent = `${pickedCount} picked`;

      header.appendChild(label);
      header.appendChild(text);
      header.appendChild(countBadge);
      bar.appendChild(header);
      elements.optionsDisplay.appendChild(bar);
    });

    // Incident chips: life lost + eliminated counts
    const chipRow = document.createElement('div');
    chipRow.className = 'reveal-incident-row';

    const lifeLostChip = document.createElement('div');
    lifeLostChip.className = 'reveal-chip';
    lifeLostChip.setAttribute('aria-label', `${lostLivesThisRound.length} life lost this round`);
    lifeLostChip.innerHTML = `<span class="reveal-chip-count">${lostLivesThisRound.length}</span><span class="reveal-chip-label">life lost</span>`;

    const eliminatedChip = document.createElement('div');
    eliminatedChip.className = 'reveal-chip reveal-chip-elim';
    eliminatedChip.setAttribute('aria-label', `${eliminatedThisRound.length} eliminated this round`);
    eliminatedChip.innerHTML = `<span class="reveal-chip-count">${eliminatedThisRound.length}</span><span class="reveal-chip-label">eliminated</span>`;

    chipRow.appendChild(lifeLostChip);
    chipRow.appendChild(eliminatedChip);
    elements.optionsDisplay.appendChild(chipRow);
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
    if (elements.joinMetaStatus) {
      elements.joinMetaStatus.textContent = 'Connected';
    }
  });

  socket.on('disconnect', () => {
    if (elements.joinMetaStatus) {
      elements.joinMetaStatus.textContent = 'Socket disconnected';
    }
  });

  socket.on('lobby:update', (data) => {
    if (!data) return;

    lobbyData = data;
    const newPhase = data.phase || 'lobby';
    onPhaseChange(newPhase);

    updateStats(data);
    renderPlayerList(data.players || []);
    updateStartButton(data.canStart, data.phase || 'lobby');
    updatePhaseBanner();
  });

  socket.on('game:state', (data) => {
    if (!data) return;

    const phase = data.phase;
    onPhaseChange(phase);

    if (phase === 'lobby') {
      currentPhase = 'lobby';
      currentRound = null;
      hideFlashOverlay();
      stopRoundTimer();
      showCard(null);
      if (data.lobby) {
        lobbyData = data.lobby;
        updateStats(data.lobby);
        renderPlayerList(data.lobby.players || []);
        updateStartButton(data.lobby.canStart, phase);
      }
    } else if (phase === 'countdown') {
      currentPhase = 'countdown';
      hideFlashOverlay();
      stopRoundTimer();
      updateStartButton(false, 'countdown');
      if (data.countdown && elements.countdownValue) {
        elements.countdownValue.textContent = data.countdown.secondsLeft || 3;
      }
      if (data.lobby) {
        lobbyData = data.lobby;
      }
      showCard('countdown');
    } else if (phase === 'round') {
      currentPhase = 'round';
      updateStartButton(false, 'round');
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
          normalizeOptionNumberArray(data.round.capacities, data.round.question),
          normalizeOptionNumberArray(data.round.pickedCounts, data.round.question),
          normalizeOptionNumberArray(data.round.slotsLeft, data.round.question)
        );

        // Show flash overlay
        showFlashOverlay(
          data.round.question,
          data.round.roundNumber || 1,
          data.round.endsAt,
          normalizeOptionNumberArray(data.round.slotsLeft, data.round.question)
        );
        if (data.round.endsAt) {
          startRoundTimer(data.round.endsAt);
        } else {
          stopRoundTimer();
        }

        showCard('round');
      }

      if (data.lobby) {
        lobbyData = data.lobby;
        updateStats(data.lobby);
        renderPlayerList(data.lobby.players || []);
      }
    } else if (phase === 'reveal') {
      updateStartButton(false, 'reveal');
      hideFlashOverlay();
      stopRoundTimer();
      if (data.round) {
        currentRound = data.round;
        // Merge with cached incident data if available (incident data only arrives via round:update reveal)
        renderRevealRecap({
          question: data.round.question,
          pickedByOption: normalizePickedByOption(data.round.pickedByOption, data.round.question),
          lostLivesThisRound: currentRevealData ? (currentRevealData.lostLivesThisRound || []) : [],
          eliminatedThisRound: currentRevealData ? (currentRevealData.eliminatedThisRound || []) : [],
        });
      }
      showCard('round');

      if (data.lobby) {
        lobbyData = data.lobby;
        renderPlayerList(data.lobby.players || []);
      }
    } else if (phase === 'finished') {
      currentPhase = 'finished';
      hideFlashOverlay();
      stopRoundTimer();
      if (data.results) {
        renderResults(data.results);
        showCard('results');
      }

      if (data.lobby) {
        lobbyData = data.lobby;
        updateStats(data.lobby);
        renderPlayerList(data.lobby.players || []);
        updateStartButton(false, 'finished');
      }
    }

    updatePhaseBanner();
  });

  socket.on('round:new', (data) => {
    if (!data) return;

    onPhaseChange('round');
    updateStartButton(false, 'round');
    currentRound = data;
    currentRevealData = null;

    if (elements.roundNumber) {
      elements.roundNumber.textContent = `Round ${data.roundNumber || 1}`;
    }
    if (elements.questionText && data.question) {
      elements.questionText.textContent = data.question.text || '';
    }

    renderOptions(
      data.question,
      normalizeOptionNumberArray(data.capacities, data.question),
      normalizeOptionNumberArray(data.pickedCounts, data.question),
      normalizeOptionNumberArray(data.slotsLeft, data.question)
    );

    // Show flash overlay
    showFlashOverlay(
      data.question,
      data.roundNumber || 1,
      data.endsAt,
      normalizeOptionNumberArray(data.slotsLeft, data.question)
    );

    if (data.endsAt) {
      startRoundTimer(data.endsAt);
    } else {
      stopRoundTimer();
    }

    showCard('round');
    updatePhaseBanner();
  });

  socket.on('round:update', (data) => {
    if (!data || !currentRound) return;

    if (data.type === 'slots' && currentPhase === 'round') {
      renderOptions(
        currentRound.question,
        normalizeOptionNumberArray(data.capacities, currentRound.question),
        normalizeOptionNumberArray(data.pickedCounts, currentRound.question),
        normalizeOptionNumberArray(data.slotsLeft, currentRound.question)
      );

      // Update flash overlay
      updateFlashOptions(normalizeOptionNumberArray(data.slotsLeft, currentRound.question));
    } else if (data.type === 'reveal') {
      onPhaseChange('reveal');
      hideFlashOverlay();
      stopRoundTimer();
      if (data.question) {
        if (currentRound) {
          currentRound.question = data.question;
        } else {
          currentRound = { question: data.question };
        }
      }
      renderRevealRecap(data);
      showCard('round');
      updatePhaseBanner();
    }
  });

  socket.on('game:results', (data) => {
    if (!data) return;

    onPhaseChange('finished');
    updateStartButton(false, 'finished');
    hideFlashOverlay();
    stopRoundTimer();
    renderResults(data);
    showCard('results');
    updatePhaseBanner();
  });

  socket.on('player:result', (data) => {
    if (!data || data.status !== 'error') {
      return;
    }

    if (window.appCommon && window.appCommon.showToast) {
      window.appCommon.showToast(data.reason, 'error', 3200);
    }

    if (elements.startButtonHelp) {
      elements.startButtonHelp.textContent = data.reason;
    }
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

  if (elements.copyJoinButton) {
    elements.copyJoinButton.disabled = true;
    elements.copyJoinButton.addEventListener('click', async () => {
      const joinUrl = elements.joinUrl ? elements.joinUrl.textContent.trim() : '';

      if (!joinUrl || joinUrl === 'Loading...' || joinUrl.startsWith('Error:')) {
        setJoinCopyStatus('Join link unavailable', 'error');
        return;
      }

      try {
        const didCopy = window.appCommon && typeof window.appCommon.copyText === 'function'
          ? await window.appCommon.copyText(joinUrl)
          : false;

        if (!didCopy) {
          throw new Error('Clipboard unavailable');
        }

        setJoinCopyStatus('Join link copied', 'success');
        if (window.appCommon && window.appCommon.showToast) {
          window.appCommon.showToast('Join link copied', 'success', 2200);
        }
      } catch (error) {
        setJoinCopyStatus('Copy failed on this device', 'error');
      }
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
    document.documentElement.setAttribute('data-phase', newPhase);
    updateAIControls();
    updatePhaseBanner();
  }

  initJoinInfo();
  document.documentElement.setAttribute('data-phase', currentPhase);
  updateStartButton(false, currentPhase);
  updateAIControls();
  updatePhaseBanner();
})();
