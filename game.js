const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

let width, height;
let bird, pipes = [];
let gravity = 0.5;
let velocity = 0;
let score = 0;
let gameOver = false;

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;
}
resize();
window.addEventListener("resize", resize);

function resetGame() {
  bird = {
    x: width * 0.3,
    y: height * 0.5,
    size: 20
  };
  velocity = 0;
  pipes = [];
  score = 0;
  gameOver = false;
}

function createPipe() {
  const gap = 150;
  const top = Math.random() * (height - gap - 100) + 50;

  pipes.push({
    x: width,
    width: 60,
    top: top,
    bottom: top + gap,
    passed: false
  });
}

function update() {
  if (gameOver) return;

  velocity += gravity;
  bird.y += velocity;

  if (bird.y > height) gameOver = true;
  if (bird.y < 0) bird.y = 0;

  pipes.forEach(p => {
    p.x -= 3;

    if (!p.passed && p.x < bird.x) {
      score++;
      p.passed = true;
    }

    if (
      bird.x + bird.size > p.x &&
      bird.x - bird.size < p.x + p.width &&
      (bird.y - bird.size < p.top || bird.y + bird.size > p.bottom)
    ) {
      gameOver = true;
    }
  });

  pipes = pipes.filter(p => p.x + p.width > 0);

  if (pipes.length === 0 || pipes[pipes.length - 1].x < width - 250) {
    createPipe();
  }
}

function draw() {
  ctx.fillStyle = "#70c5ce";
  ctx.fillRect(0, 0, width, height);

  // bird
  ctx.fillStyle = "yellow";
  ctx.beginPath();
  ctx.arc(bird.x, bird.y, bird.size, 0, Math.PI * 2);
  ctx.fill();

  // pipes
  ctx.fillStyle = "green";
  pipes.forEach(p => {
    ctx.fillRect(p.x, 0, p.width, p.top);
    ctx.fillRect(p.x, p.bottom, p.width, height);
  });

  // score
  ctx.fillStyle = "white";
  ctx.font = "30px Arial";
  ctx.fillText(score, width / 2, 50);

  if (gameOver) {
    ctx.fillText("Game Over", width / 2 - 80, height / 2);
  }
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

document.addEventListener("click", () => {
  if (gameOver) {
    resetGame();
  }
  velocity = -8;
});

resetGame();
loop();