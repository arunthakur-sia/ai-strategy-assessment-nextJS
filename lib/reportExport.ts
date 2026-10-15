// Client-side renderers for an LLM-generated markdown report: .md as-is, .docx built from the markdown AST
// with the `docx` package, and PDF via the browser's print-to-PDF on a styled copy of the rendered report.
// The LLM only ever produces markdown — these never call it, so exporting is instant.

export interface ReportMeta { title: string; entityName: string; generatedAt?: string }

function fmtDate(iso?: string): string {
  return (iso ? new Date(iso) : new Date()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function reportFilename(meta: ReportMeta, ext: string): string {
  const slug = `${meta.entityName}-${meta.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  return `${slug || 'report'}.${ext}`
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadMarkdown(markdown: string, meta: ReportMeta) {
  saveBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), reportFilename(meta, 'md'))
}

// ── PDF ───────────────────────────────────────────────────────────────────────────────────────────
// Built from the markdown AST with pdfmake (real vector text, selectable, page-numbered) and downloaded
// directly — no print dialog. Roboto only: non-Latin scripts (e.g. Arabic) aren't covered by this font.
export async function downloadPdf(markdown: string, meta: ReportMeta) {
  const [{ unified }, { default: remarkParse }, { default: remarkGfm }, pdfMakeMod, vfsMod] = await Promise.all([
    import('unified'), import('remark-parse'), import('remark-gfm'),
    import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts'),
  ])
  const pdfMake: any = (pdfMakeMod as any).default ?? pdfMakeMod
  const vfs: any = (vfsMod as any).default ?? vfsMod
  pdfMake.vfs = vfs.pdfMake?.vfs ?? vfs
  const tree: any = unified().use(remarkParse).use(remarkGfm).parse(markdown)

  const NAVY = '#1B2A4A', GOLD = '#C9A95E', GREY = '#7B8A9A'
  const HSIZE = [20, 16, 14, 12, 11, 11]

  function inline(nodes: any[], st: any = {}): any[] {
    const out: any[] = []
    for (const n of nodes || []) {
      switch (n.type) {
        case 'text': out.push({ text: n.value, ...st }); break
        case 'strong': out.push(...inline(n.children, { ...st, bold: true })); break
        case 'emphasis': out.push(...inline(n.children, { ...st, italics: true })); break
        case 'delete': out.push(...inline(n.children, { ...st, decoration: 'lineThrough' })); break
        case 'inlineCode': out.push({ text: n.value, ...st, background: '#F1F5F9', color: NAVY }); break
        case 'break': out.push({ text: '\n' }); break
        case 'link': out.push(...inline(n.children, { ...st, link: n.url, color: '#0563C1', decoration: 'underline' })); break
        default: if (n.children) out.push(...inline(n.children, st)); else if (n.value) out.push({ text: n.value, ...st })
      }
    }
    return out
  }

  function block(n: any): any[] {
    switch (n.type) {
      case 'heading': {
        const d = Math.min(n.depth, 6)
        return [{
          text: inline(n.children), fontSize: HSIZE[d - 1], bold: true, color: NAVY,
          margin: [0, d === 1 ? 14 : 12, 0, 6], headlineLevel: d,
          ...(d <= 2 ? {} : {}),
        }, ...(d <= 2 ? [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: d === 1 ? 1.5 : 0.5, lineColor: d === 1 ? GOLD : '#E8ECEF' }], margin: [0, -2, 0, 8] }] : [])]
      }
      case 'paragraph': return [{ text: inline(n.children), margin: [0, 0, 0, 7], lineHeight: 1.25 }]
      case 'list': {
        const items = n.children.map((item: any) => {
          const parts = item.children.flatMap((c: any) => block(c))
          return parts.length === 1 && parts[0].text ? { text: parts[0].text, margin: [0, 0, 0, 2] } : { stack: parts }
        })
        return [n.ordered ? { ol: items, margin: [0, 0, 0, 7] } : { ul: items, margin: [0, 0, 0, 7] }]
      }
      case 'blockquote':
        return [{
          table: { widths: ['*'], body: [[{ stack: n.children.flatMap((c: any) => block(c)), fillColor: '#EEF1F7', margin: [8, 4, 8, 0] }]] },
          layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 3 : 0), vLineColor: () => NAVY },
          margin: [0, 4, 0, 8],
        }]
      case 'code':
        return [{ text: String(n.value), fontSize: 9, background: '#F1F5F9', preserveLeadingSpaces: true, margin: [0, 0, 0, 8] }]
      case 'thematicBreak':
        return [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#E8ECEF' }], margin: [0, 6, 0, 8] }]
      case 'table': {
        const rows: any[] = n.children
        const cols = Math.max(...rows.map(r => r.children.length))
        const body = rows.map((r, ri) => Array.from({ length: cols }, (_, ci) => ({
          text: inline(r.children[ci]?.children || [], ri === 0 ? { bold: true, color: '#FFFFFF' } : {}),
          fillColor: ri === 0 ? NAVY : ri % 2 === 0 ? '#F8FAFB' : undefined, fontSize: 9, margin: [2, 2, 2, 2],
        })))
        return [{
          table: { headerRows: 1, widths: Array(cols).fill('*'), body, dontBreakRows: true },
          layout: { hLineColor: () => '#E8ECEF', vLineWidth: () => 0, hLineWidth: () => 0.5 },
          margin: [0, 4, 0, 10],
        }]
      }
      default: return n.children ? n.children.flatMap((c: any) => block(c)) : []
    }
  }

  const content = [
    { text: `${meta.entityName.toUpperCase()}  ·  SIA PARTNERS`, fontSize: 9, bold: true, color: GOLD },
    { text: meta.title, fontSize: 22, bold: true, color: NAVY, margin: [0, 4, 0, 4] },
    { text: `Confidential · Generated ${fmtDate(meta.generatedAt)}`, fontSize: 9, color: GREY },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: GOLD }], margin: [0, 8, 0, 14] },
    ...tree.children.flatMap((n: any) => block(n)),
  ]

  const docDefinition: any = {
    pageSize: 'A4', pageMargins: [40, 50, 40, 55],
    info: { title: meta.title, author: 'SIA Partners' },
    defaultStyle: { font: 'Roboto', fontSize: 10.5, color: '#2D3748' },
    content,
    footer: (page: number, pages: number) => ({
      columns: [
        { text: 'SIA Partners — Strategy Assessment Platform · Confidential', fontSize: 8, color: GREY },
        { text: `Page ${page} of ${pages}`, alignment: 'right', fontSize: 8, color: GREY },
      ], margin: [40, 18, 40, 0],
    }),
  }
  pdfMake.createPdf(docDefinition).download(reportFilename(meta, 'pdf'))
}

// ── DOCX ──────────────────────────────────────────────────────────────────────────────────────────
export async function downloadDocx(markdown: string, meta: ReportMeta) {
  const [{ unified }, { default: remarkParse }, { default: remarkGfm }, docx] = await Promise.all([
    import('unified'), import('remark-parse'), import('remark-gfm'), import('docx'),
  ])
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType,
    BorderStyle, ExternalHyperlink, AlignmentType, Footer, PageNumber, LevelFormat,
  } = docx
  const tree: any = unified().use(remarkParse).use(remarkGfm).parse(markdown)

  const NAVY = '1B2A4A'
  type Style = { bold?: boolean; italics?: boolean; strike?: boolean; color?: string }

  function inline(nodes: any[], st: Style = {}): any[] {
    const out: any[] = []
    for (const n of nodes || []) {
      switch (n.type) {
        case 'text': out.push(new TextRun({ text: n.value, bold: st.bold, italics: st.italics, strike: st.strike, color: st.color })); break
        case 'strong': out.push(...inline(n.children, { ...st, bold: true })); break
        case 'emphasis': out.push(...inline(n.children, { ...st, italics: true })); break
        case 'delete': out.push(...inline(n.children, { ...st, strike: true })); break
        case 'inlineCode': out.push(new TextRun({ text: n.value, font: 'Consolas', bold: st.bold, color: st.color })); break
        case 'break': out.push(new TextRun({ break: 1 })); break
        case 'link': out.push(new ExternalHyperlink({ link: n.url, children: inline(n.children, { ...st, color: '0563C1' }) as any })); break
        default: if (n.children) out.push(...inline(n.children, st)); else if (n.value) out.push(new TextRun({ text: n.value }))
      }
    }
    return out
  }

  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
  // Each ordered list gets its own numbering instance so its count restarts at 1.
  let orderedInstance = 0

  function block(n: any, ctx: { level?: number; quote?: boolean } = {}): any[] {
    switch (n.type) {
      case 'heading':
        return [new Paragraph({ heading: HEADINGS[Math.min(n.depth, 6) - 1], children: inline(n.children), spacing: { before: 280, after: 120 } })]
      case 'paragraph':
        return [new Paragraph({
          children: inline(n.children), spacing: { after: 120 },
          ...(ctx.quote ? { indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: NAVY, space: 8 } } } : {}),
        })]
      case 'list': {
        const level = Math.min(ctx.level ?? 0, 8)
        const instance = n.ordered ? ++orderedInstance : 0
        return n.children.flatMap((item: any) => item.children.flatMap((c: any, i: number) => {
          if (c.type === 'list') return block(c, { ...ctx, level: level + 1 })
          if (c.type === 'paragraph' && i === 0) {
            return [new Paragraph({
              children: inline(c.children), spacing: { after: 60 },
              ...(n.ordered ? { numbering: { reference: 'sia-numbered', level, instance } } : { bullet: { level } }),
            })]
          }
          return block(c, ctx)
        }))
      }
      case 'blockquote': return n.children.flatMap((c: any) => block(c, { ...ctx, quote: true }))
      case 'code':
        return String(n.value).split('\n').map((line: string) => new Paragraph({
          children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 20 })],
          shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' }, spacing: { after: 0 },
        }))
      case 'thematicBreak':
        return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E8ECEF', space: 1 } }, spacing: { after: 160 } })]
      case 'table': {
        const rows: any[] = n.children
        const cols = Math.max(...rows.map(r => r.children.length))
        return [new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map((r, ri) => new TableRow({
            tableHeader: ri === 0, cantSplit: true,
            children: Array.from({ length: cols }, (_, ci) => {
              const header = ri === 0
              return new TableCell({
                shading: header ? { type: ShadingType.CLEAR, fill: NAVY } : ri % 2 === 0 ? { type: ShadingType.CLEAR, fill: 'F8FAFB' } : undefined,
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                children: [new Paragraph({ children: inline(r.children[ci]?.children || [], header ? { bold: true, color: 'FFFFFF' } : {}) })],
              })
            }),
          })),
        }), new Paragraph({ text: '', spacing: { after: 120 } })]
      }
      default:
        return n.children ? n.children.flatMap((c: any) => block(c, ctx)) : []
    }
  }

  const body: any[] = tree.children.flatMap((n: any) => block(n))

  const doc = new Document({
    creator: 'SIA Partners', title: meta.title,
    numbering: { config: [{ reference: 'sia-numbered', levels: Array.from({ length: 9 }, (_, i) => ({
      level: i, format: LevelFormat.DECIMAL, text: `%${i + 1}.`, alignment: AlignmentType.START,
      style: { paragraph: { indent: { left: 720 + i * 360, hanging: 360 } } },
    })) }] },
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: 'SIA Partners — Confidential  ·  Page ', size: 16, color: '7B8A9A' }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '7B8A9A' }),
      ] })] }) },
      children: [
        new Paragraph({ children: [new TextRun({ text: `${meta.entityName.toUpperCase()}  ·  SIA PARTNERS`, bold: true, size: 18, color: 'C9A95E' })] }),
        new Paragraph({ children: [new TextRun({ text: meta.title, bold: true, size: 44, color: NAVY })], spacing: { after: 80 } }),
        new Paragraph({
          children: [new TextRun({ text: `Confidential · Generated ${fmtDate(meta.generatedAt)}`, size: 18, color: '7B8A9A' })], spacing: { after: 320 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: 'C9A95E', space: 6 } },
        }),
        ...body,
      ],
    }],
  })
  saveBlob(await Packer.toBlob(doc), reportFilename(meta, 'docx'))
}
