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
    buttonOff: "rgba(255,120,120,0.9)",
    buttonOnGlow: "rgba(255,255,255,0.22)"
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

  let width = 0;
  let height = 0;
  let scale = 0;

  let state = "ready";
  let lastTime = 0;
  let elapsedGameTime = 0;

  let highScore = Number(localStorage.getItem("flappy_high_score") || 0);
  let score = 0;

  let bird = null;
  let pipes = [];
  let clouds = [];
  let groundOffsetPx = 0;
  let dirtParticles = [];

  let birdSettledAfterDeath = false;
  let deathPose = "none";
  let soundEnabled = true;

  let audioContext = null;
  let masterGain = null;
  let bgmStarted = false;
  let nextMusicTime = 0;
  let musicSchedulerLookAhead = null;

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
    const previousState = state;
    const previousHighScore = highScore;

    bird = createBird();
    pipes = [];
    clouds = createClouds();
    dirtParticles = [];
    groundOffsetPx = 0;
    score = 0;
    elapsedGameTime = 0;
    birdSettledAfterDeath = false;
    deathPose = "none";
    highScore = previousHighScore;
    state = previousState === "gameover" ? "ready" : previousState;

    createInitialPipes();
  }

  function resetGame() {
    state = "ready";
    bird = createBird();
    pipes = [];
    dirtParticles = [];
    score = 0;
    elapsedGameTime = 0;
    groundOffsetPx = 0;
    birdSettledAfterDeath = false;
    deathPose = "none";
    createInitialPipes();
  }

  function createBird() {
    const size = cmToPx(CM.birdSize);
    const x = width * CM.birdXRatio;
    const y = height * 0.40;

    return {
      x,
      y,
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
    const firstX = width + cmToPx(0.8);
    pipes.push(createPipe(firstX));
    ensurePipesFilled();
  }

  function getPipeSpacingCm(currentScore) {
    if (currentScore <= 20) {
      const t = smoothstep01(currentScore / 20);
      return lerp(CM.minPipeSpacing, CM.midPipeSpacing, t);
    }

    if (currentScore <= 30) {
      const t = smoothstep01((currentScore - 20) / 10);
      return lerp(CM.midPipeSpacing, CM.maxPipeSpacing, t);
    }

    const extra = 1 - Math.exp(-(currentScore - 30) / 25);
    return lerp(CM.maxPipeSpacing, CM.maxPipeSpacing + 0.45, extra);
  }

  function getSceneSpeedCmPerSec(timeSec, currentScore) {
    const byTime = CM.initialSceneSpeed + CM.accelerationPerSecond * timeSec;
    const byScoreBonus = Math.min(currentScore * 0.008, 0.25);
    return clamp(byTime + byScoreBonus, CM.initialSceneSpeed, CM.maxSceneSpeed);
  }

  function createPipe(startX) {
    const gapHeight = cmToPx(CM.pipeGapHeight);
    const pipeWidth = cmToPx(CM.pipeWidth);
    const groundHeight = cmToPx(CM.groundHeight);

    const minTop = height * 0.12;
    const maxTop = height - groundHeight - gapHeight - height * 0.18;
    const gapTop = lerp(minTop, maxTop, Math.random());

    return {
      x: startX,
      width: pipeWidth,
      gapTop,
      gapHeight,
      scored: false
    };
  }

  function ensurePipesFilled() {
    const pipeWidthPx = cmToPx(CM.pipeWidth);
    const spacingPx = cmToPx(getPipeSpacingCm(score));
    const minRightEdge = width + spacingPx + pipeWidthPx;

    if (pipes.length === 0) {
      pipes.push(createPipe(width + cmToPx(0.8)));
    }

    while (pipes.length < 4 || pipes[pipes.length - 1].x < minRightEdge) {
      const lastPipe = pipes[pipes.length - 1];
      const nextX = lastPipe.x + pipeWidthPx + spacingPx;
      pipes.push(createPipe(nextX));
    }
  }

  function startPlayingIfNeeded() {
    if (state === "ready") {
      state = "playing";
      flapBird();
    }
  }

  function flapBird() {
    if (state === "gameover") return;
    bird.velocityY = cmToPx(CM.jumpImpulse);
    playFlapSound();
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

  function getPointerPos(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    ensureAudio();
    updateMasterGain();
  }

  function triggerAction() {
    ensureAudio();

    if (state === "ready") {
      startPlayingIfNeeded();
      return;
    }

    if (state === "playing") {
      flapBird();
      return;
    }

    if (state === "gameover") {
      resetGame();
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

  function spawnDirtBurst(x, y, strength, embed = false) {
    const count = embed ? 34 : 24;
    const baseSpeed = embed ? 1.65 : 1.15;

    for (let i = 0; i < count; i++) {
      const angle = rand(-Math.PI * 0.98, -Math.PI * 0.02);
      const speed = cmToPx(baseSpeed * rand(0.55, 1.25) * Math.max(0.75, strength));
      dirtParticles.push({
        x,
        y,
        vx: Math.cos(angle) * speed * rand(0.8, 1.35),
        vy: Math.sin(angle) * speed * rand(0.8, 1.35),
        life: rand(0.42, 0.78),
        maxLife: rand(0.42, 0.78),
        size: rand(cmToPx(0.02), cmToPx(0.05)),
        color: [
          COLORS.groundSoil,
          COLORS.groundShadow,
          "#E0B84D",
          "#B8860B"
        ][Math.floor(Math.random() * 4)]
      });
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
        p.vx *= 0.76;
        p.vy *= -0.16;
      }
    }
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
      bird.angle = lerp(-0.6, 1.2, (t + 1) / 2);
      return;
    }

    if (state === "gameover") {
      bird.wingTimer += dt * 0.25;

      if (birdSettledAfterDeath) {
        bird.velocityX = 0;
        bird.velocityY = 0;
        if (deathPose === "embed") {
          bird.angle = lerp(bird.angle, 1.35, 0.18);
        } else if (deathPose === "pipe") {
          bird.angle = lerp(bird.angle, 1.18, 0.18);
        } else {
          bird.angle = lerp(bird.angle, 1.0, 0.18);
        }
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

      resolveDeathScoreCrossings(prevX, bird.x);
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
    }
  }

  function resolveDeathScoreCrossings(prevX, currentX) {
    if (prevX === currentX) return;

    for (const pipe of pipes) {
      const lineX = pipe.x + pipe.width;

      if (prevX <= lineX && currentX > lineX) {
        score += 1;
        if (score > highScore) {
          highScore = score;
          localStorage.setItem("flappy_high_score", String(highScore));
        }
      } else if (prevX >= lineX && currentX < lineX) {
        score = Math.max(0, score - 1);
      }
    }
  }

  function isBirdRestingOnSurface() {
    const box = getBirdBoxAt(bird.x, bird.y);
    const groundTop = height - cmToPx(CM.groundHeight);

    if (Math.abs(box.bottom - groundTop) < 1.5) return true;

    for (const pipe of pipes) {
      const topRect = {
        left: pipe.x,
        right: pipe.x + pipe.width,
        top: 0,
        bottom: pipe.gapTop
      };

      const bottomRect = {
        left: pipe.x,
        right: pipe.x + pipe.width,
        top: pipe.gapTop + pipe.gapHeight,
        bottom: groundTop
      };

      if (
        box.right > topRect.left &&
        box.left < topRect.right &&
        Math.abs(box.top - topRect.bottom) < 1.5
      ) {
        return true;
      }

      if (
        box.right > bottomRect.left &&
        box.left < bottomRect.right &&
        Math.abs(box.bottom - bottomRect.top) < 1.5
      ) {
        return true;
      }
    }

    return false;
  }

  function resolveDeathCollision(prevX, prevY, groundTop) {
    for (let i = 0; i < 4; i++) {
      const prevBox = getBirdBoxAt(prevX, prevY);
      const box = getBirdBoxAt(bird.x, bird.y);

      if (box.bottom >= groundTop) {
        resolveGroundImpact(box, groundTop);
        if (birdSettledAfterDeath) return;
      }

      let collided = false;

      for (const pipe of pipes) {
        const topRect = {
          left: pipe.x,
          right: pipe.x + pipe.width,
          top: 0,
          bottom: pipe.gapTop
        };

        const bottomRect = {
          left: pipe.x,
          right: pipe.x + pipe.width,
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

  function resolveGroundImpact(box, groundTop) {
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

    if (cameFromTop) {
      normalY = -1;
    } else if (cameFromBottom) {
      normalY = 1;
    } else if (cameFromLeft) {
      normalX = -1;
    } else if (cameFromRight) {
      normalX = 1;
    } else {
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
      if (Math.abs(bird.velocityY) > PHYSICS.settleVerticalPx) {
        playPipeBounceSound();
      } else {
        playPipeHitSound();
      }
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
      if (Math.abs(bird.velocityX) > PHYSICS.settleSpeedPx) {
        playPipeBounceSound();
      } else {
        playPipeHitSound();
      }
      return true;
    }

    if (normalX === 1) {
      bird.x = rect.right + bird.size / 2;
      bird.velocityX = Math.abs(bird.velocityX || cmToPx(0.35)) * PHYSICS.sideBounceRestitution;
      bird.velocityY *= 0.92;
      bird.angle = 1.16;
      deathPose = "pipe";
      if (Math.abs(bird.velocityX) > PHYSICS.settleSpeedPx) {
        playPipeBounceSound();
      } else {
        playPipeHitSound();
      }
      return true;
    }

    return false;
  }

  function updateClouds(dt, sceneSpeedPxPerSec) {
    if (state !== "playing") return;

    for (const cloud of clouds) {
      cloud.x -= sceneSpeedPxPerSec * cloud.speedFactor * dt;

      if (cloud.x + cloud.size * 2 < 0) {
        cloud.x = width + Math.random() * 100;
        cloud.y = height * (0.08 + Math.random() * 0.28);
      }
    }
  }

  function updatePipes(dt, sceneSpeedPxPerSec) {
    if (state !== "playing") return;

    const moveX = sceneSpeedPxPerSec * dt;

    for (const pipe of pipes) {
      pipe.x -= moveX;

      if (!pipe.scored && bird.x > pipe.x + pipe.width) {
        pipe.scored = true;
        score += 1;

        if (score > highScore) {
          highScore = score;
          localStorage.setItem("flappy_high_score", String(highScore));
        }
      }
    }

    while (pipes.length && pipes[0].x + pipes[0].width < -10) {
      pipes.shift();
    }

    ensurePipesFilled();
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
      const pipeLeft = pipe.x;
      const pipeRight = pipe.x + pipe.width;
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
    if (state === "gameover") return;

    state = "gameover";
    birdSettledAfterDeath = false;
    deathPose = "none";
    bird.embedDepth = 0;

    const impactX = clamp((bird.angle - 0.2) * cmToPx(0.22), -cmToPx(0.55), cmToPx(0.55));
    bird.velocityX = impactX;
    bird.velocityY = Math.max(bird.velocityY, cmToPx(0.8));
    playGameOverSound();
  }

  function updateGround(dt, sceneSpeedPxPerSec) {
    if (state !== "playing") return;

    groundOffsetPx -= sceneSpeedPxPerSec * dt;
    const grassStripe = cmToPx(0.18);
    if (groundOffsetPx <= -grassStripe) {
      groundOffsetPx += grassStripe;
    }
  }

  function update(dt) {
    const sceneSpeedCmPerSec = getSceneSpeedCmPerSec(elapsedGameTime, score);
    const sceneSpeedPxPerSec = cmToPx(sceneSpeedCmPerSec);

    if (state === "playing") {
      elapsedGameTime += dt;
    }

    updateBird(dt);
    updateParticles(dt);

    if (state === "playing") {
      updateClouds(dt, sceneSpeedPxPerSec);
      updatePipes(dt, sceneSpeedPxPerSec);
      updateGround(dt, sceneSpeedPxPerSec);
      checkCollisions();
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
    for (const cloud of clouds) {
      drawCloud(cloud);
    }
  }

  function drawPipe(pipe) {
    const groundTop = height - cmToPx(CM.groundHeight);
    const capHeight = cmToPx(0.08);
    const capOverhang = cmToPx(0.04);

    drawPipeSegment(pipe.x, 0, pipe.width, pipe.gapTop);
    drawPipeSegment(
      pipe.x,
      pipe.gapTop + pipe.gapHeight,
      pipe.width,
      groundTop - (pipe.gapTop + pipe.gapHeight)
    );

    ctx.fillStyle = COLORS.pipeDark;
    ctx.fillRect(
      pipe.x - capOverhang,
      pipe.gapTop - capHeight,
      pipe.width + capOverhang * 2,
      capHeight
    );
    ctx.fillRect(
      pipe.x - capOverhang,
      pipe.gapTop + pipe.gapHeight,
      pipe.width + capOverhang * 2,
      capHeight
    );

    ctx.fillStyle = COLORS.pipeHighlight;
    ctx.fillRect(
      pipe.x - capOverhang,
      pipe.gapTop - capHeight,
      pipe.width * 0.25,
      capHeight
    );
    ctx.fillRect(
      pipe.x - capOverhang,
      pipe.gapTop + pipe.gapHeight,
      pipe.width * 0.25,
      capHeight
    );
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
      ctx.fillRect(
        x + stripeWidth * 0.5,
        groundTop + grassHeight,
        stripeWidth * 0.45,
        groundHeight * 0.25
      );
    }
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

  function drawBird() {
    const bodySize = bird.size;
    const x = bird.x;
    const y = bird.y;

    const beakLength = cmToPx(CM.birdBeakLength);
    const beakWidth = cmToPx(CM.birdBeakWidth);
    const wingLength = cmToPx(CM.birdWingLength);
    const wingWidth = cmToPx(CM.birdWingWidth);

    const wingRate = bird.velocityY < 0 ? 8 : 6;
    const wingAmplitude = bird.velocityY < 0 ? 0.75 : 0.45;
    const wingAngle = Math.sin(bird.wingTimer * wingRate * Math.PI * 2) * wingAmplitude;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bird.angle);

    ctx.fillStyle = COLORS.birdShadow;
    ctx.fillRect(
      -bodySize / 2 + bodySize * 0.08,
      -bodySize / 2 + bodySize * 0.08,
      bodySize,
      bodySize
    );

    ctx.fillStyle = COLORS.birdBody;
    ctx.fillRect(-bodySize / 2, -bodySize / 2, bodySize, bodySize);

    ctx.save();
    ctx.translate(-bodySize * 0.05, 0);
    ctx.rotate(wingAngle);
    ctx.fillStyle = COLORS.wing;
    ctx.fillRect(-wingLength * 0.55, -wingWidth / 2, wingLength, wingWidth);
    ctx.restore();

    ctx.fillStyle = "#111111";
    ctx.beginPath();
    ctx.arc(bodySize * 0.14, -bodySize * 0.1, bodySize * 0.06, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLORS.beakShadow;
    ctx.beginPath();
    ctx.moveTo(bodySize / 2, -beakWidth / 2 + beakWidth * 0.35);
    ctx.lineTo(bodySize / 2 + beakLength, 0 + beakWidth * 0.35);
    ctx.lineTo(bodySize / 2, beakWidth / 2 + beakWidth * 0.35);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = COLORS.beak;
    ctx.beginPath();
    ctx.moveTo(bodySize / 2, -beakWidth / 2);
    ctx.lineTo(bodySize / 2 + beakLength, 0);
    ctx.lineTo(bodySize / 2, beakWidth / 2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawScore() {
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
        `分數 ${score} / 最高分 ${highScore}　・　點擊或空白鍵重開`
      );
    }
  }

  function draw() {
    drawSky();
    drawClouds();
    drawPipes();
    drawGround();
    drawParticles();
    drawBird();
    drawScore();
    drawSoundButton();
    drawHUDOverlays();
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
        triggerAction();
      }
    });

    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      ensureAudio();

      const pos = getPointerPos(event);
      if (pointInRect(pos.x, pos.y, getSoundButtonRect())) {
        toggleSound();
        return;
      }

      triggerAction();
    });

    window.addEventListener("keydown", ensureAudio);
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

    if (!bgmStarted) {
      startBackgroundMusic();
      bgmStarted = true;
    }

    updateMasterGain();
  }

  function updateMasterGain() {
    if (!masterGain || !audioContext) return;
    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(soundEnabled ? 0.18 : 0.0001, now + 0.03);
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

  function scheduleMusicChunk() {
    if (!audioContext) return;

    const bpm = 84;
    const beat = 60 / bpm;
    const bar = beat * 4;

    const melody = [
      523.25, 659.25, 783.99, 659.25,
      493.88, 587.33, 659.25, 587.33
    ];

    const bass = [
      196.0, 220.0, 174.61, 196.0
    ];

    const start = nextMusicTime;

    for (let i = 0; i < melody.length; i++) {
      const noteTime = start + i * beat * 0.5;
      playMusicNote(noteTime, melody[i], beat * 0.42, 0.030);
    }

    for (let i = 0; i < bass.length; i++) {
      const noteTime = start + i * beat;
      playPadNote(noteTime, bass[i], beat * 1.6, 0.018);
    }

    nextMusicTime += bar;
  }

  function startBackgroundMusic() {
    if (!audioContext) return;

    nextMusicTime = audioContext.currentTime + 0.08;
    scheduleMusicChunk();
    scheduleMusicChunk();

    musicSchedulerLookAhead = setInterval(() => {
      if (!audioContext) return;
      while (nextMusicTime < audioContext.currentTime + 1.2) {
        scheduleMusicChunk();
      }
    }, 300);
  }

  bindEvents();
  resize();
  requestAnimationFrame(frame);
})();
