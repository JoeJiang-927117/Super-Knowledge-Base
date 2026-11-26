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

const DOMAIN_COLORS: Record<StorageDomain, { fill: string; stroke: string; glow: string }> = {
  foundation: { fill: '#2563EB', stroke: '#60A5FA', glow: 'rgba(37, 99, 235, 0.28)' },
  domain_knowledge: { fill: '#7C3AED', stroke: '#A78BFA', glow: 'rgba(124, 58, 237, 0.28)' },
  cases: { fill: '#059669', stroke: '#34D399', glow: 'rgba(5, 150, 105, 0.28)' },
  concrete_media: { fill: '#D97706', stroke: '#FBBF24', glow: 'rgba(217, 119, 6, 0.28)' },
  permissions: { fill: '#DC2626', stroke: '#F87171', glow: 'rgba(220, 38, 38, 0.28)' },
  versions: { fill: '#0891B2', stroke: '#22D3EE', glow: 'rgba(8, 145, 178, 0.28)' }
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
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 })
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

  // Filter graph nodes & edges based on UI filters
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

  // Initialize deterministic radial layout whenever filtered graph changes
  useEffect(() => {
    const wikiNodes = filteredGraph.nodes.filter(n => n.kind === 'wiki')
    const entityNodes = filteredGraph.nodes.filter(n => n.kind === 'entity')
    const nextNodes: SimNode[] = []
    const idxMap = new Map<string, SimNode>()

    const wikiRadius = Math.max(120, Math.min(280, wikiNodes.length * 14))
    wikiNodes.forEach((n, i) => {
      const isIndex = n.slug === 'index'
      const angle = (i / Math.max(1, wikiNodes.length)) * Math.PI * 2
      const r = isIndex ? 0 : wikiRadius
      const node: SimNode = {
        ...n,
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        radius: isIndex ? 18 : Math.min(16, 9 + Math.sqrt(Math.max(1, n.degree)) * 1.6)
      }
      nextNodes.push(node)
      idxMap.set(node.id, node)
    })

    const entRadius = wikiRadius + 150
    entityNodes.forEach((n, i) => {
      const angle = (i / Math.max(1, entityNodes.length)) * Math.PI * 2 + 0.27
      const jitter = ((i * 73) % 90) - 45
      const node: SimNode = {
        ...n,
        x: Math.cos(angle) * (entRadius + jitter),
        y: Math.sin(angle) * (entRadius + jitter),
        vx: 0,
        vy: 0,
        radius: Math.min(10, 4.5 + Math.sqrt(Math.max(1, n.chunkCount ?? 1)) * 0.7)
      }
      nextNodes.push(node)
      idxMap.set(node.id, node)
    })

    simNodesRef.current = nextNodes
    nodeIndexRef.current = idxMap
    energyRef.current = 1.0
    cameraRef.current = { x: 0, y: 0, zoom: nextNodes.length > 60 ? 0.78 : 0.96 }
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
        const hitR = Math.max(n.radius + 5, 10)
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
    const zoom = Math.max(cameraRef.current.zoom, 1.15)
    cameraRef.current = { x: -target.x * zoom, y: -target.y * zoom, zoom }
    energyRef.current = Math.max(energyRef.current, 0.08)
  }, [])

  // Auto-center when search matches exactly 1–3 nodes
  useEffect(() => {
    if (matchedIds.size > 0 && matchedIds.size <= 3) {
      const firstId = [...matchedIds][0]
      const target = nodeIndexRef.current.get(firstId)
      if (target) {
        const zoom = Math.max(cameraRef.current.zoom, 1.1)
        cameraRef.current = { x: -target.x * zoom, y: -target.y * zoom, zoom }
      }
    }
  }, [matchedIds])

  // Force simulation + high-DPI Canvas render loop
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

        // Run damped physics while active
        if (energyRef.current > 0.008 && nodes.length > 0) {
          const kRepel = nodes.length > 70 ? 2200 : 3200
          const damping = 0.84
          const gravity = 0.012

          for (let i = 0; i < nodes.length; i += 1) {
            const a = nodes[i]
            if (dragRef.current.mode === 'node' && dragRef.current.nodeId === a.id) continue
            let fx = -a.x * gravity
            let fy = -a.y * gravity

            for (let j = i + 1; j < nodes.length; j += 1) {
              const b = nodes[j]
              let dx = a.x - b.x
              let dy = a.y - b.y
              let distSq = dx * dx + dy * dy + 24
              if (distSq > 180_000) continue
              const dist = Math.sqrt(distSq)
              const force = kRepel / distSq
              const ux = (dx / dist) * force
              const uy = (dy / dist) * force
              fx += ux
              fy += uy
              if (!(dragRef.current.mode === 'node' && dragRef.current.nodeId === b.id)) {
                b.vx -= ux * 0.08
                b.vy -= uy * 0.08
              }
            }
            a.vx = (a.vx + fx * 0.08) * damping
            a.vy = (a.vy + fy * 0.08) * damping
          }

          // Spring forces along edges
          for (const edge of edges) {
            const s = idxMap.get(edge.source)
            const t = idxMap.get(edge.target)
            if (!s || !t) continue
            const dx = t.x - s.x
            const dy = t.y - s.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const restLen = edge.relation === 'wikilink' ? 145 : 92
            const spring = (dist - restLen) * (edge.relation === 'wikilink' ? 0.018 : 0.024)
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
            n.x += Math.max(-14, Math.min(14, n.vx))
            n.y += Math.max(-14, Math.min(14, n.vy))
          }

          energyRef.current *= 0.985
        }

        // Draw frame
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.save()
          ctx.scale(dpr, dpr)
          ctx.clearRect(0, 0, w, h)

          // Subtle technical dot grid background
          const cam = cameraRef.current
          const gridStep = 34 * cam.zoom
          if (gridStep >= 14) {
            const ox = ((w / 2 + cam.x) % gridStep + gridStep) % gridStep
            const oy = ((h / 2 + cam.y) % gridStep + gridStep) % gridStep
            ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.07)'
            for (let gx = ox; gx < w; gx += gridStep) {
              for (let gy = oy; gy < h; gy += gridStep) {
                ctx.fillRect(gx, gy, 1.3, 1.3)
              }
            }
          }

          ctx.translate(w / 2 + cam.x, h / 2 + cam.y)
          ctx.scale(cam.zoom, cam.zoom)

          const activeFocusId = hoveredRef.current ?? selectedRef.current
          const activeNeighbors = activeFocusId ? adjacency.get(activeFocusId) : null
          const hasSearch = matchedIds.size > 0

          // 1. Draw Edges
          for (const edge of edges) {
            const s = idxMap.get(edge.source)
            const t = idxMap.get(edge.target)
            if (!s || !t) continue
            const isHighlighted =
              activeFocusId && (edge.source === activeFocusId || edge.target === activeFocusId)
            const dimmed = Boolean(activeFocusId && !isHighlighted)

            ctx.beginPath()
            ctx.moveTo(s.x, s.y)
            ctx.lineTo(t.x, t.y)
            if (isHighlighted) {
              ctx.strokeStyle = isDark ? 'rgba(96, 165, 250, 0.78)' : 'rgba(37, 99, 235, 0.72)'
              ctx.lineWidth = edge.relation === 'wikilink' ? 2.1 : 1.5
            } else if (edge.relation === 'wikilink') {
              ctx.strokeStyle = dimmed
                ? isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(100, 116, 139, 0.08)'
                : isDark ? 'rgba(148, 163, 184, 0.34)' : 'rgba(100, 116, 139, 0.34)'
              ctx.lineWidth = 1.25
            } else {
              ctx.strokeStyle = dimmed
                ? isDark ? 'rgba(148, 163, 184, 0.04)' : 'rgba(100, 116, 139, 0.05)'
                : isDark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(100, 116, 139, 0.18)'
              ctx.lineWidth = 0.85
            }
            ctx.stroke()
          }

          // 2. Draw Nodes
          for (const n of nodes) {
            const palette = DOMAIN_COLORS[n.storageDomain] ?? DOMAIN_COLORS.foundation
            const isSelected = n.id === selectedRef.current
            const isHovered = n.id === hoveredRef.current
            const isNeighbor = Boolean(activeNeighbors?.has(n.id))
            const isMatched = matchedIds.has(n.id)
            const isFocused = isSelected || isHovered || isNeighbor || isMatched
            const dimmed = Boolean((activeFocusId && !isFocused) || (hasSearch && !isMatched && !activeFocusId))

            ctx.save()
            ctx.globalAlpha = dimmed ? 0.22 : 1

            // Glow halo for wiki hubs or focused nodes
            if (isSelected || isHovered || isMatched || n.slug === 'index') {
              ctx.beginPath()
              ctx.arc(n.x, n.y, n.radius + 7, 0, Math.PI * 2)
              ctx.fillStyle = palette.glow
              ctx.fill()
            }

            ctx.beginPath()
            ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
            ctx.fillStyle = n.kind === 'wiki' ? palette.fill : isDark ? '#1E293B' : '#FFFFFF'
            ctx.fill()
            ctx.lineWidth = n.kind === 'wiki' ? (isSelected || isHovered ? 2.6 : 1.6) : 1.8
            ctx.strokeStyle = isSelected || isHovered ? '#FFFFFF' : palette.stroke
            ctx.stroke()

            // Crisp readable labels for Wiki pages, focused nodes, or zoomed-in entities
            const showLabel =
              n.kind === 'wiki' || isSelected || isHovered || isMatched || isNeighbor || cam.zoom >= 1.45
            if (showLabel) {
              const label = n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label
              ctx.font = `${n.kind === 'wiki' ? '600 11.5px' : '500 10px'} "Inter", "Segoe UI", "Microsoft YaHei", sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'top'
              const textY = n.y + n.radius + 5
              const metrics = ctx.measureText(label)
              const padX = 5
              const boxW = metrics.width + padX * 2
              const boxH = n.kind === 'wiki' ? 17 : 15

              ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.84)' : 'rgba(255, 255, 255, 0.88)'
              ctx.beginPath()
              ctx.roundRect(n.x - boxW / 2, textY - 2, boxW, boxH, 5)
              ctx.fill()

              ctx.fillStyle = isDark ? '#F1F5F9' : '#0F172A'
              ctx.fillText(label, n.x, textY)
            }
            ctx.restore()
          }

          ctx.restore()
        }
      }
      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [filteredGraph.edges, adjacency, matchedIds, theme])

  // Pointer & wheel interactions
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
        energyRef.current = Math.max(energyRef.current, 0.22)
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
    const nextZoom = Math.max(0.32, Math.min(2.8, cameraRef.current.zoom * factor))
    cameraRef.current.zoom = nextZoom
  }

  const zoomBy = (factor: number) => {
    cameraRef.current.zoom = Math.max(0.32, Math.min(2.8, cameraRef.current.zoom * factor))
  }

  const resetCamera = () => {
    cameraRef.current = { x: 0, y: 0, zoom: simNodesRef.current.length > 60 ? 0.78 : 0.96 }
    energyRef.current = 0.5
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
              placeholder={tx('搜索 Wiki 页面或 Schema 实体…', 'Search Wiki pages or Schema entities…')}
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
              {tx('全部域', 'All Domains')}
            </button>
            {FILTER_DOMAINS.map(dom => (
              <button
                key={dom}
                className={`domain-pill ${domainFilter === dom ? 'active' : ''}`}
                onClick={() => setDomainFilter(dom)}
              >
                <i style={{ background: DOMAIN_COLORS[dom].fill }} />
                {storageDomainLabel(dom, locale)}
              </button>
            ))}
          </div>
        </div>

        <div className="graph-toolbar-right">
          {data && (
            <span className="graph-stats-badge">
              <Network />
              {data.totalWikiPages} Wiki · {data.totalEntities} {tx('实体', 'Entities')} · {data.totalMutualLinks}{' '}
              {tx('互索引', 'Links')}
            </span>
          )}
          <button
            className={`btn-secondary btn-xs ${showEntities ? 'active' : ''}`}
            onClick={() => setShowEntities(prev => !prev)}
            title={tx('显示或隐藏 Schema 实体节点', 'Toggle Schema entity nodes')}
          >
            {showEntities ? <Eye /> : <EyeOff />}
            {showEntities ? tx('含实体节点', 'With Entities') : tx('仅 Wiki 页面', 'Wiki Only')}
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
            <span>{tx('正在构建知识图谱与双向互索引…', 'Building Knowledge Graph & Mutual Index…')}</span>
          </div>
        ) : !data || filteredGraph.nodes.length === 0 ? (
          <div className="graph-empty">
            <Network />
            <h3>{tx('暂无可视化图谱节点', 'No Knowledge Graph nodes yet')}</h3>
            <p>{tx('导入文档并完成一次知识整理后，这里会自动呈现 Wiki 页面与 Schema 实体的关联网络。', 'Import documents and compile the Wiki to visualize pages, Schema entities, and mutual-index connections here.')}</p>
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
              <span><i className="legend-wiki" /> {tx('实心圆 = Wiki 知识页', 'Solid = Wiki Page')}</span>
              <span><i className="legend-entity" /> {tx('空心圆 = Schema 实体', 'Ring = Schema Entity')}</span>
              <span>{tx('拖拽节点 / 滚轮缩放 / 点击查看详情', 'Drag nodes · Wheel to zoom · Click to inspect')}</span>
            </div>

            {selectedNode && (
              <aside className="graph-inspector">
                <div className="graph-inspector-head">
                  <span
                    className="graph-node-tag"
                    style={{
                      background: `${DOMAIN_COLORS[selectedNode.storageDomain]?.fill ?? '#2563EB'}1A`,
                      color: DOMAIN_COLORS[selectedNode.storageDomain]?.fill ?? '#2563EB'
                    }}
                  >
                    {selectedNode.kind === 'wiki' ? <BookOpen /> : <Sparkles />}
                    {selectedNode.kind === 'wiki' ? tx('Wiki 页面', 'Wiki Page') : tx('Schema 实体', 'Schema Entity')}
                  </span>
                  <button className="icon-btn-sm" onClick={() => setSelectedId(null)} aria-label={tx('关闭', 'Close')}>
                    <X />
                  </button>
                </div>

                <h3>{selectedNode.label}</h3>

                <div className="graph-inspector-meta">
                  <span>{storageDomainLabel(selectedNode.storageDomain, locale)}</span>
                  {selectedNode.status && <span>{workflowStatusLabel(selectedNode.status, locale)}</span>}
                  <span>
                    {selectedNode.kind === 'wiki'
                      ? `${selectedNode.chunkCount ?? 0} ${tx('条来源', 'sources')}`
                      : `${selectedNode.chunkCount ?? 0} ${tx('个关联切片', 'chunks')}`}
                  </span>
                </div>

                {selectedNode.summary && <p className="graph-inspector-summary">{selectedNode.summary}</p>}

                {selectedNode.slug && (
                  <button className="btn-primary btn-sm btn-block" onClick={() => onOpenPage(selectedNode.slug!)}>
                    <ArrowUpRight />
                    {selectedNode.kind === 'wiki'
                      ? tx('打开此 Wiki 页面', 'Open Wiki Page')
                      : tx('跳转到关联 Wiki 页', 'Jump to Linked Wiki Page')}
                  </button>
                )}

                <div className="graph-neighbors">
                  <h4>
                    {tx('关联节点', 'Connected Nodes')} ({selectedNeighbors.length})
                  </h4>
                  {selectedNeighbors.length ? (
                    <div className="graph-neighbor-list">
                      {selectedNeighbors.slice(0, 18).map(nb => (
                        <button key={nb.id} className="graph-neighbor-row" onClick={() => focusNode(nb.id)}>
                          <i style={{ background: DOMAIN_COLORS[nb.storageDomain]?.fill ?? '#2563EB' }} />
                          <span>{nb.label}</span>
                          <small>{nb.kind === 'wiki' ? 'Wiki' : tx('实体', 'Entity')}</small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <small className="muted">{tx('当前筛选范围内无直接连线', 'No direct links in current filter')}</small>
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
