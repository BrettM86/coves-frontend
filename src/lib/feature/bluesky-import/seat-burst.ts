/**
 * The small celebration when the Bluesky card seats in the Coves slot:
 * outline confetti popping out of the card's left and right edges, plus a
 * few off its corners. It lives on document.body, above the modal, because
 * the dialog's overflow would clip it.
 */

/** Everything is gone by then, even with the longest stagger. */
const BURST_LIFETIME_MS = 1300
const PER_SIDE = 8
const PER_CORNER = 1
/** Top and bottom edges never take more than this many particles each. */
const MAX_PER_EDGE = 24

type Kind = 'capsule' | 'dash' | 'diamond'

const KINDS: Kind[] = ['capsule', 'dash', 'diamond']

/** rose-500, teal-500 and amber-500: they read on light and dark pages. */
const COLOURS: Record<Kind, string> = {
  capsule: '#f43f5e',
  dash: '#14b8a6',
  diamond: '#f59e0b',
}

type Shape = {
  from: { width: number; height: number; rotate: number }
  to: { width: number; height: number; rotate: number }
}

function shape(kind: Kind, random: () => number): Shape {
  const tilt = (random() - 0.5) * 40
  switch (kind) {
    // A rose capsule that rounds into a ring as it shrinks.
    case 'capsule':
      return {
        from: { width: 8, height: 20, rotate: tilt },
        to: { width: 9, height: 9, rotate: tilt + (random() - 0.5) * 30 },
      }
    // A teal dash that shortens toward a dot.
    case 'dash':
      return {
        from: { width: 3, height: 20, rotate: tilt },
        to: { width: 3, height: 5, rotate: tilt + (random() - 0.5) * 30 },
      }
    // An amber outlined square turned into a diamond that keeps turning.
    case 'diamond':
      return {
        from: { width: 11, height: 11, rotate: 45 },
        to: { width: 8, height: 8, rotate: 45 + 90 + random() * 60 },
      }
  }
}

function particle(kind: Kind): HTMLElement {
  const node = document.createElement('span')
  const colour = COLOURS[kind]
  Object.assign(node.style, {
    position: 'absolute',
    boxSizing: 'border-box',
    opacity: '0',
    borderRadius: kind === 'diamond' ? '2px' : '9999px',
    ...(kind === 'dash'
      ? { backgroundColor: colour }
      : { border: `2px solid ${colour}` }),
  })
  return node
}

/**
 * Fires the burst around `rect` and returns a function that removes it; it
 * also removes itself once the particles have faded. Without the Web
 * Animations API the particles are not drawn, but the overlay keeps the same
 * lifetime.
 */
export function fireSeatBurst(
  rect: DOMRect,
  random: () => number = Math.random,
): () => void {
  const overlay = document.createElement('div')
  overlay.dataset.seatBurst = ''
  overlay.setAttribute('aria-hidden', 'true')
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '1100',
  })

  type Launch = { x: number; y: number; dx: number; dy: number }
  const launches: Launch[] = []
  for (const side of [-1, 1]) {
    const x = side < 0 ? rect.left : rect.right
    for (let index = 0; index < PER_SIDE; index++) {
      // Spread over the middle of the side, fanning up and down from it.
      const along =
        0.2 + (0.6 * (index + 0.5 + (random() - 0.5) * 0.6)) / PER_SIDE
      launches.push({
        x,
        y: rect.top + rect.height * along,
        dx: side * (36 + random() * 44),
        dy: (along - 0.5) * 120 + (random() - 0.5) * 20,
      })
    }
    for (const vertical of [-1, 1]) {
      for (let index = 0; index < PER_CORNER; index++) {
        launches.push({
          x,
          y: vertical < 0 ? rect.top : rect.bottom,
          dx: side * (40 + random() * 30),
          dy: vertical * (40 + random() * 30),
        })
      }
    }
  }
  // Top and bottom edges spray up and down, as densely as the sides.
  const sideSpacing = (rect.height * 0.6) / PER_SIDE
  // A slot with no height yet (not laid out, or collapsed) has no side
  // spacing to match, so its edges take the minimum.
  const perEdge =
    sideSpacing > 0
      ? Math.min(
          MAX_PER_EDGE,
          Math.max(4, Math.round((rect.width * 0.6) / sideSpacing)),
        )
      : 4
  for (const vertical of [-1, 1]) {
    const y = vertical < 0 ? rect.top : rect.bottom
    for (let index = 0; index < perEdge; index++) {
      const along =
        0.2 + (0.6 * (index + 0.5 + (random() - 0.5) * 0.6)) / perEdge
      launches.push({
        x: rect.left + rect.width * along,
        y,
        dx: (along - 0.5) * 120 + (random() - 0.5) * 20,
        dy: vertical * (36 + random() * 44),
      })
    }
  }

  launches.forEach((launch, index) => {
    const kind = KINDS[index % KINDS.length]!
    const node = particle(kind)
    node.style.left = `${launch.x}px`
    node.style.top = `${launch.y}px`
    overlay.append(node)
    if (typeof node.animate !== 'function') return
    const { from, to } = shape(kind, random)
    const place = (
      x: number,
      y: number,
      rotate: number,
      scale: number,
    ): string =>
      `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${rotate}deg) scale(${scale})`
    node.animate(
      [
        {
          opacity: 1,
          width: `${from.width}px`,
          height: `${from.height}px`,
          transform: place(0, 0, from.rotate, 0.8),
        },
        {
          offset: 0.3,
          opacity: 1,
          transform: place(
            launch.dx * 0.7,
            launch.dy * 0.7,
            (from.rotate + to.rotate) / 2,
            1,
          ),
        },
        {
          offset: 0.65,
          opacity: 1,
        },
        {
          opacity: 0,
          width: `${to.width}px`,
          height: `${to.height}px`,
          transform: place(launch.dx, launch.dy, to.rotate, 0.75),
        },
      ],
      {
        duration: 650 + random() * 200,
        delay: (index % (PER_SIDE + 2 * PER_CORNER)) * 10 + random() * 30,
        easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
        fill: 'both',
      },
    )
  })

  document.body.append(overlay)
  const timer = setTimeout(remove, BURST_LIFETIME_MS)
  function remove(): void {
    clearTimeout(timer)
    overlay.remove()
  }
  return remove
}
