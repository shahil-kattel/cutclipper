import { useEffect, useRef } from 'react'

interface Star {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  alpha: number
  phase: number
}

export function BackgroundFX() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const canvasNode = canvas
    const ctx = context
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reduced = reducedMotion.matches
    let frame = 0
    let stars: Star[] = []
    let width = 0
    let height = 0
    let dpr = 1
    let previousTime = 0

    function createStars() {
      const count = width < 720 ? 28 : 48
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        radius: 0.55 + Math.random() * 1.15,
        alpha: 0.16 + Math.random() * 0.42,
        phase: Math.random() * Math.PI * 2,
      }))
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvasNode.width = Math.floor(width * dpr)
      canvasNode.height = Math.floor(height * dpr)
      canvasNode.style.width = `${width}px`
      canvasNode.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      createStars()
    }

    function draw(time: number) {
      const delta = previousTime ? Math.min(0.034, (time - previousTime) / 1000) : 0.016
      previousTime = time
      ctx.clearRect(0, 0, width, height)

      for (const star of stars) {
        if (!reduced) {
          star.x += star.vx * delta
          star.y += star.vy * delta
          if (star.x < -10) star.x = width + 10
          if (star.x > width + 10) star.x = -10
          if (star.y < -10) star.y = height + 10
          if (star.y > height + 10) star.y = -10
        }
        const twinkle = reduced ? 1 : 0.82 + Math.sin(time / 1900 + star.phase) * 0.18
        ctx.beginPath()
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(176, 224, 255, ${star.alpha * twinkle})`
        ctx.fill()
      }

      if (!reduced) {
        for (let first = 0; first < stars.length; first += 1) {
          const a = stars[first]
          if (!a) continue
          for (let second = first + 1; second < stars.length; second += 1) {
            const b = stars[second]
            if (!b) continue
            const dx = a.x - b.x
            const dy = a.y - b.y
            const distanceSquared = dx * dx + dy * dy
            if (distanceSquared < 19_000) {
              const opacity = (1 - distanceSquared / 19_000) * 0.085
              ctx.beginPath()
              ctx.moveTo(a.x, a.y)
              ctx.lineTo(b.x, b.y)
              ctx.strokeStyle = `rgba(119, 186, 255, ${opacity})`
              ctx.lineWidth = 0.6
              ctx.stroke()
            }
          }
        }
      }

      frame = window.requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize, { passive: true })
    const mediaListener = (event: MediaQueryListEvent) => {
      reduced = event.matches
      previousTime = 0
    }
    reducedMotion.addEventListener('change', mediaListener)
    frame = window.requestAnimationFrame(draw)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      reducedMotion.removeEventListener('change', mediaListener)
    }
  }, [])

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-20%,rgba(118,87,255,0.22),transparent_58%)]" />
      <div className="absolute -left-[18rem] top-[18%] h-[36rem] w-[36rem] rounded-full bg-[#2ce8ff]/[0.045] blur-[130px]" />
      <div className="absolute -right-[22rem] top-[2%] h-[42rem] w-[42rem] rounded-full bg-[#9b6dff]/[0.075] blur-[150px]" />
      <div className="absolute -bottom-[24rem] left-[22%] h-[48rem] w-[48rem] rounded-full bg-[#ff4fd8]/[0.05] blur-[170px]" />
      <div className="perspective-grid absolute inset-x-0 bottom-0 h-[72vh] origin-bottom opacity-60 [transform:perspective(620px)_rotateX(61deg)_scale(1.7)]" />
      <canvas ref={canvasRef} className="absolute inset-0 opacity-80" />
      <div className="noise absolute inset-0 opacity-[0.026] mix-blend-soft-light" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/25 to-transparent" />
    </div>
  )
}
