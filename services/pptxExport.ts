import PptxGenJS from 'pptxgenjs'

const SIA_TEAL = '00DECC'
const SIA_NAVY = '173044'
const SIA_BLACK = '0A151E'
const SIA_GRAY = '8796A9'
const SIA_WHITE = 'FFFFFF'

const REPORT_TITLES: Record<string, string> = {
  D1: 'Strategic Perception & Hypothesis Report',
  D2: 'Strategic Diagnostic Report',
  D3: 'Benchmark & Opportunity Map',
  D4: 'AI Video Script',
  D5: 'Stakeholder Interview Questions',
  D6: 'Full Strategy Document',
}

function scoreColor(score: number): string {
  if (score >= 3.5) return '10B981'
  if (score >= 2.5) return 'F59E0B'
  return 'EF4444'
}

function parseMarkdownToSlides(content: string): Array<{ title: string; bullets: string[]; isSection: boolean }> {
  const slides: Array<{ title: string; bullets: string[]; isSection: boolean }> = []
  const lines = content.split('\n')
  let currentSlide: { title: string; bullets: string[]; isSection: boolean } | null = null
  let bulletBuffer: string[] = []

  const flushSlide = () => {
    if (currentSlide && bulletBuffer.length > 0) {
      currentSlide.bullets = [...bulletBuffer]
      slides.push(currentSlide)
      bulletBuffer = []
    } else if (currentSlide) {
      slides.push(currentSlide)
    }
    currentSlide = null
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('## ')) {
      flushSlide()
      currentSlide = { title: trimmed.slice(3), bullets: [], isSection: false }
    } else if (trimmed.startsWith('# ')) {
      flushSlide()
      currentSlide = { title: trimmed.slice(2), bullets: [], isSection: true }
    } else if ((trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) && currentSlide) {
      bulletBuffer.push(trimmed.slice(2).replace(/\*\*/g, '').replace(/\*/g, ''))
      if (bulletBuffer.length >= 6) {
        const cs: { title: string; bullets: string[]; isSection: boolean } = currentSlide
        cs.bullets = [...bulletBuffer]
        slides.push({ ...cs })
        bulletBuffer = []
        currentSlide = { ...cs, bullets: [] }
      }
    } else if (trimmed && !trimmed.startsWith('|') && !trimmed.startsWith('---') && currentSlide) {
      const clean = trimmed.replace(/\*\*/g, '').replace(/\*/g, '')
      if (clean.length > 5) bulletBuffer.push(clean)
    }
  }
  flushSlide()
  return slides.filter(s => s.title)
}

