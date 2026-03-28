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
    overlay: "rgba(0,0,0,0.35)"
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

  let width = 0;
  let height = 0;
  let scale = 0;

  let state = "ready"; // ready | playing | gameover
  let lastTime = 0;
  let elapsedGameTime = 0;

  let highScore = Number(localStorage.getItem("flappy_high_score") || 0);
  let score = 0;

  let bird = null;
  let pipes = [];
  let clouds = [];
  let groundOffsetPx = 0;

  let birdLandedAfterDeath = false;

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
    groundOffsetPx = 0;
    score = 0;
    elapsedGameTime = 0;
    birdLandedAfterDeath = false;
    highScore = previousHighScore;
    state = previousState === "gameover" ? "ready" : previousState;

    createInitialPipes();
  }

  function resetGame() {
    state = "ready";
    bird = createBird();
    pipes = [];
    score = 0;
    elapsedGameTime = 0;
    groundOffsetPx = 0;
    birdLandedAfterDeath = false;
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
      velocityY: 0
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

  function resolveDeathSolidCollision(prevY) {
    const birdHalf = bird.size / 2;
    const birdLeft = bird.x - birdHalf;
    const birdRight = bird.x + birdHalf;
    const birdTop = bird.y - birdHalf;
    const birdBottom = bird.y + birdHalf;
    const prevTop = prevY - birdHalf;
    const prevBottom = prevY + birdHalf;
    const groundTop = height - cmToPx(CM.groundHeight);

    if (birdBottom >= groundTop) {
      bird.y = groundTop - birdHalf;
      bird.velocityY = 0;
      bird.angle = 1.55;
      birdLandedAfterDeath = true;
      return true;
    }

    for (const pipe of pipes) {
      const pipeLeft = pipe.x;
      const pipeRight = pipe.x + pipe.width;

      if (birdRight <= pipeLeft || birdLeft >= pipeRight) {
        continue;
      }

      const topPipeBottom = pipe.gapTop;
      const bottomPipeTop = pipe.gapTop + pipe.gapHeight;

      // 落到下方水管上表面
      if (prevBottom <= bottomPipeTop && birdBottom >= bottomPipeTop) {
        bird.y = bottomPipeTop - birdHalf;
        bird.velocityY = 0;
        bird.angle = 1.55;
        birdLandedAfterDeath = true;
        return true;
      }

      // 若原本就卡進下方水管，也直接推出去
      if (birdBottom > bottomPipeTop && birdTop < height) {
        if (bird.y >= bottomPipeTop - birdHalf) {
          bird.y = bottomPipeTop - birdHalf;
          bird.velocityY = 0;
          bird.angle = 1.55;
          birdLandedAfterDeath = true;
          return true;
        }
      }

      // 若死亡瞬間在上方水管內或靠其底面，也不可往下穿出
      if (birdTop < topPipeBottom) {
        bird.y = topPipeBottom + birdHalf;
        bird.velocityY = 0;
        bird.angle = 1.55;
        birdLandedAfterDeath = true;
        return true;
      }

      // 補強：若剛好從 gap 中掉進下方水管
      if (prevBottom <= bottomPipeTop && birdBottom > bottomPipeTop) {
        bird.y = bottomPipeTop - birdHalf;
        bird.velocityY = 0;
        bird.angle = 1.55;
        birdLandedAfterDeath = true;
        return true;
      }
    }

    return false;
  }

  function updateBird(dt) {
    const groundTop = height - cmToPx(CM.groundHeight);
    const gravityPx = cmToPx(CM.gravity);
    const maxFallSpeedPx = cmToPx(CM.maxFallSpeed);

    if (state === "ready") {
      bird.wingTimer += dt;
      bird.angle = -0.08;
      bird.y += Math.sin(performance.now() * 0.004) * 0.12;
      return;
    }

    if (state === "playing") {
      bird.wingTimer += dt;
      bird.velocityY += gravityPx * dt;
      bird.velocityY = Math.min(bird.velocityY, maxFallSpeedPx);
      bird.y += bird.velocityY * dt;

      const t = clamp(bird.velocityY / maxFallSpeedPx, -1, 1);
      bird.angle = lerp(-0.6, 1.2, (t + 1) / 2);
      return;
    }

    if (state === "gameover") {
      if (birdLandedAfterDeath) {
        bird.velocityY = 0;
        bird.angle = 1.55;

        if (bird.y + bird.size / 2 >= groundTop) {
          bird.y = groundTop - bird.size / 2;
        }
        return;
      }

      const prevY = bird.y;

      bird.velocityY += gravityPx * dt;
      bird.velocityY = Math.min(bird.velocityY, maxFallSpeedPx);
      bird.y += bird.velocityY * dt;
      bird.angle = lerp(bird.angle, 1.55, 0.18);

      resolveDeathSolidCollision(prevY);
    }
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

    const birdBox = {
      left: bird.x - bird.size / 2,
      right: bird.x + bird.size / 2,
      top: bird.y - bird.size / 2,
      bottom: bird.y + bird.size / 2
    };

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
    birdLandedAfterDeath = false;
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
    drawBird();
    drawScore();
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
      triggerAction();
    });

    canvas.addEventListener(
      "touchstart",
      (event) => {
        event.preventDefault();
        triggerAction();
      },
      { passive: false }
    );

    window.addEventListener("pointerdown", ensureAudio, { passive: true });
    window.addEventListener("keydown", ensureAudio);
  }

  function ensureAudio() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      audioContext = new AudioCtx();

      masterGain = audioContext.createGain();
      masterGain.gain.value = 0.18;
      masterGain.connect(audioContext.destination);
    }

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    if (!bgmStarted) {
      startBackgroundMusic();
      bgmStarted = true;
    }
  }

  function playFlapSound() {
    if (!audioContext || !masterGain) return;

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
    if (!audioContext || !masterGain) return;

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
      196.00, 220.00, 174.61, 196.00
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
