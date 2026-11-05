(() => {
  const FINAL_PORTAL_SELECTOR = ".map-hotspot.hotspot-red";
  const LEVEL_PORTAL_SELECTORS = [
    ".map-hotspot.hotspot-amber",
    ".map-hotspot.hotspot-cyan",
    ".map-hotspot.hotspot-blue",
    ".map-hotspot.hotspot-emerald",
    ".map-hotspot.hotspot-red",
  ];
  const RETURN_DELAY_MS = 7000;
  let requestedPortal = null;
  let returnTimer = null;
  let watchedGame = null;
  let watchedStairScene = null;
  let stairResizeObserver = null;

  function openFinalLevel() {
    openPortal(FINAL_PORTAL_SELECTOR);
  }

  function openPortal(selector) {
    const portal = document.querySelector(selector);
    if (portal && document.querySelector(".map-screen")) {
      requestedPortal = null;
      portal.click();
      return;
    }

    requestedPortal = selector;
    const returnButton = document.querySelector(".back-button");
    returnButton?.click();
  }

  function addFinalLevelButton(container, location) {
    if (!container || container.querySelector(".maya-final-shortcut")) return;

    const button = document.createElement("button");
    button.className = `maya-final-shortcut maya-final-shortcut-${location}`;
    button.type = "button";
    button.textContent = "NIVEAU FINAL";
    button.setAttribute("aria-label", "Accéder directement au niveau final, Escalier des étoiles");
    button.addEventListener("click", openFinalLevel);
    container.append(button);
  }

  function addNextLevelButton(container, currentLevel) {
    if (!container) return;

    const existing = container.querySelector(".maya-next-level");
    if (currentLevel >= LEVEL_PORTAL_SELECTORS.length - 1) {
      existing?.remove();
      return;
    }

    const nextLevel = currentLevel + 2;
    if (existing?.dataset.nextLevel === String(nextLevel)) return;
    existing?.remove();

    const button = document.createElement("button");
    button.className = "maya-next-level";
    button.type = "button";
    button.textContent = "NIVEAU SUIVANT";
    button.dataset.nextLevel = String(nextLevel);
    button.setAttribute("aria-label", `Passer au niveau ${nextLevel}`);
    button.addEventListener("click", () => openPortal(LEVEL_PORTAL_SELECTORS[currentLevel + 1]));
    container.append(button);
  }

  function updateStaircase(game) {
    const scene = game.querySelector(".stair-scene");
    const staircase = game.querySelector(".staircase");
    if (!scene || !staircase) return;

    let structure = staircase.querySelector(".maya-stair-structure");
    if (!structure) {
      structure = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      structure.classList.add("maya-stair-structure");
      structure.setAttribute("viewBox", "0 0 1000 410");
      structure.setAttribute("preserveAspectRatio", "none");
      structure.setAttribute("aria-hidden", "true");
      structure.innerHTML = `
        <defs>
          <linearGradient id="maya-stair-stone" x1="0" x2="0.08" y1="0" y2="1">
            <stop offset="0" stop-color="#b39a69" />
            <stop offset=".18" stop-color="#806a46" />
            <stop offset="1" stop-color="#403522" />
          </linearGradient>
          <pattern id="maya-stair-blocks" width="72" height="36" patternUnits="userSpaceOnUse">
            <path d="M0 1H72M0 18H72M0 35H72M36 1V18M16 18V35" fill="none" stroke="#dac391" stroke-opacity=".22" stroke-width="1" />
          </pattern>
        </defs>
        <path class="maya-stair-mass" />
        <path class="maya-stair-blockwork" fill="url(#maya-stair-blocks)" />
        <path class="maya-stair-outline" fill="none" />
      `;
      staircase.prepend(structure);
    }

    const redraw = () => {
      if (!scene.isConnected) return;
      const compact = window.matchMedia("(max-width: 900px)").matches;
      const rise = compact ? 6 : 12;
      const treadHeight = compact ? 6 : 12;
      const firstStepBottom = compact ? 14 : 12;
      const sceneHeight = scene.clientHeight || 410;
      const yAt = (index) => ((sceneHeight - firstStepBottom - treadHeight - index * rise) / sceneHeight) * 410;
      const outline = [`M 20 ${yAt(0).toFixed(2)}`];

      for (let index = 0; index < 30; index += 1) {
        const right = 52 + index * 32;
        outline.push(`H ${right}`);
        if (index < 29) {
          outline.push(`V ${yAt(index + 1).toFixed(2)}`);
          outline.push(`H ${20 + (index + 1) * 32}`);
        }
      }

      const topEdge = outline.join(" ");
      const closedShape = `${topEdge} V 410 H 20 Z`;
      structure.querySelector(".maya-stair-mass").setAttribute("d", closedShape);
      structure.querySelector(".maya-stair-blockwork").setAttribute("d", closedShape);
      structure.querySelector(".maya-stair-outline").setAttribute("d", topEdge);
    };

    if (watchedStairScene !== scene) {
      stairResizeObserver?.disconnect();
      watchedStairScene = scene;
      stairResizeObserver = new ResizeObserver(redraw);
      stairResizeObserver.observe(scene);
    }
    redraw();
  }

  function addWaterSurface(map) {
    const mapImage = map.querySelector(".map-image-wrap");
    if (!mapImage || mapImage.querySelector(".maya-water-surface")) return;

    const surface = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    surface.classList.add("maya-water-surface");
    surface.setAttribute("viewBox", "0 0 1408 768");
    surface.setAttribute("preserveAspectRatio", "none");
    surface.setAttribute("aria-hidden", "true");
    surface.innerHTML = `
      <defs>
        <filter id="maya-water-current" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.014" numOctaves="2" seed="12" result="current">
            <animate attributeName="baseFrequency" values="0.006 0.012;0.011 0.019;0.006 0.012" dur="19s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="current" scale="28" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <radialGradient id="maya-water-glint">
          <stop offset="0" stop-color="#c1fff4" stop-opacity=".42" />
          <stop offset=".46" stop-color="#72e2e8" stop-opacity=".2" />
          <stop offset="1" stop-color="#72e2e8" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="maya-water-depth" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#63e2e6" stop-opacity=".16" />
          <stop offset=".48" stop-color="#b6fff1" stop-opacity=".05" />
          <stop offset="1" stop-color="#2589d4" stop-opacity=".2" />
        </linearGradient>
      </defs>
      <rect width="1408" height="768" fill="url(#maya-water-depth)" filter="url(#maya-water-current)" />
      <g fill="url(#maya-water-glint)">
        <ellipse cx="215" cy="335" rx="135" ry="48">
          <animate attributeName="cx" values="215;260;215" dur="17s" repeatCount="indefinite" />
          <animate attributeName="ry" values="38;54;38" dur="11s" repeatCount="indefinite" />
        </ellipse>
        <ellipse cx="1185" cy="300" rx="155" ry="55">
          <animate attributeName="cx" values="1185;1138;1185" dur="21s" repeatCount="indefinite" />
          <animate attributeName="ry" values="52;39;52" dur="14s" repeatCount="indefinite" />
        </ellipse>
        <ellipse cx="435" cy="713" rx="190" ry="43">
          <animate attributeName="cx" values="435;490;435" dur="24s" repeatCount="indefinite" />
          <animate attributeName="ry" values="35;47;35" dur="16s" repeatCount="indefinite" />
        </ellipse>
        <ellipse cx="1030" cy="690" rx="180" ry="46">
          <animate attributeName="cx" values="1030;970;1030" dur="22s" repeatCount="indefinite" />
          <animate attributeName="ry" values="48;34;48" dur="13s" repeatCount="indefinite" />
        </ellipse>
      </g>
    `;
    mapImage.insertBefore(surface, mapImage.querySelector(".map-hotspot"));
  }

  function updateMapPresentation(map) {
    addWaterSurface(map);
    map.querySelectorAll(".map-hotspot").forEach((portal) => {
      portal.setAttribute("data-flag-marker", "");
    });
  }

  function hasWinner(game) {
    const raceStatus = game.querySelector(".race-status")?.textContent ?? "";
    if (/remporte la course/i.test(raceStatus)) return true;

    const connectFourStatus = game.querySelector(".connect-four-player strong")?.textContent ?? "";
    if (/\ba gagné\b/i.test(connectFourStatus)) return true;

    if ([...game.querySelectorAll(".rps-opponent")].filter((opponent) => (
      opponent.classList.contains("immobilized")
    )).length === 3) return true;

    if ([...game.querySelectorAll(".marble-racer-tag")].some((racer) => (
      racer.textContent.includes("GAGNANT")
    ))) return true;

    const stairStatus = game.querySelector(".stair-status")?.textContent ?? "";
    return game.querySelector(".stair-champion") !== null
      || /\bgagne avec\b/i.test(stairStatus)
      || [...game.querySelectorAll("button")].some((button) => (
        button.textContent.includes("PASSER AU NIVEAU SUIVANT")
      ));
  }

  function scheduleIslandReturn(game) {
    if (returnTimer !== null) return;

    returnTimer = window.setTimeout(() => {
      returnTimer = null;
      if (game.isConnected && document.querySelector(".mini-game") === game) {
        document.querySelector(".back-button")?.click();
      }
    }, RETURN_DELAY_MS);
  }

  function updateNavigation() {
    const map = document.querySelector(".map-screen");
    if (map) {
      updateMapPresentation(map);
      addFinalLevelButton(map.querySelector(".top-actions"), "map");

      if (requestedPortal) {
        const portal = map.querySelector(requestedPortal);
        if (portal) {
          requestedPortal = null;
          portal.click();
        }
      }
    }

    const levelScreen = document.querySelector(".level-screen");
    const game = document.querySelector(".mini-game");
    const gameThemes = [
      ["maya-game-horse", "horse-race-game"],
      ["maya-game-rps", "rps-game"],
      ["maya-game-connect-four", "connect-four-game"],
      ["maya-game-marbles", "marble-race-game"],
      ["maya-game-stairs", "stair-climb-game"],
    ];
    if (levelScreen) {
      levelScreen.classList.toggle("maya-game-fullscreen", Boolean(game));
      const activeTheme = gameThemes.find(([, gameClass]) => game?.classList.contains(gameClass));
      const currentTheme = gameThemes.find(([theme]) => levelScreen.classList.contains(theme));
      if (activeTheme?.[0] !== currentTheme?.[0]) {
        gameThemes.forEach(([theme]) => levelScreen.classList.remove(theme));
        if (activeTheme) levelScreen.classList.add(activeTheme[0]);
      }
      const currentLevel = activeTheme
        ? gameThemes.findIndex(([, gameClass]) => gameClass === activeTheme[1])
        : -1;
      if (currentLevel >= 0) {
        addNextLevelButton(document.querySelector(".level-tools"), currentLevel);
      }
    }

    if (game) {
      game.classList.add("maya-clean-registrations");
      if (game.classList.contains("stair-climb-game")) updateStaircase(game);
      addFinalLevelButton(document.querySelector(".level-tools"), "game");

      if (watchedGame !== game) {
        if (returnTimer !== null) window.clearTimeout(returnTimer);
        returnTimer = null;
        watchedGame = game;
      }

      if (hasWinner(game)) scheduleIslandReturn(game);
    } else {
      watchedGame = null;
      watchedStairScene = null;
      stairResizeObserver?.disconnect();
      stairResizeObserver = null;
      if (returnTimer !== null) window.clearTimeout(returnTimer);
      returnTimer = null;
    }
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest(".back-button") && !requestedPortal) {
      if (returnTimer !== null) window.clearTimeout(returnTimer);
      returnTimer = null;
    }
  });

  const observer = new MutationObserver(updateNavigation);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  updateNavigation();
})();
