import {
  ArrowUpRight, BookOpen, Eye, EyeOff, Maximize2, Network, RefreshCw, Search, Sparkles, X, ZoomIn, ZoomOut
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KnowledgeGraphData, KnowledgeGraphNode, StorageDomain } from '../../../shared/types'
import { useI18n } from '../i18n'
import { storageDomainLabel, workflowStatusLabel } from '../labels'
import { ZhixuIsoLoader } from './BootLoader'

type Props = {
  data: KnowledgeGraphData | null
  loading: boolean
  theme: 'light' | 'dark'
  onRefresh: () => void
  onOpenPage: (slug: string) => void
}

type SimNode = KnowledgeGraphNode & {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
}

/**
 * Refined monochrome metallic/architectural tones per storage domain.
 * Zero loud rainbow colors — stays cohesive with ZHIXU's Obsidian & Alabaster identity.
 */
const DOMAIN_TONES: Record<
  StorageDomain,
  { darkFill: string; darkStroke: string; lightFill: string; lightStroke: string; glyph: string }
> = {
  foundation: { darkFill: '#f4f4f5', darkStroke: '#ffffff', lightFill: '#111114', lightStroke: '#09090b', glyph: '01' },
  domain_knowledge: { darkFill: '#d4d4d8', darkStroke: '#f4f4f5', lightFill: '#27272a', lightStroke: '#18181b', glyph: '02' },
  cases: { darkFill: '#b4b4be', darkStroke: '#e4e4e7', lightFill: '#3f3f46', lightStroke: '#27272a', glyph: '03' },
  concrete_media: { darkFill: '#9a9aa6', darkStroke: '#d4d4d8', lightFill: '#52525b', lightStroke: '#3f3f46', glyph: '04' },
  permissions: { darkFill: '#e4e4e7', darkStroke: '#ffffff', lightFill: '#18181b', lightStroke: '#09090b', glyph: '05' },
  versions: { darkFill: '#a1a1aa', darkStroke: '#d4d4d8', lightFill: '#52525b', lightStroke: '#3f3f46', glyph: '06' }
}

const FILTER_DOMAINS: StorageDomain[] = [
  'foundation',
  'domain_knowledge',
  'cases',
  'concrete_media',
  'permissions'
]

