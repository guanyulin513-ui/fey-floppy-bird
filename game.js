(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const COLORS = {
    birdBody: "#F4D03F",
    birdShadow: "#D4AC0D",
    beak: "#E67E22",
    beakShadow: "#CA6F1E",
    wing: "#F8E5A2",

    pipeMain: "#27AE60",
    pipeDark: "#1E8449",
    pipeHighlight: "#52BE80",

    cloud: "#FFFFFF",
    cloudShadow: "#D5D8DC",

    skyMain: "#5DADE2",
    skyGradient: "#85C1E9",

    groundSoil: "#D4AC0D",
    groundShadow: "#9A7D0A",
    grass: "#229954",

    text: "#FFFFFF",
    textShadow: "rgba(0,0,0,0.35)",
    overlay: "rgba(0,0,0,0.35)",

    buttonBg: "rgba(255,255,255,0.18)",
    buttonBorder: "rgba(255,255,255,0.42)",
    buttonOff: "rgba(255,120,120,0.92)",
    buttonOnGlow: "rgba(255,255,255,0.28)"
  };

  const CM = {
    birdSize: 0.2,
    birdBeakLength: 0.1,
    birdBeakWidth: 0.025,
    birdWingLength: 0.1,
    birdWingWidth: 0.025,

    pipeGapHeight: 0.9,
    pipeWidth: 0.3,

    groundHeight: 0.35,
    birdXRatio: 0.30,

    gravity: 6.2,
    jumpImpulse: -1.78,
    maxFallSpeed: 3.35,

    minPipeSpacing: 0.9,
    midPipeSpacing: 1.9,
    maxPipeSpacing: 3.0,

    initialSceneSpeed: 0.85,
    accelerationPerSecond: 0.012,
    maxSceneSpeed: 1.85
  };

  const PHYSICS = {
    groundBounceRestitution: 0.42,
    pipeBounceRestitution: 0.58,
    sideBounceRestitution: 0.52,
    tangentialFriction: 0.88,
    deathAirDrag: 0.996,
    settleSpeedPx: 18,
    settleVerticalPx: 14
  };

  const EASTER = {
    swipeMinDistance: 55,
    swipeMaxOffAxis: 48,
    swipeWindowMs: 1400,
    tapMaxDistance: 14,
    tapMaxDurationMs: 260,
    reverseFlightSpeedCm: 1.25,
    reverseReturnThresholdPx: 8,
    offscreenFlightSpeedCm: 1.75,
    endingBirdSpeedCm: 0.62,
    endingSkipThresholdRatio: 0.55,

    drillChance: 0.1,
    drillLockSeconds: 3,
    drillDigSpeedCm: 0.23
  };

  let width = 0;
  let height = 0;
  let scale = 0;

  let state = "ready"; // ready | playing | gameover | easter_end | drill_end
  let lastTime = 0;
  let elapsedGameTime = 0;

  let highScore = Number(localStorage.getItem("flappy_high_score") || 0);
  let score = 0;

  let bird = null;
  let pipes = [];
  let clouds = [];
  let groundOffsetPx = 0;
  let dirtParticles = [];
  let dirtMounds = [];

  let birdSettledAfterDeath = false;
  let deathPose = "none";
  let soundEnabled = true;

  let audioContext = null;
  let masterGain = null;
  let bgmTimer = null;
  let specialAudioNodes = [];

  let easterEndingBird = null;
  let easterEndingReadyToReset = false;

  let drillStartTime = 0;
  let drillReadyToReset = false;
  let drillDepth = 0;
  let drillRotation = 0;

  let cameraShakeTime = 0;
  let cameraShakeStrength = 0;

  let worldOffsetPx = 0;
  let reverseMode = false;
  let worldFrozenForExit = false;
  let leftSwipeTimes = [];
  let pointerTracking = null;

  let hasActuallyStarted = false;
  let anyInputAfterStart = false;

  function cmToPx(cm) {
    return cm * scale;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep01(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;

    width = Math.max(window.innerWidth, 320);
    height = Math.max(window.innerHeight, 320);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    scale = height / 3;
    initializeGameObjects();
  }

  function initializeGameObjects() {
    const previousHighScore = highScore;

    bird = createBird();
    pipes = [];
    clouds = createClouds();
    dirtParticles = [];
    dirtMounds = [];
    groundOffsetPx = 0;

    worldOffsetPx = 0;
    reverseMode = false;
    worldFrozenForExit = false;
    leftSwipeTimes = [];
    pointerTracking = null;

    score = 0;
    elapsedGameTime = 0;
    birdSettledAfterDeath = false;
    deathPose = "none";

    easterEndingBird = null;
    easterEndingReadyToReset = false;

    drillStartTime = 0;
    drillReadyToReset = false;
    drillDepth = 0;
    drillRotation = 0;

    cameraShakeTime = 0;
    cameraShakeStrength = 0;

    hasActuallyStarted = false;
    anyInputAfterStart = false;

    highScore = previousHighScore;
    state = "ready";

    stopAllAudioLoops();
    createInitialPipes();
  }

  function resetGame() {
    initializeGameObjects();
  }

  function createBird() {
    const size = cmToPx(CM.birdSize);
    return {
      x: width * CM.birdXRatio,
      y: height * 0.40,
      size,
      wingTimer: 0,
      angle: -0.08,
      velocityX: 0,
      velocityY: 0,
      embedDepth: 0
    };
  }

  function createClouds() {
    const result = [];
    const count = Math.max(4, Math.floor(width / 220));

    for (let i = 0; i < count; i++) {
      result.push({
        x: (i / count) * width + Math.random() * 80,
        y: height * (0.08 + Math.random() * 0.28),
        size: cmToPx(0.18 + Math.random() * 0.18),
        speedFactor: 0.16 + Math.random() * 0.12
      });
    }

    return result;
  }

  function createInitialPipes() {
    const firstWorldX = width + cmToPx(0.8);
    pipes.push(createPipe(firstWorldX));
    ensurePipesFilled();
  }

  function createPipe(worldX) {
    const gapHeight = cmToPx(CM.pipeGapHeight);
    const pipeWidth = cmToPx(CM.pipeWidth);
    const groundHeight = cmToPx(CM.groundHeight);

    const minTop = height * 0.12;
    const maxTop = height - groundHeight - gapHeight - height * 0.18;
    const gapTop = lerp(minTop, maxTop, Math.random());

    return {
      worldX,
      width: pipeWidth,
      gapTop,
      gapHeight,
      scoredForward: false
    };
  }

  function getPipeSpacingCmByTime(timeSec) {
    const startSpacing = 3.0;
    const endSpacing = 0.95;
    const t = smoothstep01(timeSec / 50);
    return lerp(startSpacing, endSpacing, t);
  }

  function ensurePipesFilled() {
    const pipeWidthPx = cmToPx(CM.pipeWidth);
    const spacingPx = cmToPx(getPipeSpacingCmByTime(elapsedGameTime));
    const minRightWorldX = worldOffsetPx + width + spacingPx + pipeWidthPx;

    if (pipes.length === 0) {
      pipes.push(createPipe(worldOffsetPx + width + cmToPx(0.8)));
    }

    while (pipes.length < 4 || pipes[pipes.length - 1].worldX < minRightWorldX) {
      const lastPipe = pipes[pipes.length - 1];
      const nextX = lastPipe.worldX + pipeWidthPx + spacingPx;
      pipes.push(createPipe(nextX));
    }
  }

  function getSceneSpeedCmPerSec(timeSec, currentScore) {
    const byTime = CM.initialSceneSpeed + CM.accelerationPerSecond * timeSec;
    const byScoreBonus = Math.min(currentScore * 0.008, 0.25);
    return clamp(byTime + byScoreBonus, CM.initialSceneSpeed, CM.maxSceneSpeed);
  }

  function getPipeScreenX(pipe) {
    return pipe.worldX - worldOffsetPx;
  }

  function getSoundButtonRect() {
    const size = Math.max(42, Math.min(56, Math.floor(height * 0.07)));
    const margin = Math.max(12, Math.floor(height * 0.02));
    return {
      x: width - margin - size,
      y: margin,
      w: size,
      h: size
    };
  }

  function pointInRect(px, py, rect) {
    return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
  }

  function markUserInput() {
    if (state === "playing" && hasActuallyStarted) {
      anyInputAfterStart = true;
    }
  }

  function ensureAudio() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioContext = new AudioCtx();
      masterGain = audioContext.createGain();
      masterGain.gain.value = soundEnabled ? 0.18 : 0.0001;
      masterGain.connect(audioContext.destination);
    }

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    if (!bgmTimer && state !== "easter_end" && state !== "drill_end") {
      startBackgroundMusicLoop();
    }

    updateMasterGain();
  }

  function updateMasterGain() {
    if (!masterGain || !audioContext) return;
    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(soundEnabled ? 0.18 : 0.0001, now);
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    ensureAudio();
    updateMasterGain();
  }

  function startPlayingIfNeeded() {
    if (state === "ready") {
      state = "playing";
      hasActuallyStarted = true;
      anyInputAfterStart = false;
      flapBird();
    }
  }

  function flapBird() {
    if (state === "gameover" || state === "easter_end" || state === "drill_end") return;
    bird.velocityY = cmToPx(CM.jumpImpulse);
    playFlapSound();
  }

  function triggerAction() {
    ensureAudio();

    if (state === "ready") {
      startPlayingIfNeeded();
      return;
    }

    if (state === "playing") {
      markUserInput();
      flapBird();
      return;
    }

    if (state === "gameover") {
      if (!birdSettledAfterDeath) return;
      resetGame();
      return;
    }

    if (state === "easter_end") {
      if (!easterEndingReadyToReset) return;
      resetGame();
      return;
    }

    if (state === "drill_end") {
      const elapsed = performance.now() / 1000 - drillStartTime;
      if (elapsed < EASTER.drillLockSeconds) return;
      if (!drillReadyToReset) return;
      resetGame();
    }
  }

  function registerSwipe(dx, dy) {
    if (state !== "playing") return;
    if (Math.abs(dy) > EASTER.swipeMaxOffAxis) return;
    if (Math.abs(dx) < EASTER.swipeMinDistance) return;

    const now = performance.now();

    if (dx < 0) {
      markUserInput();
      flapBird();
      leftSwipeTimes = leftSwipeTimes.filter((t) => now - t <= EASTER.swipeWindowMs);
      leftSwipeTimes.push(now);
      if (leftSwipeTimes.length >= 3) {
        reverseMode = true;
        leftSwipeTimes = [];
      }
    } else if (dx > 0) {
      markUserInput();
      leftSwipeTimes = [];
      if (reverseMode) {
        reverseMode = false;
        worldFrozenForExit = false;
      }
    }
  }

  function getBirdBoxAt(x, y) {
    const half = bird.size / 2;
    return {
      left: x - half,
      right: x + half,
      top: y - half,
      bottom: y + half
    };
  }

  function isBirdRestingOnSurface() {
    const box = getBirdBoxAt(bird.x, bird.y);
    const groundTop = height - cmToPx(CM.groundHeight);
    if (Math.abs(box.bottom - groundTop) < 1.5) return true;

    for (const pipe of pipes) {
      const screenX = getPipeScreenX(pipe);

      const topRect = {
        left: screenX,
        right: screenX + pipe.width,
        top: 0,
        bottom: pipe.gapTop
      };

      const bottomRect = {
        left: screenX,
        right: screenX + pipe.width,
        top: pipe.gapTop + pipe.gapHeight,
        bottom: groundTop
      };

      if (
        box.right > topRect.left &&
        box.left < topRect.right &&
        Math.abs(box.top - topRect.bottom) < 1.5
      ) return true;

      if (
        box.right > bottomRect.left &&
        box.left < bottomRect.right &&
        Math.abs(box.bottom - bottomRect.top) < 1.5
      ) return true;
    }

    return false;
  }

  function spawnDirtBurst(x, y, strength, embed = false, upwardBias = 1) {
    const count = embed ? 42 : 30;
    const baseSpeed = embed ? 1.95 : 1.3;

    for (let i = 0; i < count; i++) {
      const angle = rand(-Math.PI * 0.98, -Math.PI * 0.02);
      const speed = cmToPx(baseSpeed * rand(0.55, 1.35) * Math.max(0.8, strength));
      dirtParticles.push({
        x,
        y,
        vx: Math.cos(angle) * speed * rand(0.85, 1.4),
        vy: Math.sin(angle) * speed * rand(0.85, 1.4) * upwardBias,
        life: rand(0.48, 0.9),
        maxLife: rand(0.48, 0.9),
        size: rand(cmToPx(0.025), cmToPx(0.07)),
        color: [
          COLORS.groundSoil,
          COLORS.groundShadow,
          "#E2BD5A",
          "#C8931B"
        ][Math.floor(Math.random() * 4)]
      });
    }
  }

  function spawnDrillDirt() {
    const mouthX = bird.x;
    const groundTop = height - cmToPx(CM.groundHeight);
    const mouthY = groundTop + Math.min(drillDepth, cmToPx(0.22));

    for (let i = 0; i < 8; i++) {
      dirtParticles.push({
        x: mouthX + rand(-cmToPx(0.05), cmToPx(0.05)),
        y: mouthY + rand(-cmToPx(0.02), cmToPx(0.02)),
        vx: rand(-1, 1) * cmToPx(0.5),
        vy: rand(-1.8, -0.6) * cmToPx(1),
        life: rand(0.6, 1.2),
        maxLife: rand(0.6, 1.2),
        size: rand(cmToPx(0.02), cmToPx(0.055)),
        color: [COLORS.groundSoil, COLORS.groundShadow, "#E2BD5A"][Math.floor(Math.random() * 3)]
      });
    }

    const moundSpread = Math.min(drillDepth * 0.7, cmToPx(0.55));
    dirtMounds.push({
      side: Math.random() < 0.5 ? -1 : 1,
      offset: rand(cmToPx(0.05), moundSpread + cmToPx(0.08)),
      width: rand(cmToPx(0.03), cmToPx(0.08)),
      height: rand(cmToPx(0.01), cmToPx(0.03)) + Math.min(drillDepth * 0.05, cmToPx(0.035))
    });

    if (dirtMounds.length > 260) {
      dirtMounds.shift();
    }
  }

  function updateParticles(dt) {
    for (let i = dirtParticles.length - 1; i >= 0; i--) {
      const p = dirtParticles[i];
      p.life -= dt;
      if (p.life <= 0) {
        dirtParticles.splice(i, 1);
        continue;
      }

      p.vy += cmToPx(5.2) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const groundTop = height - cmToPx(CM.groundHeight);
      if (p.y >= groundTop - p.size) {
        p.y = groundTop - p.size;
        p.vx *= 0.72;
        p.vy *= -0.12;
      }
    }
  }

  function maybeTriggerDrillEaster() {
    if (anyInputAfterStart) return false;
    if (Math.random() >= EASTER.drillChance) return false;

    state = "drill_end";
    drillStartTime = performance.now() / 1000;
    drillReadyToReset = false;
    drillDepth = 0;
    drillRotation = 0;

    bird.velocityX = 0;
    bird.velocityY = 0;
    bird.angle = Math.PI / 2;

    spawnDirtBurst(bird.x, height - cmToPx(CM.groundHeight), 1.4, true, 1.25);
    cameraShakeTime = 0.28;
    cameraShakeStrength = cmToPx(0.015);

    startDrillMusic();
    return true;
  }

  function updateBird(dt) {
    const groundTop = height - cmToPx(CM.groundHeight);
    const gravityPx = cmToPx(CM.gravity);
    const maxFallSpeedPx = cmToPx(CM.maxFallSpeed);

    if (state === "ready") {
      bird.wingTimer += dt;
      bird.angle = -0.08;
      bird.embedDepth = 0;
      bird.velocityX = 0;
      bird.velocityY = 0;
      bird.y += Math.sin(performance.now() * 0.004) * 0.12;
      return;
    }

    if (state === "playing") {
      bird.wingTimer += dt;
      bird.embedDepth = 0;
      bird.velocityX = 0;
      bird.velocityY += gravityPx * dt;
      bird.velocityY = Math.min(bird.velocityY, maxFallSpeedPx);
      bird.y += bird.velocityY * dt;

      const t = clamp(bird.velocityY / maxFallSpeedPx, -1, 1);
      bird.angle = reverseMode ? lerp(0.6, -1.2, (t + 1) / 2) : lerp(-0.6, 1.2, (t + 1) / 2);
      return;
    }

    if (state === "gameover") {
      bird.wingTimer += dt * 0.25;

      if (birdSettledAfterDeath) {
        bird.velocityX = 0;
        bird.velocityY = 0;
        if (deathPose === "embed") bird.angle = lerp(bird.angle, 1.35, 0.18);
        else if (deathPose === "pipe") bird.angle = lerp(bird.angle, 1.18, 0.18);
        else bird.angle = lerp(bird.angle, 1.0, 0.18);
        return;
      }

      const prevX = bird.x;
      const prevY = bird.y;

      bird.velocityY += gravityPx * dt;
      bird.velocityY = Math.min(bird.velocityY, maxFallSpeedPx);
      bird.velocityX *= Math.pow(PHYSICS.deathAirDrag, dt * 60);

      bird.x += bird.velocityX * dt;
      bird.y += bird.velocityY * dt;
      bird.angle = lerp(bird.angle, 1.42, 0.12);

      resolveDeathCollision(prevX, prevY, groundTop);

      const speed = Math.hypot(bird.velocityX, bird.velocityY);
      if (
        !birdSettledAfterDeath &&
        speed < PHYSICS.settleSpeedPx &&
        Math.abs(bird.velocityY) < PHYSICS.settleVerticalPx &&
        isBirdRestingOnSurface()
      ) {
        bird.velocityX = 0;
        bird.velocityY = 0;
        birdSettledAfterDeath = true;
      }
      return;
    }

    if (state === "drill_end") {
      drillRotation += dt * 22;
      drillDepth += cmToPx(EASTER.drillDigSpeedCm) * dt;
      bird.y += cmToPx(0.12) * dt;
      spawnDrillDirt();
      cameraShakeTime = Math.max(cameraShakeTime, 0.08);
      cameraShakeStrength = cmToPx(0.01 + Math.min(drillDepth / cmToPx(1.2), 1) * 0.012);
      drillReadyToReset = true;
      return;
    }
  }

  function resolveDeathCollision(prevX, prevY, groundTop) {
    for (let i = 0; i < 4; i++) {
      const prevBox = getBirdBoxAt(prevX, prevY);
      const box = getBirdBoxAt(bird.x, bird.y);

      if (box.bottom >= groundTop) {
        resolveGroundImpact(groundTop);
        if (birdSettledAfterDeath || state === "drill_end") return;
      }

      let collided = false;

      for (const pipe of pipes) {
        const screenX = getPipeScreenX(pipe);
        const topRect = { left: screenX, right: screenX + pipe.width, top: 0, bottom: pipe.gapTop };
        const bottomRect = {
          left: screenX,
          right: screenX + pipe.width,
          top: pipe.gapTop + pipe.gapHeight,
          bottom: groundTop
        };

        if (resolvePipeRectCollision(prevBox, box, topRect)) {
          collided = true;
          break;
        }
        if (resolvePipeRectCollision(prevBox, box, bottomRect)) {
          collided = true;
          break;
        }
      }

      if (!collided) break;
    }
  }

  function resolveGroundImpact(groundTop) {
    if (maybeTriggerDrillEaster()) return;

    const speedCm = Math.abs(bird.velocityY) / scale;
    const downwardFacing = bird.angle > 1.02;
    const hardImpact = speedCm > 1.35;
    const canEmbed = downwardFacing && hardImpact && Math.abs(bird.velocityX) < cmToPx(0.32);

    if (canEmbed) {
      const embedDepth = clamp(cmToPx(0.025 + speedCm * 0.012), cmToPx(0.01), cmToPx(0.055));
      bird.embedDepth = embedDepth;
      bird.y = groundTop - bird.size / 2 + embedDepth;
      bird.velocityX = 0;
      bird.velocityY = 0;
      bird.angle = Math.max(bird.angle, 1.22);
      birdSettledAfterDeath = true;
      deathPose = "embed";
      spawnDirtBurst(bird.x + bird.size * 0.18, groundTop, Math.min(1.6, speedCm), true);
      playGroundThudSound();
      return;
    }

    bird.y = groundTop - bird.size / 2;
    bird.embedDepth = 0;
    bird.velocityY = -Math.abs(bird.velocityY) * PHYSICS.groundBounceRestitution;
    bird.velocityX *= PHYSICS.tangentialFriction;
    bird.angle = Math.max(0.55, bird.angle * 0.72);
    deathPose = "bounce";
    spawnDirtBurst(bird.x + bird.size * 0.12, groundTop, Math.min(1.3, speedCm), false);
    playGroundBounceSound();

    if (
      Math.abs(bird.velocityY) < PHYSICS.settleVerticalPx &&
      Math.abs(bird.velocityX) < PHYSICS.settleSpeedPx
    ) {
      bird.velocityX = 0;
      bird.velocityY = 0;
      birdSettledAfterDeath = true;
      bird.angle = 1.0;
    }
  }

  function rectsOverlap(a, b) {
    return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
  }

  function resolvePipeRectCollision(prevBox, box, rect) {
    if (!rectsOverlap(box, rect)) return false;

    const overlapLeft = box.right - rect.left;
    const overlapRight = rect.right - box.left;
    const overlapTop = box.bottom - rect.top;
    const overlapBottom = rect.bottom - box.top;

    let normalX = 0;
    let normalY = 0;

    const cameFromTop = prevBox.bottom <= rect.top;
    const cameFromBottom = prevBox.top >= rect.bottom;
    const cameFromLeft = prevBox.right <= rect.left;
    const cameFromRight = prevBox.left >= rect.right;

    if (cameFromTop) normalY = -1;
    else if (cameFromBottom) normalY = 1;
    else if (cameFromLeft) normalX = -1;
    else if (cameFromRight) normalX = 1;
    else {
      const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
      if (minOverlap === overlapLeft) normalX = -1;
      else if (minOverlap === overlapRight) normalX = 1;
      else if (minOverlap === overlapTop) normalY = -1;
      else normalY = 1;
    }

    if (normalY === -1) {
      bird.y = rect.top - bird.size / 2;
      bird.velocityY = -Math.abs(bird.velocityY) * PHYSICS.pipeBounceRestitution;
      bird.velocityX *= PHYSICS.tangentialFriction;
      bird.angle = Math.max(0.8, bird.angle * 0.8);
      deathPose = "pipe";
      Math.abs(bird.velocityY) > PHYSICS.settleVerticalPx ? playPipeBounceSound() : playPipeHitSound();
      return true;
    }

    if (normalY === 1) {
      bird.y = rect.bottom + bird.size / 2;
      bird.velocityY = Math.abs(bird.velocityY) * 0.22;
      bird.velocityX *= PHYSICS.tangentialFriction;
      bird.angle = 1.48;
      deathPose = "pipe";
      playPipeHitSound();
      return true;
    }

    if (normalX === -1) {
      bird.x = rect.left - bird.size / 2;
      bird.velocityX = -Math.abs(bird.velocityX || cmToPx(0.35)) * PHYSICS.sideBounceRestitution;
      bird.velocityY *= 0.92;
      bird.angle = 1.16;
      deathPose = "pipe";
      Math.abs(bird.velocityX) > PHYSICS.settleSpeedPx ? playPipeBounceSound() : playPipeHitSound();
      return true;
    }

    if (normalX === 1) {
      bird.x = rect.right + bird.size / 2;
      bird.velocityX = Math.abs(bird.velocityX || cmToPx(0.35)) * PHYSICS.sideBounceRestitution;
      bird.velocityY *= 0.92;
      bird.angle = 1.16;
      deathPose = "pipe";
      Math.abs(bird.velocityX) > PHYSICS.settleSpeedPx ? playPipeBounceSound() : playPipeHitSound();
      return true;
    }

    return false;
  }

  function beginEasterEnding() {
    easterEndingReadyToReset = false;
    easterEndingBird = {
      x: width + cmToPx(0.8),
      y: height * 0.18,
      speed: cmToPx(EASTER.endingBirdSpeedCm)
    };
    startEasterEndingMusic();
  }

  function updateEasterEnding(dt) {
    if (state !== "easter_end" || !easterEndingBird) return;
    easterEndingBird.x -= easterEndingBird.speed * dt;
    if (easterEndingBird.x < width * EASTER.endingSkipThresholdRatio) {
      easterEndingReadyToReset = true;
    }
  }

  function updateClouds(dt, sceneSpeedPxPerSec) {
    if (state !== "playing") return;
    if (worldFrozenForExit) return;

    for (const cloud of clouds) {
      cloud.x -= sceneSpeedPxPerSec * cloud.speedFactor * dt * (reverseMode ? -1 : 1);

      if (cloud.x + cloud.size * 2 < -40) {
        cloud.x = width + Math.random() * 100;
        cloud.y = height * (0.08 + Math.random() * 0.28);
      } else if (cloud.x - cloud.size * 2 > width + 40) {
        cloud.x = -Math.random() * 100;
        cloud.y = height * (0.08 + Math.random() * 0.28);
      }
    }
  }

  function updatePipes(dt, sceneSpeedPxPerSec) {
    if (state !== "playing") return;

    const previousWorldOffset = worldOffsetPx;
    const birdLine = bird.x;

    if (reverseMode) {
      if (!worldFrozenForExit) {
        const reverseWorldDelta = cmToPx(EASTER.reverseFlightSpeedCm) * dt;
        worldOffsetPx -= reverseWorldDelta;

        if (worldOffsetPx <= EASTER.reverseReturnThresholdPx) {
          worldOffsetPx = 0;
          worldFrozenForExit = true;
        }
      } else {
        bird.x -= cmToPx(EASTER.offscreenFlightSpeedCm) * dt;
        if (bird.x + bird.size / 2 < 0) {
          state = "easter_end";
          beginEasterEnding();
        }
      }
    } else {
      const moveX = sceneSpeedPxPerSec * dt;
      worldOffsetPx += moveX;
    }

    if (!reverseMode) {
      for (const pipe of pipes) {
        const prevLine = pipe.worldX - previousWorldOffset + pipe.width;
        const currLine = pipe.worldX - worldOffsetPx + pipe.width;

        if (!pipe.scoredForward && prevLine >= birdLine && currLine < birdLine) {
          pipe.scoredForward = true;
          score += 1;
          if (score > highScore) {
            highScore = score;
            localStorage.setItem("flappy_high_score", String(highScore));
          }
        }
      }
    } else {
      for (const pipe of pipes) {
        const prevLine = pipe.worldX - previousWorldOffset + pipe.width;
        const currLine = pipe.worldX - worldOffsetPx + pipe.width;

        if (prevLine <= birdLine && currLine > birdLine) {
          score = Math.max(0, score - 1);
        }
      }
    }

    while (
      pipes.length &&
      !reverseMode &&
      pipes[0].worldX + pipes[0].width < worldOffsetPx - 10
    ) {
      pipes.shift();
    }

    if (!reverseMode) ensurePipesFilled();
  }

  function updateGround(dt, sceneSpeedPxPerSec) {
    if (state !== "playing") return;
    if (worldFrozenForExit) return;

    if (!reverseMode) groundOffsetPx -= sceneSpeedPxPerSec * dt;
    else groundOffsetPx += cmToPx(EASTER.reverseFlightSpeedCm) * dt;

    const grassStripe = cmToPx(0.18);
    while (groundOffsetPx <= -grassStripe) groundOffsetPx += grassStripe;
    while (groundOffsetPx >= grassStripe) groundOffsetPx -= grassStripe;
  }

  function checkCollisions() {
    if (state !== "playing") return;

    const birdBox = getBirdBoxAt(bird.x, bird.y);
    const groundTop = height - cmToPx(CM.groundHeight);

    if (birdBox.bottom >= groundTop) {
      bird.y = groundTop - bird.size / 2;
      return gameOver();
    }

    if (birdBox.top <= 0) {
      bird.y = bird.size / 2;
      bird.velocityY = Math.max(0, bird.velocityY);
    }

    for (const pipe of pipes) {
      const pipeLeft = getPipeScreenX(pipe);
      const pipeRight = pipeLeft + pipe.width;
      const gapTop = pipe.gapTop;
      const gapBottom = pipe.gapTop + pipe.gapHeight;

      const overlapsX = birdBox.right > pipeLeft && birdBox.left < pipeRight;
      const hitsTopPipe = birdBox.top < gapTop;
      const hitsBottomPipe = birdBox.bottom > gapBottom;

      if (overlapsX && (hitsTopPipe || hitsBottomPipe)) {
        return gameOver();
      }
    }
  }

  function gameOver() {
    if (state === "gameover" || state === "easter_end" || state === "drill_end") return;

    state = "gameover";
    birdSettledAfterDeath = false;
    deathPose = "none";
    bird.embedDepth = 0;

    const impactX = clamp((bird.angle - 0.2) * cmToPx(0.22), -cmToPx(0.55), cmToPx(0.55));
    bird.velocityX = impactX;
    bird.velocityY = Math.max(bird.velocityY, cmToPx(0.8));
    playGameOverSound();
  }

  function updateCamera(dt) {
    if (cameraShakeTime > 0) {
      cameraShakeTime = Math.max(0, cameraShakeTime - dt);
      if (cameraShakeTime === 0) {
        cameraShakeStrength = 0;
      }
    }
  }

  function update(dt) {
    const sceneSpeedCmPerSec = getSceneSpeedCmPerSec(elapsedGameTime, score);
    const sceneSpeedPxPerSec = cmToPx(sceneSpeedCmPerSec);

    updateCamera(dt);

    if (state === "playing" && !reverseMode) {
      elapsedGameTime += dt;
    }

    if (state === "easter_end") {
      updateEasterEnding(dt);
      return;
    }

    updateBird(dt);
    updateParticles(dt);

    if (state === "drill_end") {
      return;
    }

    if (state === "playing") {
      updateClouds(dt, sceneSpeedPxPerSec);
      updatePipes(dt, sceneSpeedPxPerSec);
      updateGround(dt, sceneSpeedPxPerSec);
      if (state === "playing") {
        checkCollisions();
      }
    }
  }

  function drawSky() {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, COLORS.skyGradient);
    gradient.addColorStop(1, COLORS.skyMain);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function drawCloud(cloud) {
    const x = cloud.x;
    const y = cloud.y;
    const r = cloud.size * 0.32;

    ctx.fillStyle = COLORS.cloudShadow;
    ctx.beginPath();
    ctx.arc(x + r * 1.1, y + r * 1.4, r * 1.2, 0, Math.PI * 2);
    ctx.arc(x + r * 2.1, y + r * 1.1, r * 1.5, 0, Math.PI * 2);
    ctx.arc(x + r * 3.2, y + r * 1.5, r * 1.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLORS.cloud;
    ctx.beginPath();
    ctx.arc(x, y + r * 0.8, r * 1.2, 0, Math.PI * 2);
    ctx.arc(x + r * 1.2, y + r * 0.3, r * 1.55, 0, Math.PI * 2);
    ctx.arc(x + r * 2.5, y + r * 0.9, r * 1.25, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawClouds() {
    for (const cloud of clouds) drawCloud(cloud);
  }

  function drawPipe(pipe) {
    const x = getPipeScreenX(pipe);
    const groundTop = height - cmToPx(CM.groundHeight);
    const capHeight = cmToPx(0.08);
    const capOverhang = cmToPx(0.04);

    drawPipeSegment(x, 0, pipe.width, pipe.gapTop);
    drawPipeSegment(
      x,
      pipe.gapTop + pipe.gapHeight,
      pipe.width,
      groundTop - (pipe.gapTop + pipe.gapHeight)
    );

    ctx.fillStyle = COLORS.pipeDark;
    ctx.fillRect(x - capOverhang, pipe.gapTop - capHeight, pipe.width + capOverhang * 2, capHeight);
    ctx.fillRect(x - capOverhang, pipe.gapTop + pipe.gapHeight, pipe.width + capOverhang * 2, capHeight);

    ctx.fillStyle = COLORS.pipeHighlight;
    ctx.fillRect(x - capOverhang, pipe.gapTop - capHeight, pipe.width * 0.25, capHeight);
    ctx.fillRect(x - capOverhang, pipe.gapTop + pipe.gapHeight, pipe.width * 0.25, capHeight);
  }

  function drawPipeSegment(x, y, w, h) {
    ctx.fillStyle = COLORS.pipeMain;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = COLORS.pipeHighlight;
    ctx.fillRect(x + w * 0.08, y, w * 0.18, h);
    ctx.fillStyle = COLORS.pipeDark;
    ctx.fillRect(x + w * 0.8, y, w * 0.2, h);
  }

  function drawPipes() {
    for (const pipe of pipes) {
      const x = getPipeScreenX(pipe);
      if (x + pipe.width < -120 || x > width + 120) continue;
      drawPipe(pipe);
    }
  }

  function drawGround() {
    const groundHeight = cmToPx(CM.groundHeight);
    const groundTop = height - groundHeight;
    const grassHeight = groundHeight * 0.22;
    const stripeWidth = cmToPx(0.18);

    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(0, groundTop, width, grassHeight);

    ctx.fillStyle = COLORS.groundSoil;
    ctx.fillRect(0, groundTop + grassHeight, width, groundHeight - grassHeight);

    ctx.fillStyle = COLORS.groundShadow;
    ctx.fillRect(
      0,
      groundTop + grassHeight + (groundHeight - grassHeight) * 0.58,
      width,
      (groundHeight - grassHeight) * 0.42
    );

    for (let x = groundOffsetPx - stripeWidth; x < width + stripeWidth; x += stripeWidth) {
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(x, groundTop, stripeWidth * 0.45, grassHeight * 0.28);

      ctx.fillStyle = "rgba(0,0,0,0.10)";
      ctx.fillRect(x + stripeWidth * 0.5, groundTop + grassHeight, stripeWidth * 0.45, groundHeight * 0.25);
    }
  }

  function drawDrillGroundHole() {
    if (state !== "drill_end") return;

    const groundTop = height - cmToPx(CM.groundHeight);
    const holeW = bird.size * 1.05;
    const holeDepth = Math.min(drillDepth, cmToPx(1.2));

    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(bird.x, groundTop + cmToPx(0.03), holeW * 0.58, holeW * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#7b5d0f";
    ctx.fillRect(bird.x - holeW * 0.46, groundTop + cmToPx(0.02), holeW * 0.92, holeDepth);

    for (const mound of dirtMounds) {
      const moundX = bird.x + mound.side * mound.offset;
      ctx.fillStyle = COLORS.groundSoil;
      ctx.beginPath();
      ctx.ellipse(moundX, groundTop - mound.height * 0.18, mound.width, mound.height, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBirdSprite(x, y, size, angle, mirrored, withFace = true) {
    const beakLength = size * 0.5;
    const beakWidth = size * 0.125;
    const wingLength = size * 0.5;
    const wingWidth = size * 0.125;
    const wingAngle = Math.sin(performance.now() * 0.012) * 0.35;

    ctx.save();
    ctx.translate(x, y);
    if (mirrored) ctx.scale(-1, 1);
    ctx.rotate(angle);

    ctx.fillStyle = COLORS.birdShadow;
    ctx.fillRect(-size / 2 + size * 0.08, -size / 2 + size * 0.08, size, size);

    ctx.fillStyle = COLORS.birdBody;
    ctx.fillRect(-size / 2, -size / 2, size, size);

    ctx.save();
    ctx.translate(-size * 0.05, 0);
    ctx.rotate(wingAngle);
    ctx.fillStyle = COLORS.wing;
    ctx.fillRect(-wingLength * 0.55, -wingWidth / 2, wingLength, wingWidth);
    ctx.restore();

    if (withFace) {
      ctx.fillStyle = "#111111";
      ctx.beginPath();
      ctx.arc(size * 0.14, -size * 0.1, size * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = COLORS.beakShadow;
    ctx.beginPath();
    ctx.moveTo(size / 2, -beakWidth / 2 + beakWidth * 0.35);
    ctx.lineTo(size / 2 + beakLength, 0 + beakWidth * 0.35);
    ctx.lineTo(size / 2, beakWidth / 2 + beakWidth * 0.35);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = COLORS.beak;
    ctx.beginPath();
    ctx.moveTo(size / 2, -beakWidth / 2);
    ctx.lineTo(size / 2 + beakLength, 0);
    ctx.lineTo(size / 2, beakWidth / 2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawDrillBird() {
    const size = bird.size;
    drawBirdSprite(bird.x, bird.y, size, Math.PI / 2, false, true);

    const drillRadius = size * 0.5;
    const drillHeight = size * 0.78;

    ctx.save();
    ctx.translate(bird.x, bird.y + size * 0.5);
    ctx.rotate(drillRotation);

    ctx.fillStyle = "#D8D8D8";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-drillRadius * 0.5, drillHeight);
    ctx.lineTo(drillRadius * 0.5, drillHeight);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#8A8A8A";
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const yy = (drillHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(-drillRadius * 0.35, yy + 2);
      ctx.lineTo(drillRadius * 0.25, yy + drillHeight / 5);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawBird() {
    if (state === "drill_end") {
      drawDrillBird();
      return;
    }
    if (state === "easter_end") return;
    drawBirdSprite(bird.x, bird.y, bird.size, bird.angle, reverseMode && state === "playing", true);
  }

  function drawParticles() {
    for (const p of dirtParticles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawScore() {
    if (state === "easter_end" || state === "drill_end") return;

    const fontSize = Math.max(26, Math.floor(height * 0.05));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `bold ${fontSize}px Arial`;

    ctx.fillStyle = COLORS.textShadow;
    ctx.fillText(String(score), width / 2 + 2, 20 + 2);

    ctx.fillStyle = COLORS.text;
    ctx.fillText(String(score), width / 2, 20);

    const smallFont = Math.max(16, Math.floor(height * 0.023));
    ctx.font = `bold ${smallFont}px Arial`;
    ctx.textAlign = "left";

    const hsText = `Best: ${highScore}`;
    ctx.fillStyle = COLORS.textShadow;
    ctx.fillText(hsText, 18 + 1, 18 + 1);

    ctx.fillStyle = COLORS.text;
    ctx.fillText(hsText, 18, 18);
  }

  function drawSoundButton() {
    const rect = getSoundButtonRect();

    ctx.fillStyle = soundEnabled ? COLORS.buttonOnGlow : COLORS.buttonBg;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    ctx.strokeStyle = COLORS.buttonBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    const cx = rect.x + rect.w * 0.48;
    const cy = rect.y + rect.h * 0.5;
    const s = rect.w * 0.38;

    ctx.strokeStyle = "#FFFFFF";
    ctx.fillStyle = "#FFFFFF";
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(cx - s * 0.55, cy - s * 0.18);
    ctx.lineTo(cx - s * 0.28, cy - s * 0.18);
    ctx.lineTo(cx - s * 0.02, cy - s * 0.42);
    ctx.lineTo(cx - s * 0.02, cy + s * 0.42);
    ctx.lineTo(cx - s * 0.28, cy + s * 0.18);
    ctx.lineTo(cx - s * 0.55, cy + s * 0.18);
    ctx.closePath();
    ctx.fill();

    if (soundEnabled) {
      ctx.beginPath();
      ctx.arc(cx + s * 0.02, cy, s * 0.34, -0.75, 0.75);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx + s * 0.08, cy, s * 0.56, -0.75, 0.75);
      ctx.stroke();
    } else {
      ctx.strokeStyle = COLORS.buttonOff;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(rect.x + rect.w * 0.22, rect.y + rect.h * 0.22);
      ctx.lineTo(rect.x + rect.w * 0.78, rect.y + rect.h * 0.78);
      ctx.stroke();
    }
  }

  function drawWhiteClothFlagBehindBird(x, y, scaleSize) {
    const ropeLen = scaleSize * 0.75;
    const clothW = scaleSize * 1.35;
    const clothH = scaleSize * 0.78;

    const t = performance.now() * 0.006;
    const wave1 = Math.sin(t) * clothH * 0.10;
    const wave2 = Math.cos(t * 1.3) * clothH * 0.07;

    ctx.save();
    ctx.translate(x, y);

    ctx.strokeStyle = "#444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-ropeLen, 0);
    ctx.stroke();

    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.moveTo(-ropeLen, -clothH * 0.5);
    ctx.bezierCurveTo(
      -ropeLen - clothW * 0.18, -clothH * 0.75 + wave1,
      -ropeLen - clothW * 0.46, -clothH * 0.12 + wave2,
      -ropeLen - clothW * 0.72, -clothH * 0.36 + wave1
    );
    ctx.bezierCurveTo(
      -ropeLen - clothW * 0.90, -clothH * 0.18 + wave2,
      -ropeLen - clothW * 1.02, clothH * 0.12 + wave1,
      -ropeLen - clothW, clothH * 0.18
    );
    ctx.bezierCurveTo(
      -ropeLen - clothW * 0.82, clothH * 0.42 + wave2,
      -ropeLen - clothW * 0.56, clothH * 0.58 + wave1,
      -ropeLen - clothW * 0.34, clothH * 0.32
    );
    ctx.bezierCurveTo(
      -ropeLen - clothW * 0.18, clothH * 0.12,
      -ropeLen - clothW * 0.08, clothH * 0.58 + wave2,
      -ropeLen, clothH * 0.46
    );
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,0.16)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = "#444";
    ctx.font = `bold ${Math.max(12, Math.floor(scaleSize * 0.17))}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("你認真？", -ropeLen - clothW * 0.52, clothH * 0.03);

    ctx.restore();
  }

  function drawEasterEnding() {
    if (!easterEndingBird) return;
    const size = Math.max(34, cmToPx(0.24));

    drawWhiteClothFlagBehindBird(
      easterEndingBird.x - size * 0.5,
      easterEndingBird.y,
      size
    );
    drawBirdSprite(easterEndingBird.x, easterEndingBird.y, size, 0.02, true, true);

    if (easterEndingReadyToReset) {
      ctx.font = `bold ${Math.max(18, Math.floor(height * 0.03))}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = COLORS.textShadow;
      ctx.fillText("點擊畫面重新開始", width / 2 + 2, height * 0.32 + 2);
      ctx.fillStyle = COLORS.text;
      ctx.fillText("點擊畫面重新開始", width / 2, height * 0.32);
    }
  }

  function drawDrillEnding() {
    const elapsed = performance.now() / 1000 - drillStartTime;
    ctx.font = `bold ${Math.max(18, Math.floor(height * 0.03))}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    if (elapsed >= EASTER.drillLockSeconds) {
      ctx.fillStyle = COLORS.textShadow;
      ctx.fillText("點擊畫面重新開始", width / 2 + 2, height * 0.18 + 2);
      ctx.fillStyle = COLORS.text;
      ctx.fillText("點擊畫面重新開始", width / 2, height * 0.18);
    } else {
      const remain = Math.ceil(EASTER.drillLockSeconds - elapsed);
      ctx.fillStyle = COLORS.textShadow;
      ctx.fillText(`請先看牠挖 ${remain}`, width / 2 + 2, height * 0.18 + 2);
      ctx.fillStyle = COLORS.text;
      ctx.fillText(`請先看牠挖 ${remain}`, width / 2, height * 0.18);
    }
  }

  function drawCenterMessage(title, subtitle) {
    ctx.fillStyle = COLORS.overlay;
    ctx.fillRect(0, 0, width, height);

    const panelWidth = Math.min(width * 0.8, 420);
    const panelHeight = Math.min(height * 0.28, 220);
    const panelX = (width - panelWidth) / 2;
    const panelY = (height - panelHeight) / 2;

    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(panelX, panelY, panelWidth, panelHeight);

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const titleSize = Math.max(24, Math.floor(height * 0.045));
    const subSize = Math.max(15, Math.floor(height * 0.022));

    ctx.font = `bold ${titleSize}px Arial`;
    ctx.fillStyle = COLORS.text;
    ctx.fillText(title, width / 2, panelY + panelHeight * 0.35);

    ctx.font = `${subSize}px Arial`;
    ctx.fillText(subtitle, width / 2, panelY + panelHeight * 0.62);
  }

  function drawHUDOverlays() {
    if (state === "ready") {
      drawCenterMessage("Flappy Bird", "點擊畫面或按空白鍵開始");
    } else if (state === "gameover") {
      drawCenterMessage(
        "Game Over",
        birdSettledAfterDeath
          ? `分數 ${score} / 最高分 ${highScore}　・　點擊或空白鍵重開`
          : `分數 ${score} / 最高分 ${highScore}`
      );
    } else if (state === "drill_end") {
      drawDrillEnding();
    }
  }

  function draw() {
    ctx.save();

    if (cameraShakeTime > 0) {
      const sx = rand(-cameraShakeStrength, cameraShakeStrength);
      const sy = rand(-cameraShakeStrength, cameraShakeStrength);
      ctx.translate(sx, sy);
    }

    drawSky();
    drawClouds();
    drawPipes();
    drawGround();
    drawDrillGroundHole();

    if (state === "easter_end") {
      drawEasterEnding();
    } else {
      drawBird();
      drawParticles();
      drawScore();
      drawHUDOverlays();
    }

    ctx.restore();
    drawSoundButton();
  }

  function handleTap(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    ensureAudio();

    if (pointInRect(x, y, getSoundButtonRect())) {
      toggleSound();
      return;
    }

    triggerAction();
  }

  function frame(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dt = Math.min((timestamp - lastTime) / 1000, 0.0333);
    lastTime = timestamp;

    update(dt);
    draw();

    requestAnimationFrame(frame);
  }

  function bindEvents() {
    window.addEventListener("resize", resize);

    window.addEventListener("keydown", (event) => {
      if (event.code === "Space") {
        event.preventDefault();
        if (state === "playing") {
          markUserInput();
        }
        triggerAction();
      }
    });

    canvas.addEventListener("mousedown", (event) => {
      pointerTracking = {
        startX: event.clientX,
        startY: event.clientY,
        startTime: performance.now(),
        pointerType: "mouse"
      };
    });

    canvas.addEventListener("mouseup", (event) => {
      if (!pointerTracking || pointerTracking.pointerType !== "mouse") return;

      const dx = event.clientX - pointerTracking.startX;
      const dy = event.clientY - pointerTracking.startY;
      const dt = performance.now() - pointerTracking.startTime;

      if (
        Math.abs(dx) <= EASTER.tapMaxDistance &&
        Math.abs(dy) <= EASTER.tapMaxDistance &&
        dt <= EASTER.tapMaxDurationMs
      ) {
        if (state === "playing") {
          markUserInput();
        }
        handleTap(event.clientX, event.clientY);
      } else {
        registerSwipe(dx, dy);
      }

      pointerTracking = null;
    });

    canvas.addEventListener(
      "touchstart",
      (event) => {
        event.preventDefault();
        const touch = event.changedTouches[0];
        if (!touch) return;

        pointerTracking = {
          startX: touch.clientX,
          startY: touch.clientY,
          startTime: performance.now(),
          touchId: touch.identifier,
          pointerType: "touch"
        };
      },
      { passive: false }
    );

    canvas.addEventListener(
      "touchend",
      (event) => {
        if (!pointerTracking || pointerTracking.pointerType !== "touch") return;

        for (const touch of event.changedTouches) {
          if (touch.identifier !== pointerTracking.touchId) continue;

          const dx = touch.clientX - pointerTracking.startX;
          const dy = touch.clientY - pointerTracking.startY;
          const dt = performance.now() - pointerTracking.startTime;

          if (
            Math.abs(dx) <= EASTER.tapMaxDistance &&
            Math.abs(dy) <= EASTER.tapMaxDistance &&
            dt <= EASTER.tapMaxDurationMs
          ) {
            if (state === "playing") {
              markUserInput();
            }
            handleTap(touch.clientX, touch.clientY);
          } else {
            registerSwipe(dx, dy);
          }

          pointerTracking = null;
          break;
        }
      },
      { passive: false }
    );

    canvas.addEventListener(
      "touchcancel",
      () => {
        pointerTracking = null;
      },
      { passive: false }
    );
  }

  function startBackgroundMusicLoop() {
    if (!audioContext || bgmTimer) return;

    const playChunk = () => {
      if (!audioContext || state === "easter_end" || state === "drill_end") return;

      const now = audioContext.currentTime;
      playMusicNote(now + 0.00, 523.25, 0.32, 0.030);
      playMusicNote(now + 0.36, 659.25, 0.28, 0.028);
      playMusicNote(now + 0.72, 783.99, 0.30, 0.028);
      playMusicNote(now + 1.10, 659.25, 0.28, 0.026);

      playPadNote(now + 0.00, 196.00, 1.40, 0.016);
      playPadNote(now + 1.40, 220.00, 1.40, 0.016);
    };

    playChunk();
    bgmTimer = setInterval(playChunk, 2800);
  }

  function stopAllAudioLoops() {
    if (bgmTimer) {
      clearInterval(bgmTimer);
      bgmTimer = null;
    }

    specialAudioNodes.forEach((node) => {
      try {
        node.stop();
      } catch (_) {}
    });
    specialAudioNodes = [];
  }

  function startEasterEndingMusic() {
    if (!audioContext) return;
    stopAllAudioLoops();

    const playAwkward = () => {
      if (!audioContext || state !== "easter_end") return;
      const start = audioContext.currentTime;

      const notes = [
        { f: 261.63, d: 0.22 },
        { f: 277.18, d: 0.18 },
        { f: 261.63, d: 0.16 },
        { f: 220.00, d: 0.42 },
        { f: 0.00, d: 0.08 },
        { f: 220.00, d: 0.16 },
        { f: 233.08, d: 0.16 },
        { f: 220.00, d: 0.50 }
      ];

      let t = start;
      for (const note of notes) {
        if (note.f > 0) {
          const osc1 = audioContext.createOscillator();
          const osc2 = audioContext.createOscillator();
          const gain = audioContext.createGain();
          const filter = audioContext.createBiquadFilter();

          osc1.type = "triangle";
          osc2.type = "square";
          osc1.frequency.setValueAtTime(note.f, t);
          osc2.frequency.setValueAtTime(note.f * 1.007, t);

          filter.type = "lowpass";
          filter.frequency.setValueAtTime(1200, t);

          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.linearRampToValueAtTime(0.03, t + 0.01);
          gain.gain.linearRampToValueAtTime(0.02, t + note.d * 0.45);
          gain.gain.linearRampToValueAtTime(0.0001, t + note.d);

          osc1.connect(filter);
          osc2.connect(filter);
          filter.connect(gain);
          gain.connect(masterGain);

          osc1.start(t);
          osc2.start(t);
          osc1.stop(t + note.d + 0.02);
          osc2.stop(t + note.d + 0.02);

          specialAudioNodes.push(osc1, osc2);
        }
        t += note.d;
      }
    };

    playAwkward();
    bgmTimer = setInterval(playAwkward, 1600);
  }

  function startDrillMusic() {
    if (!audioContext) return;
    stopAllAudioLoops();

    const playDrill = () => {
      if (!audioContext || state !== "drill_end") return;
      const start = audioContext.currentTime;

      const oscA = audioContext.createOscillator();
      const oscB = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();

      oscA.type = "sawtooth";
      oscB.type = "triangle";
      oscA.frequency.setValueAtTime(110 + Math.sin(start * 15) * 12, start);
      oscB.frequency.setValueAtTime(220 + Math.cos(start * 13) * 18, start);

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(950, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.028, start + 0.01);
      gain.gain.linearRampToValueAtTime(0.0001, start + 0.14);

      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      oscA.start(start);
      oscB.start(start);
      oscA.stop(start + 0.15);
      oscB.stop(start + 0.15);

      specialAudioNodes.push(oscA, oscB);
    };

    playDrill();
    bgmTimer = setInterval(playDrill, 160);
  }

  function playMusicNote(time, freq, duration, volume) {
    if (!audioContext || !masterGain) return;

    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, time);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1600, time);
    filter.Q.value = 0.4;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.04);
    gain.gain.linearRampToValueAtTime(volume * 0.72, time + duration * 0.45);
    gain.gain.linearRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  function playPadNote(time, freq, duration, volume) {
    if (!audioContext || !masterGain) return;

    const oscA = audioContext.createOscillator();
    const oscB = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    oscA.type = "triangle";
    oscB.type = "sine";

    oscA.frequency.setValueAtTime(freq, time);
    oscB.frequency.setValueAtTime(freq * 1.002, time);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, time);
    filter.Q.value = 0.2;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.25);
    gain.gain.linearRampToValueAtTime(volume * 0.8, time + duration * 0.7);
    gain.gain.linearRampToValueAtTime(0.0001, time + duration);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    oscA.start(time);
    oscB.start(time);
    oscA.stop(time + duration + 0.05);
    oscB.stop(time + duration + 0.05);
  }

  function playFlapSound() {
    if (!audioContext || !masterGain || !soundEnabled) return;

    const now = audioContext.currentTime;
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    osc1.type = "sine";
    osc2.type = "triangle";
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.exponentialRampToValueAtTime(660, now + 0.10);
    osc2.frequency.setValueAtTime(1320, now);
    osc2.frequency.exponentialRampToValueAtTime(920, now + 0.10);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2200, now);
    filter.Q.value = 0.8;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.055, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.18);
    osc2.stop(now + 0.18);
  }

  function playGameOverSound() {
    if (!audioContext || !masterGain || !soundEnabled) return;

    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.35);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1200, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.40);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.42);
  }

  function playGroundThudSound() {
    if (!audioContext || !masterGain || !soundEnabled) return;

    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const noise = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    const noiseGain = audioContext.createGain();
    const lp = audioContext.createBiquadFilter();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(92, now + 0.18);

    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 0.18, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
    noise.buffer = buffer;

    lp.type = "lowpass";
    lp.frequency.setValueAtTime(520, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.linearRampToValueAtTime(0.05, now + 0.005);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc.connect(lp);
    noise.connect(noiseGain);
    lp.connect(gain);
    gain.connect(masterGain);
    noiseGain.connect(masterGain);

    osc.start(now);
    noise.start(now);
    osc.stop(now + 0.24);
    noise.stop(now + 0.18);
  }

  function playGroundBounceSound() {
    if (!audioContext || !masterGain || !soundEnabled) return;

    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    osc.type = "sine";
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(135, now + 0.14);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(950, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.055, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.20);
  }

  function playPipeHitSound() {
    if (!audioContext || !masterGain || !soundEnabled) return;

    const now = audioContext.currentTime;
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const hp = audioContext.createBiquadFilter();

    osc1.type = "triangle";
    osc2.type = "sine";
    osc1.frequency.setValueAtTime(760, now);
    osc2.frequency.setValueAtTime(1180, now);

    hp.type = "highpass";
    hp.frequency.setValueAtTime(320, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

    osc1.connect(hp);
    osc2.connect(hp);
    hp.connect(gain);
    gain.connect(masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.12);
    osc2.stop(now + 0.12);
  }

  function playPipeBounceSound() {
    if (!audioContext || !masterGain || !soundEnabled) return;

    const now = audioContext.currentTime;
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc1.type = "sine";
    osc2.type = "triangle";
    osc1.frequency.setValueAtTime(620, now);
    osc1.frequency.exponentialRampToValueAtTime(420, now + 0.12);
    osc2.frequency.setValueAtTime(930, now);
    osc2.frequency.exponentialRampToValueAtTime(660, now + 0.10);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.045, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.17);
    osc2.stop(now + 0.17);
  }

  bindEvents();
  resize();
  requestAnimationFrame(frame);
})();
