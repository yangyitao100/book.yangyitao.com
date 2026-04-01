<template>
  <section class="hero">
    <div class="hero-grid" />
    <div class="hero-glow hero-glow-1" />
    <div class="hero-glow hero-glow-2" />
    <div class="hero-noise" />

    <div class="hero-inner">
      <div class="hero-pills">
        <span class="pill">4 本书籍</span>
        <span class="pill">100+ 章节</span>
        <span class="pill pill-free">完全免费</span>
      </div>

      <h1 class="hero-title">杨艺韬讲堂</h1>
      <p class="hero-subtitle">深入源码内核，构建底层认知</p>

      <div class="hero-actions">
        <a href="#books" class="btn-primary">
          开始阅读
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
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
  min-height: 80vh;
  background: var(--home-hero-bg);
  overflow: hidden;
}

/* Subtle grid lines */
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

/* Noise texture overlay */
.hero-noise {
  position: absolute;
  inset: 0;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 256px 256px;
  pointer-events: none;
}

/* Glow orbs */
.hero-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  pointer-events: none;
}

.hero-glow-1 {
  width: 600px;
  height: 600px;
  background: rgba(59, 130, 246, 0.12);
  top: -200px;
  right: -100px;
}

.hero-glow-2 {
  width: 500px;
  height: 500px;
  background: rgba(139, 92, 246, 0.08);
  bottom: -200px;
  left: -100px;
}

.hero-inner {
  position: relative;
  z-index: 1;
  text-align: center;
  max-width: 680px;
  padding: 0 24px;
  animation: fadeInUp 0.7s var(--ease-out);
}

/* Pill stats */
.hero-pills {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
  margin-bottom: 40px;
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 5px 14px;
  border-radius: 100px;
  font-size: 13px;
  font-weight: 500;
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(148, 163, 184, 0.04);
  letter-spacing: 0.01em;
}

.pill-free {
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.2);
  background: rgba(52, 211, 153, 0.06);
}

/* Title — gradient text */
.hero-title {
  font-size: clamp(48px, 8vw, 80px);
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1.05;
  margin: 0 0 16px;
  background: linear-gradient(135deg, #ffffff 0%, #60a5fa 50%, #a78bfa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-subtitle {
  font-size: clamp(17px, 2.5vw, 22px);
  font-weight: 400;
  color: rgba(203, 213, 225, 0.7);
  margin: 0 0 48px;
  letter-spacing: 0.02em;
}

/* CTA */
.hero-actions {
  display: flex;
  justify-content: center;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 13px 32px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  color: #fff;
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  box-shadow: 0 0 0 0 rgba(99, 102, 241, 0);
  transition: all 0.25s var(--ease-out);
}

.btn-primary:hover {
  box-shadow: 0 0 24px 4px rgba(99, 102, 241, 0.35);
  transform: scale(1.02);
}

@media (max-width: 640px) {
  .hero {
    min-height: 70vh;
  }
  .hero-pills {
    gap: 8px;
  }
}
</style>
