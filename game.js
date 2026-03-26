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

    normalFallSpeed: 0.5,     // cm/s downward
    jumpRiseDistance: 0.5,    // cm
    jumpRiseDuration: 0.5,    // s
    glideFallDistance: 0.1,   // cm
    glideDuration: 0.8,       // s

    minPipeSpacing: 0.9,      // cm at score 0
    midPipeSpacing: 1.9,      // cm at score 20
    maxPipeSpacing: 3.0,      // cm at score 30 approx

    initialSceneSpeed: 0.85,  // cm/s
    accelerationPerSecond: 0.012, // cm/s^2
    maxSceneSpeed: 1.85       // cm/s
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

    // 依規格：scale = 畫面高度(px) / 3
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
      phase: "idle", // idle | up | glide | fall
      phaseTimer: 0,
      wingTimer: 0,
      angle: 0,
      verticalVelocityPx: 0
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
    let x = width + cmToPx(0.8);
    for (let i = 0; i < 4; i++) {
      const pipe = createPipe(x);
      pipes.push(pipe);
      x += cmToPx(getPipeSpacingCm(score)) + cmToPx(CM.pipeWidth);
    }
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

  function startPlayingIfNeeded() {
    if (state === "ready") {
      state = "playing";
      flapBird();
    }
  }

  function flapBird() {
    if (state === "gameover") return;

    bird.phase = "up";
    bird.phaseTimer = 0;

    // 0.5 秒上升 0.5 cm → 速度 1.0 cm/s 向上
    bird.verticalVelocityPx = -cmToPx(
      CM.jumpRiseDistance / CM.jumpRiseDuration
    );
  }

  function triggerAction() {
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

  function updateBird(dt) {
    bird.wingTimer += dt;

    const wingRate = bird.phase === "up" ? 8 : 6;
    const wingPhase = bird.wingTimer * wingRate * Math.PI * 2;

    if (bird.phase === "idle") {
      bird.angle = Math.sin(wingPhase) * 0.18;
      bird.y += Math.sin(performance.now() * 0.004) * 0.12;
      return;
    }

    if (bird.phase === "up") {
      bird.phaseTimer += dt;
      bird.y += bird.verticalVelocityPx * dt;
      bird.angle = -0.35 + Math.sin(wingPhase) * 0.22;

      if (bird.phaseTimer >= CM.jumpRiseDuration) {
        bird.phase = "glide";
        bird.phaseTimer = 0;

        // 0.8 秒下降 0.1 cm → 速度 0.125 cm/s 向下
        bird.verticalVelocityPx = cmToPx(
          CM.glideFallDistance / CM.glideDuration
        );
      }
      return;
    }

    if (bird.phase === "glide") {
      bird.phaseTimer += dt;
      bird.y += bird.verticalVelocityPx * dt;
      bird.angle = -0.08 + Math.sin(wingPhase) * 0.18;

      if (bird.phaseTimer >= CM.glideDuration) {
        bird.phase = "fall";
        bird.phaseTimer = 0;

        // 不跳：1 秒下降 0.5 cm
        bird.verticalVelocityPx = cmToPx(CM.normalFallSpeed);
      }
      return;
    }

    if (bird.phase === "fall") {
      bird.phaseTimer += dt;
      bird.y += bird.verticalVelocityPx * dt;
      bird.angle = 0.25 + Math.sin(wingPhase) * 0.10;
    }
  }

  function updateClouds(dt, sceneSpeedPxPerSec) {
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
    const pipeSpacingPx = cmToPx(getPipeSpacingCm(score));
    const pipeWidthPx = cmToPx(CM.pipeWidth);

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

    if (pipes.length) {
      const lastPipe = pipes[pipes.length - 1];
      if (lastPipe.x <= width - pipeSpacingPx) {
        pipes.push(createPipe(lastPipe.x + pipeSpacingPx + pipeWidthPx));
      }
    }
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
      // 撞到上方不立即結束，保留可玩性，僅限制位置
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
    state = "gameover";
    bird.phase = "fall";
    bird.verticalVelocityPx = cmToPx(CM.normalFallSpeed);
  }

  function updateGround(dt, sceneSpeedPxPerSec) {
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
    updateClouds(dt, sceneSpeedPxPerSec);
    updatePipes(dt, sceneSpeedPxPerSec);
    updateGround(dt, sceneSpeedPxPerSec);
    checkCollisions();
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

    // Top pipe
    drawPipeSegment(pipe.x, 0, pipe.width, pipe.gapTop, true);

    // Bottom pipe
    drawPipeSegment(
      pipe.x,
      pipe.gapTop + pipe.gapHeight,
      pipe.width,
      groundTop - (pipe.gapTop + pipe.gapHeight),
      false
    );

    // Caps
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

    // Grass
    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(0, groundTop, width, grassHeight);

    // Soil
    ctx.fillStyle = COLORS.groundSoil;
    ctx.fillRect(0, groundTop + grassHeight, width, groundHeight - grassHeight);

    // Soil shadow
    ctx.fillStyle = COLORS.groundShadow;
    ctx.fillRect(
      0,
      groundTop + grassHeight + (groundHeight - grassHeight) * 0.58,
      width,
      (groundHeight - grassHeight) * 0.42
    );

    // Grass stripe pattern
    for (let x = groundOffsetPx - stripeWidth; x < width + stripeWidth; x += stripeWidth) {
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(x, groundTop, stripeWidth * 0.45, grassHeight * 0.28);

      ctx.fillStyle = "rgba(0,0,0,0.10)";
      ctx.fillRect(x + stripeWidth * 0.5, groundTop + grassHeight, stripeWidth * 0.45, groundHeight * 0.25);
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

    const wingRate = bird.phase === "up" ? 8 : 6;
    const wingAmplitude = bird.phase === "up" ? 0.75 : 0.55;
    const wingAngle = Math.sin(bird.wingTimer * wingRate * Math.PI * 2) * wingAmplitude;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bird.angle);

    // Body shadow
    ctx.fillStyle = COLORS.birdShadow;
    ctx.fillRect(-bodySize / 2 + bodySize * 0.08, -bodySize / 2 + bodySize * 0.08, bodySize, bodySize);

    // Body
    ctx.fillStyle = COLORS.birdBody;
    ctx.fillRect(-bodySize / 2, -bodySize / 2, bodySize, bodySize);

    // Wing
    ctx.save();
    ctx.translate(-bodySize * 0.05, 0);
    ctx.rotate(wingAngle);
    ctx.fillStyle = COLORS.wing;
    ctx.fillRect(-wingLength * 0.55, -wingWidth / 2, wingLength, wingWidth);
    ctx.restore();

    // Eye
    ctx.fillStyle = "#111111";
    ctx.beginPath();
    ctx.arc(bodySize * 0.14, -bodySize * 0.1, bodySize * 0.06, 0, Math.PI * 2);
    ctx.fill();

    // Beak shadow
    ctx.fillStyle = COLORS.beakShadow;
    ctx.beginPath();
    ctx.moveTo(bodySize / 2, -beakWidth / 2 + beakWidth * 0.35);
    ctx.lineTo(bodySize / 2 + beakLength, 0 + beakWidth * 0.35);
    ctx.lineTo(bodySize / 2, beakWidth / 2 + beakWidth * 0.35);
    ctx.closePath();
    ctx.fill();

    // Beak
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
  }

  bindEvents();
  resize();
  requestAnimationFrame(frame);
})();
