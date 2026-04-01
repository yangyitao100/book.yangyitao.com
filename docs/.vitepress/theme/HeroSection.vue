<script setup lang="ts">
import { onMounted, ref } from 'vue'

const canvasRef = ref<HTMLCanvasElement | null>(null)

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  let animationId: number
  let particles: Array<{
    x: number; y: number; vx: number; vy: number;
    size: number; opacity: number; hue: number
  }> = []

  const resize = () => {
    canvas.width = canvas.offsetWidth * window.devicePixelRatio
    canvas.height = canvas.offsetHeight * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
  }

  const initParticles = () => {
    const w = canvas.offsetWidth
    const h = canvas.offsetHeight
    const count = Math.floor((w * h) / 12000)
    particles = Array.from({ length: Math.min(count, 80) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 2 + 1,
      opacity: Math.random() * 0.3 + 0.1,
      hue: 240 + Math.random() * 40,
    }))
  }

  const draw = () => {
    const w = canvas.offsetWidth
    const h = canvas.offsetHeight
    ctx.clearRect(0, 0, w, h)

    for (const p of particles) {
      p.x += p.vx
      p.y += p.vy
      if (p.x < 0 || p.x > w) p.vx *= -1
      if (p.y < 0 || p.y > h) p.vy *= -1

      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(${p.hue}, 70%, 65%, ${p.opacity})`
      ctx.fill()
    }

    // Draw connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x
        const dy = particles[i].y - particles[j].y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 120) {
          ctx.beginPath()
          ctx.moveTo(particles[i].x, particles[i].y)
          ctx.lineTo(particles[j].x, particles[j].y)
          ctx.strokeStyle = `hsla(250, 60%, 65%, ${0.06 * (1 - dist / 120)})`
          ctx.lineWidth = 0.5
          ctx.stroke()
        }
      }
    }

    animationId = requestAnimationFrame(draw)
  }

  resize()
  initParticles()
  draw()

  window.addEventListener('resize', () => {
    resize()
    initParticles()
  })

  return () => {
    cancelAnimationFrame(animationId)
  }
})
</script>

<template>
  <section class="hero-section">
    <canvas ref="canvasRef" class="hero-canvas" />
    <div class="hero-glow hero-glow-1" />
    <div class="hero-glow hero-glow-2" />
    <div class="hero-content">
      <div class="hero-badge">
        <span class="badge-dot" />
        免费开源 · 持续更新
      </div>
      <h1 class="hero-title">
        杨艺韬讲堂
      </h1>
      <p class="hero-subtitle">
        深入源码内核，构建底层认知
      </p>
      <p class="hero-description">
        四本高质量技术书籍，覆盖 React、Vue、微前端与 AI Agent 架构。<br />
        逐行拆解源码，从原理到实践，助你成为真正的技术专家。
      </p>
      <div class="hero-actions">
        <a href="#books" class="hero-btn hero-btn-primary">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          开始阅读
        </a>
        <a href="https://github.com/yangyitao100" target="_blank" class="hero-btn hero-btn-secondary">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          GitHub
        </a>
      </div>
      <div class="hero-stats">
        <div class="stat">
          <span class="stat-number">4</span>
          <span class="stat-label">本技术书籍</span>
        </div>
        <div class="stat-divider" />
        <div class="stat">
          <span class="stat-number">100+</span>
          <span class="stat-label">章节内容</span>
        </div>
        <div class="stat-divider" />
        <div class="stat">
          <span class="stat-number">100%</span>
          <span class="stat-label">免费开源</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero-section {
  position: relative;
  min-height: 90vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: linear-gradient(135deg, var(--home-gradient-start), var(--home-gradient-end));
}

.hero-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.hero-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
  animation: pulse-glow 6s ease-in-out infinite;
}

.hero-glow-1 {
  width: 500px;
  height: 500px;
  background: var(--home-hero-glow);
  top: -100px;
  right: -100px;
}

.hero-glow-2 {
  width: 400px;
  height: 400px;
  background: rgba(168, 85, 247, 0.08);
  bottom: -80px;
  left: -80px;
  animation-delay: 3s;
}

.hero-content {
  position: relative;
  z-index: 1;
  text-align: center;
  max-width: 720px;
  padding: 0 24px;
  animation: fadeInUp 0.8s ease-out;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-radius: 100px;
  background: var(--home-card-bg);
  border: 1px solid var(--home-card-border);
  font-size: 13px;
  font-weight: 500;
  color: var(--home-text-2);
  margin-bottom: 32px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
  animation: pulse-glow 2s ease-in-out infinite;
}

.hero-title {
  font-size: clamp(40px, 7vw, 72px);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.1;
  color: var(--home-text-1);
  margin: 0 0 16px;
  background: linear-gradient(135deg, var(--home-text-1) 30%, var(--vp-c-brand-1) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-subtitle {
  font-size: clamp(18px, 3vw, 24px);
  font-weight: 600;
  color: var(--home-text-2);
  margin: 0 0 16px;
  letter-spacing: -0.01em;
}

.hero-description {
  font-size: 16px;
  line-height: 1.7;
  color: var(--home-text-3);
  margin: 0 0 40px;
  max-width: 560px;
  margin-left: auto;
  margin-right: auto;
}

.hero-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
  margin-bottom: 48px;
}

.hero-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 28px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.2s ease;
  cursor: pointer;
}

.hero-btn-primary {
  background: var(--vp-c-brand-1);
  color: #fff;
  box-shadow: 0 2px 8px rgba(100, 108, 255, 0.3);
}

.hero-btn-primary:hover {
  background: var(--vp-c-brand-2);
  box-shadow: 0 4px 16px rgba(100, 108, 255, 0.4);
  transform: translateY(-1px);
}

.hero-btn-secondary {
  background: var(--home-card-bg);
  color: var(--home-text-1);
  border: 1px solid var(--home-card-border);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.hero-btn-secondary:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.hero-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 32px;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-number {
  font-size: 28px;
  font-weight: 800;
  color: var(--home-text-1);
  letter-spacing: -0.02em;
}

.stat-label {
  font-size: 13px;
  color: var(--home-text-3);
  font-weight: 500;
}

.stat-divider {
  width: 1px;
  height: 32px;
  background: var(--home-divider);
}

@media (max-width: 640px) {
  .hero-section {
    min-height: 80vh;
  }
  .hero-stats {
    gap: 20px;
  }
  .stat-number {
    font-size: 22px;
  }
  .hero-description br {
    display: none;
  }
}
</style>