export default function KnowledgeGraphView({ data, loading, theme, onRefresh, onOpenPage }: Props) {
  const { locale, tx } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [domainFilter, setDomainFilter] = useState<StorageDomain | 'all'>('all')
  const [showEntities, setShowEntities] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const simNodesRef = useRef<SimNode[]>([])
  const nodeIndexRef = useRef<Map<string, SimNode>>(new Map())
  const cameraRef = useRef({ x: 0, y: 0, zoom: 0.92 })
  const dragRef = useRef<{
    mode: 'none' | 'pan' | 'node'
    nodeId?: string
    startX: number
    startY: number
    camStartX: number
    camStartY: number
    moved: boolean
  }>({ mode: 'none', startX: 0, startY: 0, camStartX: 0, camStartY: 0, moved: false })
  const energyRef = useRef(1)
  const hoveredRef = useRef<string | null>(null)
  const selectedRef = useRef<string | null>(null)

  hoveredRef.current = hoveredId
  selectedRef.current = selectedId

  const filteredGraph = useMemo(() => {
    if (!data) return { nodes: [] as KnowledgeGraphNode[], edges: [] as KnowledgeGraphData['edges'] }
    const nodes = data.nodes.filter(n => {
      if (!showEntities && n.kind === 'entity') return false
      if (domainFilter !== 'all' && n.storageDomain !== domainFilter) return false
      return true
    })
    const ids = new Set(nodes.map(n => n.id))
    const edges = data.edges.filter(e => ids.has(e.source) && ids.has(e.target))
    return { nodes, edges }
  }, [data, showEntities, domainFilter])

  const matchedIds = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return new Set<string>()
    return new Set(
      filteredGraph.nodes
        .filter(n => n.label.toLowerCase().includes(q) || (n.summary ?? '').toLowerCase().includes(q))
        .map(n => n.id)
    )
  }, [filteredGraph.nodes, searchTerm])

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const edge of filteredGraph.edges) {
      if (!map.has(edge.source)) map.set(edge.source, new Set())
      if (!map.has(edge.target)) map.set(edge.target, new Set())
      map.get(edge.source)!.add(edge.target)
      map.get(edge.target)!.add(edge.source)
    }
    return map
  }, [filteredGraph.edges])

  const selectedNode = useMemo(
    () => filteredGraph.nodes.find(n => n.id === selectedId) ?? null,
    [filteredGraph.nodes, selectedId]
  )

  const selectedNeighbors = useMemo(() => {
    if (!selectedId) return []
    const neighborIds = adjacency.get(selectedId)
    if (!neighborIds) return []
    return filteredGraph.nodes
      .filter(n => neighborIds.has(n.id))
      .sort((a, b) => (a.kind === 'wiki' ? -1 : 1) - (b.kind === 'wiki' ? -1 : 1) || b.degree - a.degree)
  }, [selectedId, adjacency, filteredGraph.nodes])

  // Spacious, collision-free orbital constellation initial layout
  useEffect(() => {
    const wikiNodes = filteredGraph.nodes.filter(n => n.kind === 'wiki')
    const entityNodes = filteredGraph.nodes.filter(n => n.kind === 'entity')
    const nextNodes: SimNode[] = []
    const idxMap = new Map<string, SimNode>()

    const nonIndexWikis = wikiNodes.filter(n => n.slug !== 'index')
    const wikiRingR = Math.max(200, Math.min(340, nonIndexWikis.length * 36))

    let ringIdx = 0
    wikiNodes.forEach(n => {
      const isIndex = n.slug === 'index'
      const angle = isIndex ? 0 : (ringIdx++ / Math.max(1, nonIndexWikis.length)) * Math.PI * 2 - Math.PI / 2
      const r = isIndex ? 0 : wikiRingR
      const node: SimNode = {
        ...n,
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        radius: isIndex ? 14 : Math.min(11, 7.5 + Math.sqrt(Math.max(1, n.degree)) * 0.9)
      }
      nextNodes.push(node)
      idxMap.set(node.id, node)
    })

    // Place entity satellites in an outer constellation ring near their parent Wiki angle
    const entRingR = wikiRingR + 135
    entityNodes.forEach((n, i) => {
      const parentWiki = n.slug ? idxMap.get(`wiki:${n.slug}`) : null
      const baseAngle = parentWiki && (parentWiki.x !== 0 || parentWiki.y !== 0)
        ? Math.atan2(parentWiki.y, parentWiki.x)
        : (i / Math.max(1, entityNodes.length)) * Math.PI * 2
      const fanOffset = (((i % 5) - 2) * 0.24)
      const angle = baseAngle + fanOffset
      const r = entRingR + ((i % 3) - 1) * 28
      const node: SimNode = {
        ...n,
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        radius: Math.min(6, 3.6 + Math.sqrt(Math.max(1, n.chunkCount ?? 1)) * 0.35)
      }
      nextNodes.push(node)
      idxMap.set(node.id, node)
    })

    simNodesRef.current = nextNodes
    nodeIndexRef.current = idxMap
    energyRef.current = 0.85
    cameraRef.current = { x: 0, y: 0, zoom: nextNodes.length > 50 ? 0.72 : 0.9 }
    if (selectedId && !idxMap.has(selectedId)) {
      setSelectedId(null)
    }
  }, [filteredGraph.nodes, selectedId])

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const cam = cameraRef.current
    return {
      x: (clientX - rect.left - rect.width / 2 - cam.x) / cam.zoom,
      y: (clientY - rect.top - rect.height / 2 - cam.y) / cam.zoom
    }
  }, [])

  const pickNodeAt = useCallback(
    (clientX: number, clientY: number): SimNode | null => {
      const { x, y } = screenToWorld(clientX, clientY)
      const nodes = simNodesRef.current
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const n = nodes[i]
        const hitR = Math.max(n.radius + 7, 12)
        const dx = x - n.x
        const dy = y - n.y
        if (dx * dx + dy * dy <= hitR * hitR) return n
      }
      return null
    },
    [screenToWorld]
  )

  const focusNode = useCallback((id: string) => {
    const target = nodeIndexRef.current.get(id)
    if (!target) return
    setSelectedId(id)
    const zoom = Math.max(cameraRef.current.zoom, 1.05)
    cameraRef.current = { x: -target.x * zoom, y: -target.y * zoom, zoom }
    energyRef.current = Math.max(energyRef.current, 0.06)
  }, [])

  useEffect(() => {
    if (matchedIds.size > 0 && matchedIds.size <= 3) {
      const firstId = [...matchedIds][0]
      const target = nodeIndexRef.current.get(firstId)
      if (target) {
        const zoom = Math.max(cameraRef.current.zoom, 1.05)
        cameraRef.current = { x: -target.x * zoom, y: -target.y * zoom, zoom }
      }
    }
  }, [matchedIds])

  // Collision-free constellation force simulation + monochrome precision Canvas render loop
  useEffect(() => {
    let rafId = 0
    const isDark = theme === 'dark'

    const tick = () => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (canvas && container) {
        const rect = container.getBoundingClientRect()
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const w = Math.max(320, Math.floor(rect.width))
        const h = Math.max(300, Math.floor(rect.height))
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
          canvas.width = w * dpr
          canvas.height = h * dpr
        }

        const nodes = simNodesRef.current
        const idxMap = nodeIndexRef.current
        const edges = filteredGraph.edges

        if (energyRef.current > 0.008 && nodes.length > 0) {
          const damping = 0.82
          const gravity = 0.008

          for (let i = 0; i < nodes.length; i += 1) {
            const a = nodes[i]
            if (dragRef.current.mode === 'node' && dragRef.current.nodeId === a.id) continue
            let fx = -a.x * gravity
            let fy = -a.y * gravity

            for (let j = i + 1; j < nodes.length; j += 1) {
              const b = nodes[j]
              const dx = a.x - b.x
              const dy = a.y - b.y
              const distSq = dx * dx + dy * dy + 16
              if (distSq > 360_000) continue
              const dist = Math.sqrt(distSq)

              // Stronger spacing between Wiki hubs so labels NEVER overlap
              const bothWiki = a.kind === 'wiki' && b.kind === 'wiki'
              const minSep = bothWiki ? 165 : a.kind === 'wiki' || b.kind === 'wiki' ? 92 : 52
              let force = (bothWiki ? 12000 : 4800) / distSq
              if (dist < minSep) {
                force += (minSep - dist) * (bothWiki ? 0.24 : 0.14)
              }

              const ux = (dx / dist) * force
              const uy = (dy / dist) * force
              fx += ux
              fy += uy
              if (!(dragRef.current.mode === 'node' && dragRef.current.nodeId === b.id)) {
                b.vx -= ux * 0.075
                b.vy -= uy * 0.075
              }
            }
            a.vx = (a.vx + fx * 0.075) * damping
            a.vy = (a.vy + fy * 0.075) * damping
          }

          for (const edge of edges) {
            const s = idxMap.get(edge.source)
            const t = idxMap.get(edge.target)
            if (!s || !t) continue
            const dx = t.x - s.x
            const dy = t.y - s.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const restLen = edge.relation === 'wikilink' ? 210 : 122
            const spring = (dist - restLen) * (edge.relation === 'wikilink' ? 0.014 : 0.02)
            const ux = (dx / dist) * spring
            const uy = (dy / dist) * spring
            if (!(dragRef.current.mode === 'node' && dragRef.current.nodeId === s.id)) {
              s.vx += ux
              s.vy += uy
            }
            if (!(dragRef.current.mode === 'node' && dragRef.current.nodeId === t.id)) {
              t.vx -= ux
              t.vy -= uy
            }
          }

          for (const n of nodes) {
            if (dragRef.current.mode === 'node' && dragRef.current.nodeId === n.id) continue
            n.x += Math.max(-12, Math.min(12, n.vx))
            n.y += Math.max(-12, Math.min(12, n.vy))
          }

          energyRef.current *= 0.982
        }

        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.save()
          ctx.scale(dpr, dpr)
          ctx.clearRect(0, 0, w, h)

          const cam = cameraRef.current

          // 1. Subtle architectural radial coordinate rings & drafting crosshairs
          ctx.save()
          ctx.translate(w / 2 + cam.x, h / 2 + cam.y)
          ctx.scale(cam.zoom, cam.zoom)

          ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(17, 17, 20, 0.05)'
          ctx.lineWidth = 1 / cam.zoom
          for (const ring of [140, 260, 380]) {
            ctx.beginPath()
            ctx.setLineDash([3 / cam.zoom, 6 / cam.zoom])
            ctx.arc(0, 0, ring, 0, Math.PI * 2)
            ctx.stroke()
          }
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.moveTo(-440, 0)
          ctx.lineTo(440, 0)
          ctx.moveTo(0, -440)
          ctx.lineTo(0, 440)
          ctx.stroke()

          const activeFocusId = hoveredRef.current ?? selectedRef.current
          const activeNeighbors = activeFocusId ? adjacency.get(activeFocusId) : null
          const hasSearch = matchedIds.size > 0

          // 2. Curved architectural constellation edges
          for (const edge of edges) {
            const s = idxMap.get(edge.source)
            const t = idxMap.get(edge.target)
            if (!s || !t) continue
            const isHighlighted =
              activeFocusId && (edge.source === activeFocusId || edge.target === activeFocusId)
            const dimmed = Boolean(activeFocusId && !isHighlighted)

            const mx = (s.x + t.x) / 2
            const my = (s.y + t.y) / 2
            const dx = t.x - s.x
            const dy = t.y - s.y
            const curve = edge.relation === 'wikilink' ? 0.08 : 0.04
            const cx = mx - dy * curve
            const cy = my + dx * curve

            ctx.beginPath()
            ctx.moveTo(s.x, s.y)
            ctx.quadraticCurveTo(cx, cy, t.x, t.y)
            if (isHighlighted) {
              ctx.strokeStyle = isDark ? 'rgba(244, 244, 245, 0.72)' : 'rgba(17, 17, 20, 0.72)'
              ctx.lineWidth = edge.relation === 'wikilink' ? 1.55 : 1.15
            } else if (edge.relation === 'wikilink') {
              ctx.strokeStyle = dimmed
                ? isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(17, 17, 20, 0.05)'
                : isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(17, 17, 20, 0.16)'
              ctx.lineWidth = 1.0
            } else {
              ctx.strokeStyle = dimmed
                ? isDark ? 'rgba(255, 255, 255, 0.025)' : 'rgba(17, 17, 20, 0.03)'
                : isDark ? 'rgba(255, 255, 255, 0.085)' : 'rgba(17, 17, 20, 0.09)'
              ctx.lineWidth = 0.75
            }
            ctx.stroke()
          }

          // 3. Precision monochrome titanium/obsidian nodes
          for (const n of nodes) {
            const tone = DOMAIN_TONES[n.storageDomain] ?? DOMAIN_TONES.foundation
            const isSelected = n.id === selectedRef.current
            const isHovered = n.id === hoveredRef.current
            const isNeighbor = Boolean(activeNeighbors?.has(n.id))
            const isMatched = matchedIds.has(n.id)
            const isFocused = isSelected || isHovered || isNeighbor || isMatched
            const dimmed = Boolean((activeFocusId && !isFocused) || (hasSearch && !isMatched && !activeFocusId))

            ctx.save()
            ctx.globalAlpha = dimmed ? 0.18 : 1

            // Outer precision halo ring for index or focused nodes
            if (isSelected || isHovered || isMatched || n.slug === 'index') {
              ctx.beginPath()
              ctx.arc(n.x, n.y, n.radius + 7, 0, Math.PI * 2)
              ctx.strokeStyle = isDark ? 'rgba(244, 244, 245, 0.28)' : 'rgba(17, 17, 20, 0.22)'
              ctx.lineWidth = 1
              ctx.stroke()

              ctx.beginPath()
              ctx.arc(n.x, n.y, n.radius + 13, 0, Math.PI * 2)
              ctx.fillStyle = isDark ? 'rgba(244, 244, 245, 0.06)' : 'rgba(17, 17, 20, 0.04)'
              ctx.fill()
            }

            if (n.kind === 'wiki') {
              // Sculpted monochrome hub node
              ctx.beginPath()
              ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
              ctx.fillStyle = isDark ? tone.darkFill : tone.lightFill
              ctx.fill()
              ctx.lineWidth = isSelected || isHovered ? 2 : 1
              ctx.strokeStyle = isDark ? tone.darkStroke : tone.lightStroke
              ctx.stroke()

              // Subtle inner architectural core dot
              ctx.beginPath()
              ctx.arc(n.x, n.y, Math.max(2.2, n.radius * 0.3), 0, Math.PI * 2)
              ctx.fillStyle = isDark ? '#09090b' : '#fafafa'
              ctx.fill()
            } else {
              // Precision diamond / satellite ring for Schema entities
              ctx.beginPath()
              ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
              ctx.fillStyle = isDark ? '#0f0f12' : '#fafafa'
              ctx.fill()
              ctx.lineWidth = isFocused ? 1.6 : 1.15
              ctx.strokeStyle = isFocused
                ? isDark ? '#f4f4f5' : '#111114'
                : isDark ? 'rgba(212, 212, 216, 0.45)' : 'rgba(63, 63, 70, 0.45)'
              ctx.stroke()
            }

            const showLabel =
              n.kind === 'wiki' || isSelected || isHovered || isMatched || isNeighbor || cam.zoom >= 1.5
            if (showLabel) {
              const label = n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label
              ctx.font = `${n.kind === 'wiki' ? '500 11.5px' : '400 10px'} "Inter", "Segoe UI", "Microsoft YaHei", sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'top'
              const textY = n.y + n.radius + 8

              // Subtle text halo for legibility without clunky boxed pills
              ctx.lineWidth = 3.5
              ctx.strokeStyle = isDark ? 'rgba(15, 15, 18, 0.88)' : 'rgba(250, 250, 250, 0.9)'
              ctx.strokeText(label, n.x, textY)
              ctx.fillStyle =
                n.kind === 'wiki'
                  ? isDark ? '#f4f4f5' : '#111114'
                  : isDark ? '#a1a1aa' : '#52525b'
              ctx.fillText(label, n.x, textY)
            }
            ctx.restore()
          }

          ctx.restore()
          ctx.restore()
        }
      }
      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [filteredGraph.edges, adjacency, matchedIds, theme])

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = pickNodeAt(event.clientX, event.clientY)
    if (hit) {
      dragRef.current = {
        mode: 'node',
        nodeId: hit.id,
        startX: event.clientX,
        startY: event.clientY,
        camStartX: cameraRef.current.x,
        camStartY: cameraRef.current.y,
        moved: false
      }
    } else {
      dragRef.current = {
        mode: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        camStartX: cameraRef.current.x,
        camStartY: cameraRef.current.y,
        moved: false
      }
    }
  }

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (drag.mode === 'pan') {
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true
      cameraRef.current.x = drag.camStartX + dx
      cameraRef.current.y = drag.camStartY + dy
      return
    }
    if (drag.mode === 'node' && drag.nodeId) {
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true
      const world = screenToWorld(event.clientX, event.clientY)
      const target = nodeIndexRef.current.get(drag.nodeId)
      if (target) {
        target.x = world.x
        target.y = world.y
        target.vx = 0
        target.vy = 0
        energyRef.current = Math.max(energyRef.current, 0.2)
      }
      return
    }
    const hit = pickNodeAt(event.clientX, event.clientY)
    setHoveredId(hit?.id ?? null)
  }

  const handleMouseUp = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag.moved) {
      const hit = pickNodeAt(event.clientX, event.clientY)
      setSelectedId(hit?.id ?? null)
    }
    dragRef.current.mode = 'none'
  }

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.12 : 0.89
    cameraRef.current.zoom = Math.max(0.32, Math.min(2.6, cameraRef.current.zoom * factor))
  }

  const zoomBy = (factor: number) => {
    cameraRef.current.zoom = Math.max(0.32, Math.min(2.6, cameraRef.current.zoom * factor))
  }

  const resetCamera = () => {
    cameraRef.current = { x: 0, y: 0, zoom: simNodesRef.current.length > 50 ? 0.72 : 0.9 }
    energyRef.current = 0.45
  }

  return (
    <section className="graph-view">
      <div className="graph-toolbar">
        <div className="graph-toolbar-left">
          <div className="graph-search">
            <Search />
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder={tx('搜索节点或实体…', 'Filter nodes…')}
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} aria-label={tx('清空', 'Clear')}>
                <X />
              </button>
            )}
          </div>

          <div className="graph-domain-pills">
            <button
              className={`domain-pill ${domainFilter === 'all' ? 'active' : ''}`}
              onClick={() => setDomainFilter('all')}
            >
              {tx('全部', 'All')}
            </button>
            {FILTER_DOMAINS.map(dom => (
              <button
                key={dom}
                className={`domain-pill ${domainFilter === dom ? 'active' : ''}`}
                onClick={() => setDomainFilter(dom)}
              >
                {storageDomainLabel(dom, locale)}
              </button>
            ))}
          </div>
        </div>

        <div className="graph-toolbar-right">
          <button
            className={`btn-secondary btn-xs ${showEntities ? 'is-active' : ''}`}
            onClick={() => setShowEntities(prev => !prev)}
            title={tx('显示或隐藏实体卫星节点', 'Toggle entity nodes')}
          >
            {showEntities ? <Eye /> : <EyeOff />}
            {showEntities ? tx('含实体', 'Entities') : tx('仅百科', 'Wiki Only')}
          </button>
          <button className="icon-btn-sm" onClick={() => zoomBy(1.2)} title={tx('放大', 'Zoom In')}>
            <ZoomIn />
          </button>
          <button className="icon-btn-sm" onClick={() => zoomBy(0.82)} title={tx('缩小', 'Zoom Out')}>
            <ZoomOut />
          </button>
          <button className="icon-btn-sm" onClick={resetCamera} title={tx('重置视图', 'Reset View')}>
            <Maximize2 />
          </button>
          <button className="icon-btn-sm" onClick={onRefresh} title={tx('刷新图谱', 'Refresh Graph')}>
            <RefreshCw />
          </button>
        </div>
      </div>

      <div className="graph-stage" ref={containerRef}>
        {loading ? (
          <div className="graph-empty">
            <ZhixuIsoLoader size="lg" interactive />
            <span>{tx('正在构建知识星图…', 'Mapping constellation…')}</span>
          </div>
        ) : !data || filteredGraph.nodes.length === 0 ? (
          <div className="graph-empty">
            <Network />
            <h3>{tx('暂无可视化图谱节点', 'No Knowledge Graph nodes yet')}</h3>
            <p>{tx('导入文档并完成整理后，这里会呈现 Wiki 与 Schema 实体的星图网络。', 'Import documents and compile the Wiki to visualize your constellation here.')}</p>
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              className="graph-canvas"
              style={{ cursor: hoveredId ? 'pointer' : dragRef.current.mode === 'pan' ? 'grabbing' : 'grab' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                dragRef.current.mode = 'none'
                setHoveredId(null)
              }}
              onWheel={handleWheel}
            />

            <div className="graph-legend">
              <span><i className="legend-wiki" /> {tx('百科节点', 'Wiki Hub')}</span>
              <span><i className="legend-entity" /> {tx('实体节点', 'Entity')}</span>
              <span>{tx('拖拽 / 滚轮缩放 / 点击查看', 'Drag · Zoom · Inspect')}</span>
            </div>

            {selectedNode && (
              <aside className="graph-inspector">
                <div className="graph-inspector-head">
                  <span className="graph-node-tag mono">
                    {selectedNode.kind === 'wiki' ? <BookOpen /> : <Sparkles />}
                    {selectedNode.kind === 'wiki' ? tx('Wiki 页面', 'WIKI HUB') : tx('Schema 实体', 'ENTITY')}
                  </span>
                  <button className="icon-btn-sm" onClick={() => setSelectedId(null)} aria-label={tx('关闭', 'Close')}>
                    <X />
                  </button>
                </div>

                <h3>{selectedNode.label}</h3>

                <div className="graph-inspector-meta">
                  <span>{storageDomainLabel(selectedNode.storageDomain, locale)}</span>
                  {selectedNode.status && <span>{workflowStatusLabel(selectedNode.status, locale)}</span>}
                </div>

                {selectedNode.summary && <p className="graph-inspector-summary">{selectedNode.summary}</p>}

                {selectedNode.slug && (
                  <button className="btn-primary btn-sm btn-block" onClick={() => onOpenPage(selectedNode.slug!)}>
                    <ArrowUpRight />
                    {selectedNode.kind === 'wiki'
                      ? tx('打开页面', 'Open Page')
                      : tx('查看关联页面', 'Open Linked Page')}
                  </button>
                )}

                <div className="graph-neighbors">
                  <h4>
                    {tx('关联节点', 'Connections')} ({selectedNeighbors.length})
                  </h4>
                  {selectedNeighbors.length ? (
                    <div className="graph-neighbor-list">
                      {selectedNeighbors.slice(0, 14).map(nb => (
                        <button key={nb.id} className="graph-neighbor-row" onClick={() => focusNode(nb.id)}>
                          <i className={nb.kind === 'wiki' ? 'nb-dot-wiki' : 'nb-dot-entity'} />
                          <span>{nb.label}</span>
                          <small>{nb.kind === 'wiki' ? 'Wiki' : tx('实体', 'Entity')}</small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <small className="muted">{tx('当前范围内无连线', 'No links in current view')}</small>
                  )}
                </div>
              </aside>
            )}
          </>
        )}
      </div>
    </section>
  )
}
