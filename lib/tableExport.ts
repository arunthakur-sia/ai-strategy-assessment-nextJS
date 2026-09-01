// Client-side export helpers for markdown tables rendered in chat/report responses.
// CSV, Excel and PNG all derive from one canonical `tableToRows` extraction, so the
// three exports can never disagree with each other about what the table contains.

export function tableToRows(table: HTMLTableElement): string[][] {
  return Array.from(table.rows).map(row =>
    Array.from(row.cells).map(cell => (cell.innerText ?? cell.textContent ?? '').trim())
  )
}

function csvFromRows(rows: string[][]): string {
  return rows
    .map(row =>
      row
        .map(cell => {
          const needsQuoting = /[",\n\r]/.test(cell)
          const escaped = cell.replace(/"/g, '""')
          return needsQuoting ? `"${escaped}"` : escaped
        })
        .join(',')
    )
    .join('\r\n')
}

export async function copyTableAsCSV(table: HTMLTableElement): Promise<void> {
  const csv = csvFromRows(tableToRows(table))
  await navigator.clipboard.writeText(csv)
}

export async function downloadTableAsExcel(table: HTMLTableElement, filename = 'table.xlsx'): Promise<void> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet(tableToRows(table))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Table')
  XLSX.writeFile(wb, filename)
}

// ── PNG export ───────────────────────────────────────────────────────────────
// Drawn by hand on a detached <canvas>, never attached to the page — deliberately not a
// DOM screenshot (html2canvas et al). A screenshot only captures what's currently painted,
// so a table sitting inside a horizontally-scrolling wrapper (wide tables need one so they
// don't blow out the chat bubble/report layout) gets cropped to whatever's in view. Drawing
// from the same `tableToRows` data CSV/Excel use has no such dependency on layout or scroll
// position, at the cost of the PNG's styling being a hand-coded approximation rather than a
// pixel-perfect copy of the on-screen CSS.
const PNG_SCALE = 2
const PNG_PADDING = 10
const PNG_LINE_HEIGHT = 18
const PNG_MIN_ROW_HEIGHT = 32
const PNG_MIN_COL_WIDTH = 60
const PNG_FONT = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
const PNG_HEADER_FONT = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
const PNG_HEADER_BG = '#1B2A4A'
const PNG_HEADER_TEXT = '#ffffff'
const PNG_BODY_TEXT = '#1B2A4A'
const PNG_ROW_ALT_BG = '#F8FAFB'
const PNG_BORDER = '#E8ECEF'

function measureColumnWidths(ctx: CanvasRenderingContext2D, rows: string[][]): number[] {
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const widths = new Array(colCount).fill(PNG_MIN_COL_WIDTH)
  rows.forEach((row, rowIdx) => {
    ctx.font = rowIdx === 0 ? PNG_HEADER_FONT : PNG_FONT
    row.forEach((cell, colIdx) => {
      const widest = cell.split('\n').reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0)
      widths[colIdx] = Math.max(widths[colIdx], widest + PNG_PADDING * 2)
    })
  })
  return widths
}

async function rowsToPNGBlob(rows: string[][]): Promise<Blob | null> {
  if (rows.length === 0) return null

  const measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return null

  const colWidths = measureColumnWidths(measureCtx, rows)
  const rowHeights = rows.map(row => {
    const maxLines = row.reduce((max, cell) => Math.max(max, cell.split('\n').length), 1)
    return Math.max(PNG_MIN_ROW_HEIGHT, maxLines * PNG_LINE_HEIGHT + PNG_PADDING * 2)
  })

  const width = colWidths.reduce((a, b) => a + b, 0)
  const height = rowHeights.reduce((a, b) => a + b, 0)

  const canvas = document.createElement('canvas')
  canvas.width = width * PNG_SCALE
  canvas.height = height * PNG_SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(PNG_SCALE, PNG_SCALE)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  let y = 0
  rows.forEach((row, rowIdx) => {
    const isHeader = rowIdx === 0
    const rowH = rowHeights[rowIdx]

    ctx.fillStyle = isHeader ? PNG_HEADER_BG : (rowIdx % 2 === 0 ? '#ffffff' : PNG_ROW_ALT_BG)
    ctx.fillRect(0, y, width, rowH)

    let x = 0
    row.forEach((cell, colIdx) => {
      const colW = colWidths[colIdx] ?? PNG_MIN_COL_WIDTH
      ctx.fillStyle = isHeader ? PNG_HEADER_TEXT : PNG_BODY_TEXT
      ctx.font = isHeader ? PNG_HEADER_FONT : PNG_FONT
      ctx.textBaseline = 'top'
      cell.split('\n').forEach((line, lineIdx) => {
        ctx.fillText(line, x + PNG_PADDING, y + PNG_PADDING + lineIdx * PNG_LINE_HEIGHT, colW - PNG_PADDING * 2)
      })
      ctx.strokeStyle = PNG_BORDER
      ctx.lineWidth = 1
      ctx.strokeRect(x, y, colW, rowH)
      x += colW
    })
    y += rowH
  })

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadTableAsPNG(table: HTMLTableElement, filename = 'table.png'): Promise<void> {
  const blob = await rowsToPNGBlob(tableToRows(table))
  if (blob) downloadBlob(blob, filename)
}
