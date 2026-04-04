<template>
  <section class="hero">
    <div class="hero-grid" />
    <div class="hero-glow hero-glow-1" />
    <div class="hero-glow hero-glow-2" />
    <div class="hero-noise" />

    <div class="hero-inner">
      <div class="hero-badge">
        <span class="badge-dot" />
        <span>开源免费 · 持续更新</span>
      </div>

      <h1 class="hero-title">
        <span class="title-line">深入源码内核</span>
        <span class="title-line title-accent">构建底层认知</span>
      </h1>

      <p class="hero-subtitle">
        四本技术专著，从 React、Vue、微前端到 AI Agent，逐行拆解源码实现，帮你真正理解框架本质
      </p>

      <div class="hero-stats">
        <div class="stat">
          <span class="stat-num">4</span>
          <span class="stat-label">本书籍</span>
        </div>
        <div class="stat-divider" />
        <div class="stat">
          <span class="stat-num">90+</span>
          <span class="stat-label">章节</span>
        </div>
        <div class="stat-divider" />
        <div class="stat">
          <span class="stat-num">100%</span>
          <span class="stat-label">免费开放</span>
        </div>
      </div>

      <div class="hero-actions">
        <a href="#books" class="btn-primary">
          开始阅读
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </a>
        <a href="https://github.com/yangyitao100" target="_blank" class="btn-secondary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          GitHub
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--home-hero-bg);
  overflow: hidden;
}

.hero-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(var(--home-hero-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--home-hero-grid) 1px, transparent 1px);
  background-size: 60px 60px;
  mask-image: radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 100%);
}

.hero-noise {
  position: absolute;
  inset: 0;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 256px 256px;
  pointer-events: none;
}

.hero-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
  pointer-events: none;
}

.hero-glow-1 {
  width: 600px;
  height: 600px;
  background: rgba(59, 130, 246, 0.1);
  top: -200px;
  right: -100px;
}

.hero-glow-2 {
  width: 500px;
  height: 500px;
  background: rgba(139, 92, 246, 0.07);
  bottom: -200px;
  left: -100px;
}

.hero-inner {
  position: relative;
  z-index: 1;
  text-align: center;
  max-width: 720px;
  padding: 0 24px;
  animation: fadeInUp 0.8s var(--ease-out);
}

/* Badge */
.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-radius: 100px;
  font-size: 13px;
  font-weight: 500;
  color: rgba(148, 163, 184, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.1);
  background: rgba(148, 163, 184, 0.04);
  margin-bottom: 48px;
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.6);
}

/* Title */
.hero-title {
  font-size: clamp(40px, 7vw, 72px);
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1.1;
  margin: 0 0 24px;
}

.title-line {
  display: block;
  background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.title-accent {
  background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-subtitle {
  font-size: clamp(15px, 2vw, 18px);
  font-weight: 400;
  color: rgba(148, 163, 184, 0.7);
  margin: 0 0 40px;
  line-height: 1.7;
  max-width: 540px;
  margin-left: auto;
  margin-right: auto;
}

/* Stats */
.hero-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 32px;
  margin-bottom: 48px;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-num {
  font-size: 28px;
  font-weight: 800;
  color: #fff;
  font-variant-numeric: tabular-nums;
}

.stat-label {
  font-size: 13px;
  color: rgba(148, 163, 184, 0.6);
}

.stat-divider {
  width: 1px;
  height: 36px;
  background: rgba(148, 163, 184, 0.12);
}

/* Actions */
.hero-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 14px 36px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  color: #fff;
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.3);
  transition: all 0.25s var(--ease-out);
}

.btn-primary:hover {
  box-shadow: 0 6px 24px rgba(99, 102, 241, 0.45);
  transform: translateY(-1px);
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 28px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  color: rgba(203, 213, 225, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.15);
  background: rgba(148, 163, 184, 0.04);
  transition: all 0.25s var(--ease-out);
}

.btn-secondary:hover {
  border-color: rgba(148, 163, 184, 0.3);
  background: rgba(148, 163, 184, 0.08);
}

@media (max-width: 640px) {
  .hero { min-height: 85vh; }
  .hero-stats { gap: 20px; }
  .stat-num { font-size: 22px; }
  .hero-actions { flex-direction: column; align-items: center; }
  .btn-primary, .btn-secondary { width: 100%; max-width: 260px; justify-content: center; }
}
</style>
