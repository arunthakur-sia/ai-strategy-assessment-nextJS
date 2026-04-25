import PDFDocument from 'pdfkit'

const SIA_TEAL = '#00DECC'
const SIA_NAVY = '#173044'
const SIA_BLACK = '#0A151E'
const SIA_GRAY = '#8796A9'
const SIA_WHITE = '#FFFFFF'

const REPORT_TITLES: Record<string, string> = {
  D1: 'Strategic Perception & Hypothesis Report',
  D2: 'Strategic Diagnostic Report',
  D3: 'Benchmark & Opportunity Map',
  D4: 'AI Video Script',
  D5: 'Stakeholder Interview Questions',
  D6: 'Full Strategy Document',
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}

function scoreColor(score: number): string {
  if (score >= 3.5) return '#10B981'
  if (score >= 2.5) return '#F59E0B'
  return '#EF4444'
}

export function generatePdf(project: any, reportType: string, content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: REPORT_TITLES[reportType] || reportType, Author: 'SIA Partners', Subject: project.entityName } })

    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const pageWidth = doc.page.width
    const pageHeight = doc.page.height
    const margin = 50

    // ── COVER PAGE ──────────────────────────────────────────
    doc.rect(0, 0, pageWidth, pageHeight).fill(SIA_BLACK)

    // SIA/ logo
    doc.fontSize(36).font('Helvetica-Bold')
    doc.fillColor(SIA_WHITE).text('SIA', 50, 50, { continued: true })
    doc.fillColor(SIA_TEAL).text('/')

    // Teal accent line
    doc.rect(50, 115, pageWidth - 100, 2).fill(SIA_TEAL)

    // Report label
    doc.fontSize(11).font('Helvetica').fillColor(SIA_TEAL)
      .text(`STRATEGIC ASSESSMENT | ${reportType}`, 50, 130, { characterSpacing: 1.5 })

    // Report title
    doc.fontSize(30).font('Helvetica-Bold').fillColor(SIA_WHITE)
      .text(REPORT_TITLES[reportType] || reportType, 50, 165, { width: 480, lineGap: 4 })

    // Entity name
    doc.fontSize(18).font('Helvetica').fillColor(SIA_TEAL)
      .text(project.entityName, 50, 250)

    // Divider
    doc.rect(50, 285, pageWidth - 100, 1).fill(SIA_TEAL)

    // Consultant + date
    const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    doc.fontSize(11).font('Helvetica').fillColor(SIA_GRAY)
      .text(`${project.consultantName || 'SIA Partners'} | ${dateStr}`, 50, 300)

    // Bottom watermark
    doc.fontSize(10).fillColor(SIA_GRAY)
      .text('SIA Partners | Confidential', 50, pageHeight - 40, { width: pageWidth - 100, align: 'center' })

    // ── CONTENT PAGES ───────────────────────────────────────
    doc.addPage({ size: 'A4', margin: 0 })

    // Parse and render content
    const lines = content.split('\n')
    let y = 70
    const contentWidth = pageWidth - margin * 2

    function checkPageBreak(neededHeight = 40) {
      if (y + neededHeight > pageHeight - 60) {
        doc.addPage({ size: 'A4', margin: 0 })
        drawPageHeader(doc, REPORT_TITLES[reportType] || reportType, pageWidth)
        drawFooter(doc, pageWidth, pageHeight)
        y = 70
      }
    }

    function drawPageHeader(d: typeof doc, title: string, pw: number) {
      d.rect(0, 0, pw, 44).fill(SIA_NAVY)
      d.rect(0, 44, pw, 2).fill(SIA_TEAL)
      d.fontSize(14).font('Helvetica-Bold').fillColor(SIA_WHITE)
        .text(title, 24, 14, { width: pw - 48 })
      // SIA/ in top right
      d.fontSize(14).font('Helvetica-Bold')
      d.fillColor(SIA_WHITE).text('SIA', pw - 80, 14, { continued: true })
      d.fillColor(SIA_TEAL).text('/')
    }

    function drawFooter(d: typeof doc, pw: number, ph: number) {
      d.rect(margin, ph - 30, pw - margin * 2, 0.5).fill(SIA_GRAY)
      d.fontSize(9).font('Helvetica').fillColor(SIA_GRAY)
        .text('SIA Partners | Confidential', margin, ph - 22, { continued: true })
        .text(`  ${reportType}`, { align: 'right', width: pw - margin * 2 })
    }

    drawPageHeader(doc, REPORT_TITLES[reportType] || reportType, pageWidth)
    drawFooter(doc, pageWidth, pageHeight)

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) { y += 8; continue }

      // H1
      if (trimmed.startsWith('# ')) {
        checkPageBreak(50)
        // Teal left border accent
        doc.rect(margin, y - 2, 4, 22).fill(SIA_TEAL)
        doc.fontSize(18).font('Helvetica-Bold').fillColor(SIA_NAVY)
          .text(trimmed.slice(2), margin + 12, y, { width: contentWidth - 12 })
        y += 30
        continue
      }
      // H2
      if (trimmed.startsWith('## ')) {
        checkPageBreak(40)
        doc.rect(margin, y - 2, 4, 18).fill(SIA_TEAL)
        doc.fontSize(14).font('Helvetica-Bold').fillColor(SIA_NAVY)
          .text(trimmed.slice(3), margin + 12, y, { width: contentWidth - 12 })
        y += 24
        continue
      }
      // H3
      if (trimmed.startsWith('### ')) {
        checkPageBreak(30)
        doc.fontSize(12).font('Helvetica-Bold').fillColor(SIA_NAVY)
          .text(trimmed.slice(4), margin, y, { width: contentWidth })
        y += 18
        continue
      }
      // Table rows (simplified)
      if (trimmed.startsWith('|') && !trimmed.startsWith('|---')) {
        checkPageBreak(18)
        const cells = trimmed.split('|').filter(c => c.trim()).map(c => c.trim())
        const isHeader = trimmed.includes('---') || lines[lines.indexOf(line) + 1]?.includes('|---|')
        const cellWidth = Math.min(contentWidth / Math.max(cells.length, 1), 150)
        let cx = margin
        cells.forEach((cell, i) => {
          if (i === 0) doc.rect(cx, y, cellWidth, 16).fill(isHeader ? SIA_NAVY : (Math.floor(y / 16) % 2 === 0 ? '#F8FAFC' : SIA_WHITE)).stroke()
          doc.fontSize(9).font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
            .fillColor(isHeader ? SIA_WHITE : '#333333')
            .text(cell.substring(0, 30), cx + 3, y + 3, { width: cellWidth - 6, ellipsis: true })
          cx += cellWidth
        })
        y += 18
        continue
      }
      // Bullet points
      if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        checkPageBreak(20)
        const text = trimmed.slice(2)
        const cleanText = text.replace(/\*\*/g, '').replace(/\*/g, '')
        doc.circle(margin + 4, y + 5, 2.5).fill(SIA_TEAL)
        doc.fontSize(10).font('Helvetica').fillColor('#333333')
          .text(cleanText, margin + 14, y, { width: contentWidth - 14, lineGap: 2 })
        const textHeight = doc.heightOfString(cleanText, { width: contentWidth - 14 })
        y += Math.max(textHeight + 4, 16)
        continue
      }
      // Numbered lists
      if (/^\d+\.\s/.test(trimmed)) {
        checkPageBreak(20)
        const match = trimmed.match(/^(\d+)\.\s(.*)/)
        if (match) {
          doc.fontSize(10).font('Helvetica-Bold').fillColor(SIA_TEAL)
            .text(`${match[1]}.`, margin, y, { continued: true, width: 20 })
          const cleanText = match[2].replace(/\*\*/g, '').replace(/\*/g, '')
          doc.font('Helvetica').fillColor('#333333')
            .text(' ' + cleanText, { width: contentWidth - 20 })
          const textHeight = doc.heightOfString(cleanText, { width: contentWidth - 20 })
          y += Math.max(textHeight + 4, 16)
        }
        continue
      }
      // Bold text patterns like **label**: text
      if (trimmed.startsWith('**') && trimmed.includes('**')) {
        checkPageBreak(20)
        const boldMatch = trimmed.match(/^\*\*(.+?)\*\*(.*)/)
        if (boldMatch) {
          doc.fontSize(10).font('Helvetica-Bold').fillColor(SIA_NAVY)
            .text(boldMatch[1], margin, y, { continued: !!boldMatch[2] })
          if (boldMatch[2]) doc.font('Helvetica').fillColor('#333333').text(boldMatch[2])
          else doc.text('')
        } else {
          const cleanText = trimmed.replace(/\*\*/g, '').replace(/\*/g, '')
          doc.fontSize(10).font('Helvetica').fillColor('#333333')
            .text(cleanText, margin, y, { width: contentWidth })
        }
        y += 16
        continue
      }
      // Horizontal rule
      if (trimmed === '---' || trimmed === '***') {
        y += 4
        doc.rect(margin, y, contentWidth, 0.5).fill(SIA_GRAY)
        y += 10
        continue
      }
      // Regular paragraph text
      checkPageBreak(20)
      const cleanText = trimmed.replace(/\*\*/g, '').replace(/\*/g, '').replace(/_/g, '')
      if (!cleanText) continue
      doc.fontSize(10).font('Helvetica').fillColor('#333333')
        .text(cleanText, margin, y, { width: contentWidth, lineGap: 2 })
      const textHeight = doc.heightOfString(cleanText, { width: contentWidth })
      y += Math.max(textHeight + 6, 16)
    }

    // ── PILLAR SUMMARY PAGE ──────────────────────────────────
    const pillars = Object.entries(project.assessment.pillars || {}).filter(([, p]: any) => p.finalScore)
    if (pillars.length > 0) {
      doc.addPage({ size: 'A4', margin: 0 })
      drawPageHeader(doc, 'Pillar Score Summary', pageWidth)
      drawFooter(doc, pageWidth, pageHeight)
      doc.fontSize(14).font('Helvetica-Bold').fillColor(SIA_NAVY).text('Assessment Results', margin, 70)

      let cardY = 100
      const cardW = (contentWidth - 12) / 4
      pillars.forEach(([id, p]: any, i: number) => {
        const col = i % 4
        const row = Math.floor(i / 4)
        const cx = margin + col * (cardW + 4)
        const cy = cardY + row * 80
        const sc = scoreColor(p.finalScore)
        const [r, g, b] = hexToRgb(sc)
        doc.rect(cx, cy, cardW, 70).fill('#F8FAFC').stroke(SIA_NAVY)
        doc.fontSize(10).font('Helvetica-Bold').fillColor(SIA_NAVY).text(`${id}`, cx + 6, cy + 6)
        doc.fontSize(7).font('Helvetica').fillColor(SIA_GRAY).text(p.name.split(' ').slice(0, 3).join(' '), cx + 6, cy + 18, { width: cardW - 12 })
        doc.fontSize(22).font('Helvetica-Bold').fillColor(sc).text(p.finalScore.toFixed(1), cx + 6, cy + 32)
        doc.fontSize(8).font('Helvetica').fillColor(sc).text('/5', cx + 30, cy + 40)
      })
    }

    doc.end()
  })
}
