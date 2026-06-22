import 'server-only'
import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const DB_FILE = path.join(DATA_DIR, 'local_db.json')

function readDb(): Record<string, Record<string, any>> {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(DB_FILE)) return {}
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) } catch { return {} }
}

function writeDb(db: Record<string, Record<string, any>>) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

class QueryBuilder {
  private _table: string
  private _op: 'select' | 'upsert' | 'delete' | null = null
  private _cols = '*'
  private _filters: Record<string, any> = {}
  private _limit: number | null = null
  private _orderCol: string | null = null
  private _orderAsc = true
  private _upsertData: any = null
  private _single = false

  constructor(table: string) { this._table = table }

  select(cols: string) { this._op = 'select'; this._cols = cols; return this }
  upsert(data: any) { this._op = 'upsert'; this._upsertData = data; return this }
  delete() { this._op = 'delete'; return this }
  eq(col: string, val: any) { this._filters[col] = val; return this }
  limit(n: number) { this._limit = n; return this }
  order(col: string, opts?: { ascending?: boolean }) {
    this._orderCol = col; this._orderAsc = opts?.ascending ?? true; return this
  }
  single() { this._single = true; return this._exec() }

  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    return this._exec().then(resolve, reject)
  }

  private async _exec(): Promise<{ data: any; error: any }> {
    try {
      const db = readDb()
      const table = db[this._table] ?? {}

      if (this._op === 'select') {
        let rows: any[] = Object.values(table)
        for (const [col, val] of Object.entries(this._filters)) {
          rows = rows.filter(r => r[col] === val)
        }
        if (this._orderCol) {
          const col = this._orderCol
          const asc = this._orderAsc
          rows.sort((a, b) => {
            if (a[col] < b[col]) return asc ? -1 : 1
            if (a[col] > b[col]) return asc ? 1 : -1
            return 0
          })
        }
        if (this._limit !== null) rows = rows.slice(0, this._limit)
        if (this._single) {
          return rows.length > 0
            ? { data: rows[0], error: null }
            : { data: null, error: { message: 'No rows found', code: 'PGRST116' } }
        }
        return { data: rows, error: null }
      }

      if (this._op === 'upsert') {
        if (!db[this._table]) db[this._table] = {}
        db[this._table][this._upsertData.id] = this._upsertData
        writeDb(db)
        return { data: this._upsertData, error: null }
      }

      if (this._op === 'delete') {
        if (db[this._table] && this._filters.id) {
          delete db[this._table][this._filters.id]
          writeDb(db)
        }
        return { data: null, error: null }
      }

      return { data: null, error: null }
    } catch (e: any) {
      return { data: null, error: { message: e.message } }
    }
  }
}

export const localDb = {
  from(table: string) { return new QueryBuilder(table) }
}
