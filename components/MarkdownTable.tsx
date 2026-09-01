'use client'
import React, { useRef, useState } from 'react'
import { Copy, Check, Download, FileSpreadsheet, Image as ImageIcon, Maximize2 } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { copyTableAsCSV, downloadTableAsExcel, downloadTableAsPNG } from '@/lib/tableExport'

// Export/view toolbar shown above a table — copy-as-CSV, download (Excel/PNG), and
// fullscreen. Shared between the inline table and its fullscreen dialog twin, each
// pointed at its own table ref so exports always act on the copy currently in view.
function TableToolbar({
  copied, onCopyCSV, onExcel, onPNG, onFullscreen, className,
}: {
  copied: boolean
  onCopyCSV: () => void
  onExcel: () => void
  onPNG: () => void
  onFullscreen?: () => void
  className?: string
}) {
  return (
    <div className={className ?? 'md-table-toolbar'}>
      <button type="button" className="md-table-btn" title="Copy as CSV" onClick={onCopyCSV}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="md-table-btn" title="Download table">
            <Download size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onExcel}>
            <FileSpreadsheet size={13} /> Excel
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onPNG}>
            <ImageIcon size={13} /> PNG
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {onFullscreen && (
        <button type="button" className="md-table-btn" title="View fullscreen" onClick={onFullscreen}>
          <Maximize2 size={12} />
        </button>
      )}
    </div>
  )
}

// Drop-in replacement for the default <table> renderer used by ReactMarkdown.
// Wraps every markdown table with a small export toolbar: copy-as-CSV, a
// download dropdown for Excel / PNG, and a fullscreen view — all derived from
// the same extracted row data.
export function MarkdownTable({ children, node, ...props }: React.TableHTMLAttributes<HTMLTableElement> & { node?: unknown }) {
  const tableRef = useRef<HTMLTableElement>(null)
  const fullscreenTableRef = useRef<HTMLTableElement>(null)
  const [copied, setCopied] = useState(false)
  const [fullscreenCopied, setFullscreenCopied] = useState(false)
  const [fullscreenOpen, setFullscreenOpen] = useState(false)

  const copyCSV = async (ref: React.RefObject<HTMLTableElement>, setState: (v: boolean) => void) => {
    if (!ref.current) return
    try {
      await copyTableAsCSV(ref.current)
      setState(true)
      setTimeout(() => setState(false), 1500)
    } catch {
      // clipboard access denied — nothing else to do
    }
  }

  return (
    <div className="md-table-wrapper">
      <TableToolbar
        copied={copied}
        onCopyCSV={() => void copyCSV(tableRef, setCopied)}
        onExcel={() => { if (tableRef.current) void downloadTableAsExcel(tableRef.current) }}
        onPNG={() => { if (tableRef.current) void downloadTableAsPNG(tableRef.current) }}
        onFullscreen={() => setFullscreenOpen(true)}
      />
      <div className="md-table-scroll">
        <table ref={tableRef} {...props}>{children}</table>
      </div>

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-3 p-6">
          <DialogTitle className="sr-only">Table (fullscreen)</DialogTitle>
          <TableToolbar
            copied={fullscreenCopied}
            onCopyCSV={() => void copyCSV(fullscreenTableRef, setFullscreenCopied)}
            onExcel={() => { if (fullscreenTableRef.current) void downloadTableAsExcel(fullscreenTableRef.current) }}
            onPNG={() => { if (fullscreenTableRef.current) void downloadTableAsPNG(fullscreenTableRef.current) }}
            className="md-table-toolbar md-table-toolbar--fullscreen"
          />
          <div className="md-table-fullscreen-scroll">
            <table ref={fullscreenTableRef} {...props}>{children}</table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
