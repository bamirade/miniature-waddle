/**
 * AI Bot Simulation for Testing
 * Simulates bot players that join, ready up, and pick options during rounds.
 */

(function initAISimulation() {
  'use strict';

  class BotPlayer {
    constructor(botId, socketFactory) {
      this.botId = botId;
      this.name = `Bot${botId}`;
      this.socket = typeof socketFactory === 'function' ? socketFactory(botId) : null;

      this.isConnected = false;
      this.hasRequestedJoin = false;
      this.isJoined = false;
      this.isReady = false;
      this.isEliminated = false;
      this.currentPhase = 'lobby';
      this.hasPicked = false;
      this.currentRound = null;
      this.difficulty = 'medium';

      this._readyTimerId = null;
      this._pickTimerId = null;

      if (this.socket) {
        this.setupSocketHandlers();
      }
    }

    setupSocketHandlers() {
      this.socket.on('connect', () => {
        this.isConnected = true;
        if (this.hasRequestedJoin && !this.isJoined) {
          this.emitJoin();
        }
      });

      this.socket.on('disconnect', () => {
        this.isConnected = false;
        this.isJoined = false;
        this.isReady = false;
      });

      this.socket.on('lobby:update', (data) => {
        if (!data) {
          return;
        }

        this.currentPhase = data.phase || 'lobby';

        const me = this.findSelfInLobby(data);
        const wasJoined = this.isJoined;

        this.isJoined = Boolean(me);
        this.isReady = Boolean(me && me.ready);
        this.isEliminated = Boolean(me && me.status === 'eliminated');

        if (this.isJoined && !wasJoined) {
          this.scheduleReady();
        }
      });

      this.socket.on('game:state', (data) => {
        if (!data) {
          return;
        }

        this.currentPhase = data.phase || this.currentPhase;

        if (this.currentPhase === 'lobby') {
          this.hasPicked = false;
          this.currentRound = null;
        }

        if (this.currentPhase === 'round' && data.round) {
          this.currentRound = data.round;
          if (!this.hasPicked && !this.isEliminated) {
            this.schedulePick();
          }
        }
      });

      this.socket.on('round:new', (data) => {
        if (!data) {
          return;
        }

        this.currentPhase = 'round';
        this.currentRound = data;
        this.hasPicked = false;

        if (!this.isEliminated) {
          this.schedulePick();
        }
      });

      this.socket.on('round:update', (data) => {
        if (!data) {
          return;
        }

        if (data.type === 'slots' && this.currentRound) {
          this.currentRound = {
            ...this.currentRound,
            capacities: data.capacities || this.currentRound.capacities,
            slotsLeft: data.slotsLeft || this.currentRound.slotsLeft,
            pickedCounts: data.pickedCounts || this.currentRound.pickedCounts
          };
        }

        if (data.type === 'elimination' && data.playerId === this.socket.id) {
          this.isEliminated = true;
        }

        if (data.type === 'reveal') {
          this.currentPhase = 'reveal';
        }
      });

      this.socket.on('player:result', (data) => {
        if (!data) {
          return;
        }

        if (data.status === 'accepted') {
          this.hasPicked = true;
        }

        if (data.status === 'eliminated' || data.eliminated === true) {
          this.hasPicked = true;
          this.isEliminated = true;
        }

        // Allow retries in the same round for ignored picks.
        if (data.status === 'ignored' && data.reason === 'invalid_option') {
          this.hasPicked = false;
          if (this.currentPhase === 'round') {
            this.schedulePick();
          }
        }
      });

      this.socket.on('game:results', () => {
        this.currentPhase = 'finished';
      });
    }

    findSelfInLobby(data) {
      if (!data || !Array.isArray(data.players) || !this.socket || !this.socket.id) {
        return null;
      }

      return data.players.find((player) => player.id === this.socket.id) || null;
    }

    join() {
      if (!this.socket || this.hasRequestedJoin) {
        return;
      }

      this.hasRequestedJoin = true;

      if (this.socket.connected) {
        this.emitJoin();
      }
    }

    emitJoin() {
      if (!this.socket || this.currentPhase !== 'lobby') {
        return;
      }

      this.socket.emit('player:join', { name: this.name });
    }

    scheduleReady() {
      if (this._readyTimerId) {
        clearTimeout(this._readyTimerId);
      }

      this._readyTimerId = setTimeout(() => {
        this.setReady();
      }, 400 + Math.random() * 1100);
    }

    setReady() {
      if (!this.socket || !this.isJoined || this.isReady || this.currentPhase !== 'lobby') {
        return;
      }

      this.socket.emit('player:ready');
    }

    schedulePick() {
      if (this._pickTimerId) {
        clearTimeout(this._pickTimerId);
      }

      this._pickTimerId = setTimeout(() => {
        this.makePick();
      }, this.getThinkingTime());
    }

    makePick() {
      if (!this.socket || this.hasPicked || this.isEliminated || this.currentPhase !== 'round') {
        return;
      }

      const optionIndex = this.chooseOption(this.currentRound);
      if (optionIndex === null) {
        return;
      }

      this.socket.emit('player:pick', { option: optionIndex });
      this.hasPicked = true;
    }

    chooseOption(roundData) {
      if (!roundData || !Array.isArray(roundData.slotsLeft)) {
        return null;
      }

      const available = roundData.slotsLeft
        .map((slots, index) => ({ index, slots }))
        .filter((entry) => entry.slots > 0);

      if (available.length === 0) {
        return null;
      }

      if (this.difficulty === 'easy') {
        const maxSlots = Math.max(...available.map((entry) => entry.slots));
        const safest = available.filter((entry) => entry.slots === maxSlots);
        return safest[Math.floor(Math.random() * safest.length)].index;
      }

      if (this.difficulty === 'hard') {
        const minSlots = Math.min(...available.map((entry) => entry.slots));
        const risky = available.filter((entry) => entry.slots === minSlots);
        return risky[Math.floor(Math.random() * risky.length)].index;
      }

      return available[Math.floor(Math.random() * available.length)].index;
    }

    getThinkingTime() {
      const rangesByDifficulty = {
        easy: [350, 1200],
        medium: [700, 1800],
        hard: [1200, 2600]
      };

      const range = rangesByDifficulty[this.difficulty] || rangesByDifficulty.medium;
      return range[0] + Math.floor(Math.random() * (range[1] - range[0] + 1));
    }

    setDifficulty(difficulty) {
      this.difficulty = difficulty;
    }

    disconnect() {
      if (this._readyTimerId) {
        clearTimeout(this._readyTimerId);
      }
      if (this._pickTimerId) {
        clearTimeout(this._pickTimerId);
      }

      this._readyTimerId = null;
      this._pickTimerId = null;

      if (this.socket) {
        this.socket.disconnect();
      }
    }
  }

  class AISimulation {
    constructor() {
      this.bots = [];
      this.isEnabled = false;
      this.botCount = 5;
      this.difficulty = 'medium';
      this.socketFactory = null;
      this._joinTimerIds = [];
    }

    init(socketFactory) {
      this.socketFactory = socketFactory;
    }

    enable(config = {}) {
      if (this.isEnabled || typeof this.socketFactory !== 'function') {
        return false;
      }

      this.botCount = Math.max(1, Math.min(20, Number(config.count) || this.botCount));
      this.difficulty = config.difficulty || this.difficulty;
      this.isEnabled = true;

      for (let index = 0; index < this.botCount; index += 1) {
        const bot = new BotPlayer(index + 1, this.socketFactory);
        bot.setDifficulty(this.difficulty);
        this.bots.push(bot);

        const timerId = setTimeout(() => {
          if (this.isEnabled) {
            bot.join();
          }
        }, index * 180);

        this._joinTimerIds.push(timerId);
      }

      return true;
    }

    disable() {
      if (!this.isEnabled) {
        return;
      }

      this._joinTimerIds.forEach((timerId) => clearTimeout(timerId));
      this._joinTimerIds = [];

      this.bots.forEach((bot) => bot.disconnect());
      this.bots = [];
      this.isEnabled = false;
    }

    setDifficulty(difficulty) {
      this.difficulty = difficulty;
      this.bots.forEach((bot) => bot.setDifficulty(difficulty));
    }

    setBotCount(count) {
      this.botCount = Math.max(1, Math.min(20, Number(count) || this.botCount));
    }

    getStatus() {
      const connectedCount = this.bots.filter((bot) => bot.isConnected).length;
      const joinedCount = this.bots.filter((bot) => bot.isJoined).length;
      const readyCount = this.bots.filter((bot) => bot.isReady).length;
      const aliveCount = this.bots.filter((bot) => bot.isJoined && !bot.isEliminated).length;

      return {
        enabled: this.isEnabled,
        botCount: this.bots.length,
        targetBotCount: this.botCount,
        difficulty: this.difficulty,
        connectedCount,
        joinedCount,
        readyCount,
        aliveCount
      };
    }
  }

  window.AISimulation = AISimulation;
})();
