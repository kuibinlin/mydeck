import confetti from 'canvas-confetti'

// Confetti colors — update here to restyle globally
const COLORS = [
  '#0071e3', '#6366f1', '#FFD700', '#ff3b30',
  '#34c759', '#ff9f0a', '#ff6b9d', '#ffffff',
  '#a855f7', '#06b6d4',
]

// Dual cannon blast from both bottom corners
export function fireConfetti() {
  const shared = {
    particleCount: 120,
    spread: 70,
    startVelocity: 80,
    ticks: 280,
    colors: COLORS,
    gravity: 0.8,
  }

  confetti({ ...shared, angle: 60,  origin: { x: 0, y: 1 } })
  confetti({ ...shared, angle: 120, origin: { x: 1, y: 1 } })
}
