# SIA Strategy Assessment Agent — Portable Export

AI-powered consulting platform for **SIA Partners** built on SiaGPT with Claude, React + Vite, and Express + Supabase.

---

## Features

| Capability | Detail |
|---|---|
| **8-Pillar Framework** | P1 Strategy → P8 Growth Opportunities |
| **Document Ingestion** | PDF, DOCX, XLSX upload with text extraction |
| **AI Assessment** | SiaGPT with Claude streams per-pillar analysis |
| **SWOT Consolidation** | Cross-pillar strengths/weaknesses/opportunities/threats |
| **Strategy Tree** | AI-generated visual narrative |
| **D1–D6 Reports** | Executive summary → Implementation roadmap |
| **PDF / PPTX Export** | Branded deliverable downloads |
| **SiaGPT Integration** | OpenAPI spec at `/openapi.json`, plugin manifest at `/.well-known/ai-plugin.json` |
| **Demo Mode** | Works without SiaGPT OAuth2 credentials (mock data) |

---

## Quick Start (Docker Compose)

```bash
# 1. Clone or unzip this package
cd sia-assessment-portable/

# 2. Set required secrets
export NEXT_PUBLIC_SUPABASE_URL=https://roinirrknyxpkthtnujl.supabase.co
export NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
export SIAGPT_BASE_URL=https://backend.siagpt.ai
export FRONTEND_URL=https://yourdomain.com          # leave blank for localhost

# 3. Build & start
docker compose up --build -d

# 4. Open
open http://localhost:3000
```

All data is persisted in Supabase (cloud) and Docker volumes (`uploads_data`).

---

## Manual Setup

### Prerequisites

- Node.js 20+
- Supabase account (create free at [supabase.com](https://supabase.com))

### Backend

```bash
cd backend/
cp .env.example .env
# Fill in SUPABASE credentials, SESSION_SECRET, and SiaGPT OAuth2 vars
npm install
npm run build
npm start
```

### Frontend

```bash
cd frontend/
cp .env.example .env
# Set VITE_API_URL=http://localhost:3000  (or your backend URL)
# Optional: VITE_API_URL may include /api; both formats are supported.
npm install
npm run build
# Serve dist/ with any static host (Vercel, Nginx, Caddy, …)
```

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | — | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | — | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Supabase service-role key (server-side only) |
| `SESSION_SECRET` | Yes | — | Random string for session signing |
| `SIAGPT_BASE_URL` | No | `https://backend.siagpt.ai` | SiaGPT backend URL |
| `SIAGPT_PROJECT_ID` | No | — | SiaGPT project UUID |
| `OAUTH2_TOKEN_URL` | No | — | Zitadel OAuth2 token endpoint |
| `OAUTH2_CLIENT_ID` | No | — | OAuth2 client ID (omit for demo mode) |
| `OAUTH2_CLIENT_SECRET` | No | — | OAuth2 client secret (omit for demo mode) |
| `ZITADEL_PROJECT_ID` | No | — | Zitadel project UUID for scope |
| `FRONTEND_URL` | No | `http://localhost:5173` | Allowed CORS origin |
| `CORS_ORIGINS` | No | `FRONTEND_URL` | Comma-separated allowed CORS origins (e.g. Vercel prod + preview domains) |
| `PORT` | No | `3000` | HTTP port |
| `NODE_ENV` | No | `development` | `production` enables SSL behaviours |

### Frontend (`frontend/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_API_URL` | No | `/api` | Backend API base URL |

---

## Deploying to Vercel (frontend only)

The `frontend/vercel.json` is pre-configured. Set `VITE_API_URL` to your backend URL in the Vercel project settings, then push the `frontend/` directory as the Vercel project root.

---

## SiaGPT / OpenAI Plugin Integration

| Endpoint | Purpose |
|---|---|
| `GET /openapi.json` | Full OpenAPI 3.0 spec |
| `GET /.well-known/ai-plugin.json` | ChatGPT plugin manifest |
| `POST /webhooks/siagpt` | Receive push events from SiaGPT |

To connect a custom SIA SSO provider, replace `src/middleware/ssoAuth.ts` with your identity provider's JWT validation logic.

---

## Architecture

```
export/
├── frontend/          React + Vite + Tailwind + shadcn/ui
│   └── src/
│       ├── pages/     Route-level views
│       ├── components/  Shared UI components
│       └── api/       Typed API client (uses VITE_API_URL)
├── backend/           Express + TypeScript
│   └── src/
│       ├── routes.ts  All API routes (AI, projects, export)
│       ├── db.ts      Supabase client
│       ├── migrate.ts Schema migrations (run on startup)
│       ├── config.ts  Centralised env-var config
│       ├── siagpt/    OpenAPI spec + plugin manifest
│       ├── middleware/ SSO auth placeholder
│       └── routes/    Webhook handlers
├── Dockerfile         Multi-stage build
├── docker-compose.yml Full stack with Supabase (cloud DB)
└── README.md          This file
```

---

## SIA Brand Colors

| Token | Hex |
|---|---|
| Teal (accent) | `#00DECC` |
| Navy (dark bg) | `#173044` |
| Deep Navy | `#0A151E` |

---

## License

Proprietary — SIA Partners internal tooling. Do not distribute externally without authorisation.
