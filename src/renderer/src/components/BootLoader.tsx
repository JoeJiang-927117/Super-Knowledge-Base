import { useState, type PointerEvent } from 'react'

type Props = {
  exiting?: boolean
}

export default function BootLoader({ exiting = false }: Props) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const [expanded, setExpanded] = useState(false)
  const [pulseKey, setPulseKey] = useState(0)

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const nx = ((event.clientX - rect.left) / rect.width - 0.5) * 2
    const ny = ((event.clientY - rect.top) / rect.height - 0.5) * 2
    setTilt({ x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) })
  }

  function handlePointerLeave() {
    setTilt({ x: 0, y: 0 })
    setExpanded(false)
  }

  function triggerSnapBurst() {
    setExpanded(true)
    setPulseKey(prev => prev + 1)
    window.setTimeout(() => setExpanded(false), 380)
  }

  const l1Style = {
    transform: `translate(${(tilt.x * 3).toFixed(1)}px, ${(tilt.y * 2 + (expanded ? 14 : 0)).toFixed(1)}px)`
  }
  const l2Style = {
    transform: `translate(${(tilt.x * 7).toFixed(1)}px, ${(tilt.y * 4.5).toFixed(1)}px)`
  }
  const l3Style = {
    transform: `translate(${(tilt.x * 12).toFixed(1)}px, ${(tilt.y * 7 + (expanded ? -16 : 0)).toFixed(1)}px)`
  }

  return (
    <main
      className={`boot-screen ${exiting ? 'is-exiting' : ''} ${expanded ? 'is-expanded' : ''}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      aria-busy="true"
      aria-label="Loading ZHIXU"
    >
      <button
        type="button"
        className="boot-iso-stage"
        onClick={triggerSnapBurst}
        onPointerDown={() => setExpanded(true)}
        onPointerUp={() => setExpanded(false)}
        aria-label="Interactive ZHIXU 3-layer logo"
      >
        <svg className="boot-iso-svg" viewBox="0 0 240 240" role="img" aria-hidden="true">
          <defs>
            <linearGradient id="zhixu-l1-top" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e293b" />
              <stop offset="100%" stopColor="#0f172a" />
            </linearGradient>
            <linearGradient id="zhixu-l2-top" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1d4ed8" />
              <stop offset="100%" stopColor="#1e40af" />
            </linearGradient>
            <linearGradient id="zhixu-l3-top" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="52%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#1d4ed8" />
            </linearGradient>
            <linearGradient id="zhixu-z-fill" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#dbeafe" />
            </linearGradient>
            <filter id="zhixu-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#2563eb" floodOpacity="0.28" />
            </filter>
          </defs>

          {/* Pulsing isometric ground shadow */}
          <polygon
            className="boot-shadow"
            points="120,162 190,202 120,236 50,202"
          />

          {/* Floating Minecraft-like voxel sparks */}
          <g className="boot-voxels" key={pulseKey}>
            <rect className="voxel v1" x="42" y="114" width="6" height="6" rx="1" />
            <rect className="voxel v2" x="192" y="108" width="5" height="5" rx="1" />
            <rect className="voxel v3" x="62" y="64" width="5" height="5" rx="1" />
            <rect className="voxel v4" x="176" y="70" width="6" height="6" rx="1" />
            <rect className="voxel v5" x="118" y="42" width="5" height="5" rx="1" />
          </g>

          {/* Layer 1: Bottom Obsidian Slab */}
          <g className="iso-parallax" style={l1Style}>
            <g className="iso-layer iso-layer-1">
              <polygon points="48,150 120,191.5 120,209.5 48,168" fill="#060913" />
              <polygon points="192,150 120,191.5 120,209.5 192,168" fill="#0f172a" />
              <polygon
                points="120,108.5 192,150 120,191.5 48,150"
                fill="url(#zhixu-l1-top)"
                stroke="rgba(96, 165, 250, 0.32)"
                strokeWidth="1.2"
              />
            </g>
          </g>

          {/* Layer 2: Middle Royal Cobalt Slab */}
          <g className="iso-parallax" style={l2Style}>
            <g className="iso-layer iso-layer-2">
              <polygon points="48,125 120,166.5 120,184.5 48,143" fill="#172554" />
              <polygon points="192,125 120,166.5 120,184.5 192,143" fill="#1e3a8a" />
              <polygon
                points="120,83.5 192,125 120,166.5 48,125"
                fill="url(#zhixu-l2-top)"
                stroke="rgba(147, 197, 253, 0.52)"
                strokeWidth="1.3"
              />
            </g>
          </g>

          {/* Layer 3: Top Azure Slab + Edge-Parallel Folded-Ribbon Z */}
          <g className="iso-parallax" style={l3Style}>
            <g className="iso-layer iso-layer-3" filter="url(#zhixu-glow)">
              <polygon points="48,100 120,141.5 120,159.5 48,118" fill="#1d4ed8" />
              <polygon points="192,100 120,141.5 120,159.5 192,118" fill="#0284c7" />
              <polygon
                points="120,58.5 192,100 120,141.5 48,100"
                fill="url(#zhixu-l3-top)"
                stroke="rgba(224, 242, 254, 0.9)"
                strokeWidth="1.5"
              />
              {/* Crisp edge-parallel isometric folded-ribbon Z */}
              <path
                className="iso-z-mark"
                d="M 119.5 78.5 L 155.5 99.5 L 84.5 100.5 L 120.5 121.5"
                fill="none"
                stroke="url(#zhixu-z-fill)"
                strokeWidth="10.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          </g>
        </svg>
      </button>

      {/* Minecraft-inspired segmented chunk progress bar */}
      <div className="boot-chunk-bar" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, idx) => (
          <span key={idx} className="chunk-cell" style={{ animationDelay: `${idx * 95}ms` }} />
        ))}
      </div>
    </main>
  )
}
