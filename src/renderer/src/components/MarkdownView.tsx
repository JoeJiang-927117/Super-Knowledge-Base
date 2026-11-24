import { marked } from 'marked'
import { useEffect, useRef, type MouseEvent } from 'react'

const allowedElements = [
  'p', 'br', 'hr', 'h2', 'h3', 'h4', 'strong', 'em', 'del', 'blockquote', 'code', 'pre',
  'ul', 'ol', 'li', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'
]
const allowedAttributes = ['href', 'class']
let purifyPromise: Promise<typeof import('dompurify')> | undefined

async function renderSanitized(element: HTMLElement, markdown: string): Promise<void> {
  const normalized = markdown
    .replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g, '[$2](#wiki/$1)')
    .replace(/\[\[([^\]|\n]+)\]\]/g, '[$1](#wiki/$1)')
    .replace(/\]\(wiki:([^\s)]+)\)/g, '](#wiki/$1)')
  const html = await marked.parse(normalized, { gfm: true, breaks: false })
  if ('setHTML' in Element.prototype) {
    const sanitizedElement = element as HTMLElement & {
      setHTML: (input: string, options: { sanitizer: Record<string, unknown> }) => void
    }
    sanitizedElement.setHTML(html, {
      sanitizer: {
        elements: allowedElements,
        attributes: allowedAttributes,
        replaceWithChildrenElements: ['div', 'span', 'section', 'article']
      }
    })
  } else {
    purifyPromise ??= import('dompurify')
    const DOMPurify = (await purifyPromise).default
    element.innerHTML = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [...allowedElements, '#text'],
      ALLOWED_ATTR: allowedAttributes,
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: false
    })
  }
}

type MarkdownViewProps = {
  content: string
  onNavigate: (slug: string) => void
}

export function MarkdownView({ content, onNavigate }: MarkdownViewProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current = true
    const element = ref.current
    if (!element) return
    void renderSanitized(element, content).catch(() => {
      if (current) element.textContent = content
    })
    return () => {
      current = false
    }
  }, [content])

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as Element).closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''
    if (href.startsWith('#wiki/')) {
      event.preventDefault()
      onNavigate(decodeURIComponent(href.slice(6)))
    } else if (!href.startsWith('#')) {
      event.preventDefault()
    }
  }

  return <div ref={ref} className="markdown-body" onClick={handleClick} />
}
