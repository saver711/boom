(function () {
  "use strict";

  const STORAGE_KEY = "boomboom-game";
  const BOMB_COUNT = 3;
  const TILE_COUNT = 9;
  const SHAPES = ["chip", "candy", "cookie", "donut"];
  const PRESET_EMOJIS = {
    chip: "🥔",
    candy: "🍬",
    cookie: "🍪",
    donut: "🍩",
  };

  const defaultState = () => ({
    settings: { coverPreset: "chip", customCover: "" },
    players: {},
    game: {
      phase: "names",
      setupPlayer: 1,
      p1Name: "Player 1",
      p2Name: "Player 2",
      p1Bombs: [],
      p2Bombs: [],
      p1Revealed: [],
      p2Revealed: [],
      p1BombsHit: 0,
      p2BombsHit: 0,
      currentTurn: 1,
      winner: null,
      loser: null,
    },
  });

  let state = defaultState();
  let animating = false;
  let audioCtx = null;

  const $ = (sel) => document.querySelector(sel);
  const app = $("#app");
  const boardP1 = $("#board-p1");
  const boardP2 = $("#board-p2");
  const turnText = $("#turn-text");
  const p1NameInput = $("#p1-name");
  const p2NameInput = $("#p2-name");
  const p1Stats = $("#p1-stats");
  const p2Stats = $("#p2-stats");
  const btnStart = $("#btn-start");
  const btnSettings = $("#btn-settings");
  const btnReset = $("#btn-reset");
  const btnPlayAgain = $("#btn-play-again");
  const btnCloseSettings = $("#btn-close-settings");
  const settingsModal = $("#settings-modal");
  const gameoverOverlay = $("#gameover-overlay");
  const gameoverMessage = $("#gameover-message");
  const landscapeWarning = $("#landscape-warning");
  const customCoverInput = $("#custom-cover-input");
  const customCoverPreview = $("#custom-cover-preview");

  function migrateSettings(settings) {
    const base = defaultState().settings;
    const s = { ...base, ...settings };
    if (s.coverShape) {
      if (s.coverShape === "star" || !SHAPES.includes(s.coverShape)) {
        s.coverPreset = "chip";
      } else {
        s.coverPreset = s.coverShape;
      }
      delete s.coverShape;
    }
    if (!SHAPES.includes(s.coverPreset) && s.coverPreset !== "custom") {
      s.coverPreset = "chip";
    }
    return s;
  }

  function extractFirstEmoji(str) {
    if (!str || !str.trim()) return "";
    const trimmed = str.trim();
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      const first = [...segmenter.segment(trimmed)][0];
      return first ? first.segment : "";
    }
    return [...trimmed][0] || "";
  }

  function getCoverEmoji() {
    const { coverPreset, customCover } = state.settings;
    if (coverPreset === "custom") {
      return extractFirstEmoji(customCover) || PRESET_EMOJIS.chip;
    }
    return PRESET_EMOJIS[coverPreset] || PRESET_EMOJIS.chip;
  }

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playEatSound() {
    try {
      const ctx = ensureAudio();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + 0.06);
      osc.frequency.exponentialRampToValueAtTime(660, t + 0.12);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.start(t);
      osc.stop(t + 0.2);
    } catch {
      /* audio unavailable */
    }
  }

  function playBoomSound() {
    try {
      const ctx = ensureAudio();
      const t = ctx.currentTime;
      const duration = 0.55;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        const decay = Math.pow(1 - i / bufferSize, 1.8);
        data[i] = (Math.random() * 2 - 1) * decay;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(1200, t);
      filter.frequency.exponentialRampToValueAtTime(80, t + duration);
      const gain = ctx.createGain();
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.55, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      noise.start(t);
      noise.stop(t + duration);

      const boom = ctx.createOscillator();
      const boomGain = ctx.createGain();
      boom.type = "sawtooth";
      boom.connect(boomGain);
      boomGain.connect(ctx.destination);
      boom.frequency.setValueAtTime(120, t);
      boom.frequency.exponentialRampToValueAtTime(35, t + 0.35);
      boomGain.gain.setValueAtTime(0.2, t);
      boomGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      boom.start(t);
      boom.stop(t + 0.4);
    } catch {
      /* audio unavailable */
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      return {
        settings: migrateSettings(parsed.settings || {}),
        players: parsed.players || {},
        game: { ...base.game, ...parsed.game },
      };
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function ensurePlayerStats(name) {
    if (!name) return;
    if (!state.players[name]) {
      state.players[name] = { wins: 0, losses: 0 };
    }
  }

  function getStats(name) {
    ensurePlayerStats(name);
    const s = state.players[name];
    return { wins: s.wins, losses: s.losses };
  }

  function recordWinLoss(winnerName, loserName) {
    ensurePlayerStats(winnerName);
    ensurePlayerStats(loserName);
    state.players[winnerName].wins += 1;
    state.players[loserName].losses += 1;
  }

  function createBoards() {
    boardP1.innerHTML = "";
    boardP2.innerHTML = "";
    for (let i = 0; i < TILE_COUNT; i++) {
      boardP1.appendChild(createTile(1, i));
      boardP2.appendChild(createTile(2, i));
    }
  }

  function createTile(player, index) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile";
    btn.dataset.player = String(player);
    btn.dataset.index = String(index);
    btn.setAttribute("aria-label", `Tile ${index + 1}`);
    const cover = document.createElement("span");
    cover.className = "cover";
    const explosion = document.createElement("span");
    explosion.className = "explosion";
    btn.appendChild(cover);
    btn.appendChild(explosion);
    btn.addEventListener("click", () => handleTileClick(player, index));
    return btn;
  }

  function getTileEl(player, index) {
    const board = player === 1 ? boardP1 : boardP2;
    return board.querySelector(`[data-index="${index}"]`);
  }

  function handleTileClick(boardOwner, index) {
    if (animating) return;
    ensureAudio();
    const g = state.game;

    if (g.phase === "setup") {
      handleSetupClick(boardOwner, index);
      return;
    }

    if (g.phase === "playing") {
      handlePlayClick(boardOwner, index);
    }
  }

  function handleSetupClick(boardOwner, index) {
    const g = state.game;
    const setupPlayer = g.setupPlayer;

    if (boardOwner !== setupPlayer) return;

    const bombs = setupPlayer === 1 ? g.p1Bombs : g.p2Bombs;
    const idx = bombs.indexOf(index);

    if (idx >= 0) {
      bombs.splice(idx, 1);
    } else if (bombs.length < BOMB_COUNT) {
      bombs.push(index);
    } else {
      return;
    }

    if (bombs.length === BOMB_COUNT) {
      if (setupPlayer === 1) {
        g.setupPlayer = 2;
      } else {
        g.phase = "playing";
        g.currentTurn = 1;
      }
    }

    saveState();
    render();
  }

  function handlePlayClick(boardOwner, index) {
    const g = state.game;
    const attacker = g.currentTurn;
    const targetBoard = attacker === 1 ? 2 : 1;

    if (boardOwner !== targetBoard) return;
    if (attacker !== g.currentTurn) return;

    const revealed = targetBoard === 1 ? g.p1Revealed : g.p2Revealed;
    if (revealed.includes(index)) return;

    const bombs = targetBoard === 1 ? g.p1Bombs : g.p2Bombs;
    const isBomb = bombs.includes(index);

    revealed.push(index);
    const tile = getTileEl(boardOwner, index);

    if (isBomb) {
      playBoomSound();
      animating = true;
      tile.classList.add("exploding", "revealed-bomb");
      tile.disabled = true;

      if (attacker === 1) {
        g.p1BombsHit += 1;
      } else {
        g.p2BombsHit += 1;
      }

      saveState();
      turnText.textContent = getTurnMessage();

      setTimeout(() => {
        tile.classList.remove("exploding");
        animating = false;

        const hits = attacker === 1 ? g.p1BombsHit : g.p2BombsHit;
        if (hits >= BOMB_COUNT) {
          endGame(attacker);
        } else {
          g.currentTurn = attacker === 1 ? 2 : 1;
          saveState();
          render();
          pulseTurnText();
        }
      }, 650);
    } else {
      playEatSound();
      tile.classList.add("revealed-safe");
      tile.disabled = true;
      g.currentTurn = attacker === 1 ? 2 : 1;
      saveState();
      render();
      pulseTurnText();
    }
  }

  function endGame(loserPlayer) {
    const g = state.game;
    g.phase = "gameover";
    g.loser = loserPlayer;
    g.winner = loserPlayer === 1 ? 2 : 1;

    const winnerName = g.winner === 1 ? g.p1Name : g.p2Name;
    const loserName = g.loser === 1 ? g.p1Name : g.p2Name;

    recordWinLoss(winnerName, loserName);
    saveState();
    render();
    showGameOver(winnerName, loserName);
  }

  function showGameOver(winnerName, loserName) {
    gameoverMessage.textContent = `💥 BOOM! 💥\n${loserName} hit 3 bombs!\n${winnerName} wins!`;
    gameoverOverlay.hidden = false;
    spawnConfetti();
  }

  function spawnConfetti() {
    const container = $("#confetti");
    container.innerHTML = "";
    const emojis = ["🎉", "⭐", "🍬", "🥔", "💥", "🏆"];
    for (let i = 0; i < 24; i++) {
      const span = document.createElement("span");
      span.textContent = emojis[i % emojis.length];
      span.style.left = Math.random() * 100 + "%";
      span.style.animationDelay = Math.random() * 0.8 + "s";
      span.style.animationDuration = 1.5 + Math.random() * 1.5 + "s";
      container.appendChild(span);
    }
  }

  function newRound() {
    const g = state.game;
    g.phase = "setup";
    g.setupPlayer = 1;
    g.p1Bombs = [];
    g.p2Bombs = [];
    g.p1Revealed = [];
    g.p2Revealed = [];
    g.p1BombsHit = 0;
    g.p2BombsHit = 0;
    g.currentTurn = 1;
    g.winner = null;
    g.loser = null;
    gameoverOverlay.hidden = true;
    saveState();
    render();
  }

  function resetAll() {
    if (
      !confirm(
        "Reset game? Stats, names, and current progress will all be cleared."
      )
    ) {
      return;
    }
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    saveState();
    gameoverOverlay.hidden = true;
    settingsModal.hidden = true;
    render();
  }

  function startGame() {
    const g = state.game;
    g.p1Name = p1NameInput.value.trim() || "Player 1";
    g.p2Name = p2NameInput.value.trim() || "Player 2";
    ensurePlayerStats(g.p1Name);
    ensurePlayerStats(g.p2Name);
    g.phase = "setup";
    g.setupPlayer = 1;
    g.p1Bombs = [];
    g.p2Bombs = [];
    g.p1Revealed = [];
    g.p2Revealed = [];
    g.p1BombsHit = 0;
    g.p2BombsHit = 0;
    g.currentTurn = 1;
    g.winner = null;
    g.loser = null;
    saveState();
    render();
  }

  function openSettings() {
    settingsModal.hidden = false;
    syncSettingsUI();
  }

  function closeSettings() {
    settingsModal.hidden = true;
  }

  function setCoverPreset(preset) {
    if (!SHAPES.includes(preset)) return;
    state.settings.coverPreset = preset;
    saveState();
    render();
    syncSettingsUI();
  }

  function setCustomCover(value) {
    state.settings.coverPreset = "custom";
    state.settings.customCover = value;
    saveState();
    render();
    syncSettingsUI();
  }

  function syncSettingsUI() {
    const preset = state.settings.coverPreset;
    document.querySelectorAll(".shape-btn").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.shape === preset);
    });
    customCoverInput.value = state.settings.customCover || "";
    const emoji = getCoverEmoji();
    customCoverPreview.textContent = preset === "custom" ? emoji : "";
    customCoverInput.classList.toggle("active-custom", preset === "custom");
  }

  function updateAllCovers() {
    const emoji = getCoverEmoji();
    document.querySelectorAll(".tile .cover").forEach((cover) => {
      const tile = cover.closest(".tile");
      if (tile && !tile.classList.contains("revealed-bomb")) {
        cover.textContent = emoji;
      }
    });
  }

  function pulseTurnText() {
    turnText.classList.remove("pulse");
    void turnText.offsetWidth;
    turnText.classList.add("pulse");
  }

  function syncNamesFromInputs() {
    if (state.game.phase === "names") {
      state.game.p1Name = p1NameInput.value.trim() || "Player 1";
      state.game.p2Name = p2NameInput.value.trim() || "Player 2";
      saveState();
    }
  }

  function render() {
    const g = state.game;

    p1NameInput.value = g.p1Name;
    p2NameInput.value = g.p2Name;

    const s1 = getStats(g.p1Name);
    const s2 = getStats(g.p2Name);
    p1Stats.textContent = `W: ${s1.wins}  L: ${s1.losses}`;
    p2Stats.textContent = `W: ${s2.wins}  L: ${s2.losses}`;

    const namesEditable = g.phase === "names";
    p1NameInput.disabled = !namesEditable;
    p2NameInput.disabled = !namesEditable;

    btnStart.hidden = g.phase !== "names";

    renderBoard(1, boardP1, g.p1Bombs, g.p1Revealed);
    renderBoard(2, boardP2, g.p2Bombs, g.p2Revealed);

    turnText.textContent = getTurnMessage();
    updateAllCovers();
  }

  function renderBoard(player, boardEl, bombs, revealed) {
    const g = state.game;
    const tiles = boardEl.querySelectorAll(".tile");

    tiles.forEach((tile) => {
      const index = parseInt(tile.dataset.index, 10);
      tile.className = "tile";
      tile.disabled = false;

      const isRevealed = revealed.includes(index);
      const isBomb = bombs.includes(index);

      if (g.phase === "setup") {
        const setupPlayer = g.setupPlayer;
        const isOwnBoard = player === setupPlayer;
        const showSetupSelected =
          isOwnBoard && isBomb && setupPlayer === player;

        if (showSetupSelected) {
          tile.classList.add("setup-selected");
        }

        if (!isOwnBoard || setupPlayer !== player) {
          tile.classList.add("disabled-zone");
          tile.disabled = true;
        } else {
          tile.disabled = false;
        }
        return;
      }

      if (g.phase === "playing" || g.phase === "gameover") {
        if (isRevealed) {
          tile.disabled = true;
          if (isBomb) {
            tile.classList.add("revealed-bomb");
          } else {
            tile.classList.add("revealed-safe");
          }
        } else {
          const attacker = g.currentTurn;
          const targetBoard = attacker === 1 ? 2 : 1;
          const canTap = g.phase === "playing" && player === targetBoard;

          if (!canTap) {
            tile.classList.add("disabled-zone");
            tile.disabled = true;
          }
        }
      }

      if (g.phase === "gameover") {
        tile.classList.add("disabled-zone");
        tile.disabled = true;
      }
    });
  }

  function getTurnMessage() {
    const g = state.game;
    const p1 = g.p1Name;
    const p2 = g.p2Name;

    if (g.phase === "names") {
      return "Enter names & tap Start";
    }

    if (g.phase === "setup") {
      const who = g.setupPlayer === 1 ? p1 : p2;
      const bombs = g.setupPlayer === 1 ? g.p1Bombs : g.p2Bombs;
      const left = BOMB_COUNT - bombs.length;
      if (left > 0) {
        return `${who}: hide ${left} bomb${left > 1 ? "s" : ""}`;
      }
      return `${who}: hide 3 bombs`;
    }

    if (g.phase === "playing") {
      const who = g.currentTurn === 1 ? p1 : p2;
      const target = g.currentTurn === 1 ? p2 : p1;
      return `${who}'s turn — pick on ${target}'s board`;
    }

    if (g.phase === "gameover") {
      const winner = g.winner === 1 ? p1 : p2;
      return `${winner} wins!`;
    }

    return "";
  }

  function checkLandscape() {
    const isLandscape = window.matchMedia("(orientation: landscape)").matches;
    landscapeWarning.classList.toggle("is-visible", isLandscape);
    app.classList.toggle("is-landscape-hidden", isLandscape);
  }

  function init() {
    state = loadState();
    createBoards();

    btnStart.addEventListener("click", () => {
      ensureAudio();
      startGame();
    });
    btnReset.addEventListener("click", resetAll);
    btnSettings.addEventListener("click", openSettings);
    btnCloseSettings.addEventListener("click", closeSettings);
    btnPlayAgain.addEventListener("click", newRound);

    settingsModal.querySelector(".modal-backdrop").addEventListener("click", closeSettings);

    document.querySelectorAll(".shape-btn").forEach((btn) => {
      btn.addEventListener("click", () => setCoverPreset(btn.dataset.shape));
    });

    customCoverInput.addEventListener("input", () => {
      setCustomCover(customCoverInput.value);
    });

    customCoverInput.addEventListener("focus", () => {
      ensureAudio();
      if (customCoverInput.value.trim()) {
        setCustomCover(customCoverInput.value);
      }
    });

    p1NameInput.addEventListener("input", syncNamesFromInputs);
    p2NameInput.addEventListener("input", syncNamesFromInputs);

    window.addEventListener("resize", checkLandscape);
    window.addEventListener("orientationchange", checkLandscape);

    if (state.game.phase === "gameover") {
      const g = state.game;
      const winnerName = g.winner === 1 ? g.p1Name : g.p2Name;
      const loserName = g.loser === 1 ? g.p1Name : g.p2Name;
      gameoverMessage.textContent = `💥 BOOM! 💥\n${loserName} hit 3 bombs!\n${winnerName} wins!`;
      gameoverOverlay.hidden = false;
      spawnConfetti();
    }

    checkLandscape();
    render();
    syncSettingsUI();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