export async function generatePptx(project: any, reportType: string, content: string): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'SIA Partners'
  pptx.subject = project.entityName
  pptx.title = REPORT_TITLES[reportType] || reportType

  // Master slide
  pptx.defineSlideMaster({
    title: 'SIA_MASTER',
    background: { color: SIA_WHITE },
    objects: [
      { rect: { x: 0, y: 0, w: '100%', h: 0.6, fill: { color: SIA_NAVY } } },
      { rect: { x: 0, y: 0.6, w: '100%', h: 0.04, fill: { color: SIA_TEAL } } },
      { text: { text: [{ text: 'SIA', options: { color: SIA_WHITE, bold: true } }, { text: '/', options: { color: SIA_TEAL, bold: true } }] as any, options: { x: 11.5, y: 0.1, w: 1.2, h: 0.4, fontSize: 18 } } },
      { rect: { x: 0, y: 6.9, w: '100%', h: 0.02, fill: { color: SIA_TEAL } } },
      { text: { text: 'SIA Partners | Confidential', options: { x: 0.3, y: 6.95, w: 6, h: 0.2, fontSize: 8, color: SIA_GRAY } } },
    ]
  })

  // ── TITLE SLIDE ──────────────────────────────────────────
  const titleSlide = pptx.addSlide()
  titleSlide.background = { color: SIA_BLACK }

  // SIA/ logo
  titleSlide.addText([
    { text: 'SIA', options: { color: SIA_WHITE, bold: true, fontSize: 36 } },
    { text: '/', options: { color: SIA_TEAL, bold: true, fontSize: 36 } }
  ], { x: 0.5, y: 0.4, w: 2, h: 0.8 })

  // Teal accent line
  titleSlide.addShape('rect' as any, { x: 0.5, y: 1.4, w: 12, h: 0.04, fill: { color: SIA_TEAL }, line: { color: SIA_TEAL } })

  // Report type label
  titleSlide.addText(`STRATEGIC ASSESSMENT | ${reportType}`, { x: 0.5, y: 1.6, w: 12, h: 0.3, fontSize: 12, color: SIA_TEAL, charSpacing: 1.5 })

  // Report title
  titleSlide.addText(REPORT_TITLES[reportType] || reportType, { x: 0.5, y: 2.0, w: 10, h: 1.4, fontSize: 36, color: SIA_WHITE, bold: true, wrap: true })

  // Entity name
  titleSlide.addText(project.entityName, { x: 0.5, y: 3.6, w: 10, h: 0.5, fontSize: 22, color: SIA_TEAL })

  // Divider
  titleSlide.addShape('rect' as any, { x: 0.5, y: 4.2, w: 12, h: 0.02, fill: { color: SIA_TEAL }, line: { color: SIA_TEAL } })

  // Date + consultant
  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  titleSlide.addText(`${project.consultantName || 'SIA Partners'} | ${dateStr}`, { x: 0.5, y: 4.4, w: 12, h: 0.3, fontSize: 12, color: SIA_GRAY })

  // Bottom
  titleSlide.addText('SIA Partners | Confidential', { x: 0.5, y: 6.8, w: 12, h: 0.3, fontSize: 10, color: SIA_GRAY, align: 'center' })

  // ── PILLAR SCORE SUMMARY SLIDE ────────────────────────────
  const pillars = Object.entries(project.assessment.pillars || {}).filter(([, p]: any) => p.finalScore)
  if (pillars.length > 0) {
    const scoreSlide = pptx.addSlide({ masterName: 'SIA_MASTER' })
    scoreSlide.addText('8-Pillar Assessment Results', { x: 0.3, y: 0.1, w: 11, h: 0.4, fontSize: 14, color: SIA_WHITE, bold: true })

    const cols = 4
    const cardW = 2.8
    const cardH = 1.4
    const startX = 0.3
    const startY = 0.8

    pillars.forEach(([id, p]: any, i: number) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const cx = startX + col * (cardW + 0.15)
      const cy = startY + row * (cardH + 0.15)
      const sc = scoreColor(p.finalScore)

      scoreSlide.addShape('roundRect' as any, { x: cx, y: cy, w: cardW, h: cardH, fill: { color: SIA_WHITE }, line: { color: SIA_NAVY, w: 1 } as any, rectRadius: 0.05 })
      scoreSlide.addText(id, { x: cx + 0.1, y: cy + 0.1, w: 0.8, h: 0.3, fontSize: 12, color: SIA_NAVY, bold: true })
      scoreSlide.addText(p.name.split(' ').slice(0, 3).join(' '), { x: cx + 0.1, y: cy + 0.35, w: cardW - 0.2, h: 0.3, fontSize: 8, color: SIA_GRAY, wrap: true })
      scoreSlide.addText(`${p.finalScore.toFixed(1)}/5`, { x: cx + 0.1, y: cy + 0.65, w: cardW - 0.2, h: 0.5, fontSize: 24, color: sc, bold: true })
      const ragLabel = p.finalScore >= 3.5 ? 'STRONG' : p.finalScore >= 2.5 ? 'DEVELOPING' : 'CRITICAL'
      scoreSlide.addText(ragLabel, { x: cx + 0.1, y: cy + 1.1, w: cardW - 0.2, h: 0.25, fontSize: 9, color: sc, bold: true })
    })
  }

  // ── CONTENT SLIDES ────────────────────────────────────────
  const contentSlides = parseMarkdownToSlides(content)
  for (const slide of contentSlides.slice(0, 30)) {
    if (slide.isSection) {
      // Section divider slide
      const sectionSlide = pptx.addSlide()
      sectionSlide.background = { color: SIA_NAVY }
      sectionSlide.addText(slide.title, { x: 0.8, y: 2.0, w: 11, h: 1.5, fontSize: 32, color: SIA_WHITE, bold: true, wrap: true })
      sectionSlide.addShape('rect' as any, { x: 0.8, y: 1.7, w: 3, h: 0.06, fill: { color: SIA_TEAL }, line: { color: SIA_TEAL } })
      sectionSlide.addText('SIA Partners | Strategic Assessment', { x: 0.8, y: 6.5, w: 10, h: 0.3, fontSize: 10, color: SIA_GRAY })
    } else {
      // Content slide
      const contentSlide = pptx.addSlide({ masterName: 'SIA_MASTER' })
      contentSlide.addText(slide.title.substring(0, 80), { x: 0.3, y: 0.1, w: 11, h: 0.4, fontSize: 14, color: SIA_WHITE, bold: true })

      if (slide.bullets.length > 0) {
        const bulletItems = slide.bullets.slice(0, 7).map(b => ({
          text: b.substring(0, 180),
          options: { bullet: { type: 'bullet', characterCode: '25CF', indent: 15, color: SIA_TEAL } as any, fontSize: 13, color: '333333', paraSpaceAfter: 6 }
        }))
        contentSlide.addText(bulletItems, { x: 0.4, y: 0.75, w: 12, h: 5.8, valign: 'top', wrap: true })
      }
    }
  }

  // Return as buffer
  const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  return pptxBuffer
}
