# Deployment Fix Summary

Your Vercel frontend was stuck on the landing page due to three interconnected issues that have been fixed in the codebase.

## Issues Fixed

### 1. **API URL Path Duplication**
**Problem:** Frontend was configured with `VITE_API_URL=https://railway.app` but appended `/api` in the client, resulting in `/api/api/...` paths that don't exist on the backend.

**Fixed:**
- Frontend config.ts now intelligently normalizes API URLs, accepting either:
  - `VITE_API_URL=https://railway.app` → becomes `https://railway.app/api`
  - `VITE_API_URL=https://railway.app/api` → stays `https://railway.app/api`
- All API client calls use the normalized root, preventing double `/api` issues.

### 2. **CORS Origin Mismatch**
**Problem:** Backend CORS was hardcoded to a single `FRONTEND_URL`, which didn't match Vercel's production domain and blocked all cross-origin API calls.

**Fixed:**
- Backend now supports multiple origins via environment variable:
  - Single origin: `FRONTEND_URL=https://yourdomain.vercel.app`
  - Multiple (prod + preview): `CORS_ORIGINS=https://yourdomain.vercel.app,https://yourdomain-*.vercel.app`
- CORS check is now explicit and logs allowed origins on startup.

### 3. **Routing Fragmentation**
**Problem:** Frontend bootstrap fetched `/api/config` from the browser origin, but Vercel's rewrite sends all paths to index.html, so the backend endpoint wasn't reached.

**Fixed:**
- App now uses `CONFIG.API_ROOT` to construct the full backend URL: `https://railway.app/api/config`
- Works whether API is on same origin (dev) or cross-origin (production).

---

## Redeploy Instructions

### Railway (Backend)

Set these environment variables in Railway dashboard → Project settings:

```
NEXT_PUBLIC_SUPABASE_URL=<your_supabase_url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your_anon_key>
SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key>
SESSION_SECRET=<generate-random-string>

# **Important:** Set CORS_ORIGINS to your Vercel domain(s)
# Single domain:
CORS_ORIGINS=https://yourdomain.vercel.app

# Multiple domains (production + all preview branches):
CORS_ORIGINS=https://yourdomain.vercel.app,https://yourdomain-*.vercel.app

# Optional: other SiaGPT credentials
SIAGPT_BASE_URL=https://backend.siagpt.ai
SIAGPT_PROJECT_ID=...
OAUTH2_TOKEN_URL=...
OAUTH2_CLIENT_ID=...
OAUTH2_CLIENT_SECRET=...
```

---

### Vercel (Frontend)

**Option A: Update Existing Vercel Project**

1. Go to **Project Settings** → **Environment Variables**
2. Update `VITE_API_URL`:
   ```
   VITE_API_URL=https://authentic-reverence-production-45b9.up.railway.app
   ```
   ✅ Just the hostname, no `/api` suffix.

3. Re-deploy by pushing to your git branch.

**Option B: Re-verify Existing Setup**

In the Vercel project dashboard, check:
- Settings → Environment Variables → `VITE_API_URL` is set correctly
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install`

---

## Local Testing

Before redeploying, test the fix locally:

### Start Backend
```bash
cd backend
export CORS_ORIGINS=http://localhost:5173
npm run dev
# Should show: CORS origins: http://localhost:5173
```

### Start Frontend
```bash
cd frontend
export VITE_API_URL=http://localhost:3001
npm run dev
# Should show: Compiled successfully
```

### Test Landing Page
1. Open http://localhost:5173
2. Click "New Assessment Project"
3. Fill in form and submit
4. ✅ Should redirect to dashboard, not hang

If it still shows "Network Error..." or blank projects list:
- Check browser DevTools Console for CORS errors
- Check backend logs for `CORS blocked for origin: ...` messages
- Verify environment variables are set in both projects

---

## What Changed in Code

| File | Change |
|---|---|
| `frontend/src/config.ts` | Added smart API URL normalization |
| `frontend/src/api/index.ts` | Use normalized API_ROOT instead of constructing `/api` |
| `frontend/src/App.tsx` | Bootstrap `/api/config` fetch now via `CONFIG.API_ROOT` |
| `backend/src/config.ts` | Parse `CORS_ORIGINS` env var, support multiple origins |
| `backend/src/index.ts` | Explicit CORS origin validator with logging |
| `README.md` | Updated VITE_API_URL docs + new CORS_ORIGINS env var |

---

## Rollback

If issues arise:
1. Revert the commits on both repos
2. Railway backend: clear CORS_ORIGINS, set only FRONTEND_URL to old pattern
3. Vercel frontend: reset VITE_API_URL to old `https://something/api` pattern

Both apps are backward-compatible with the original deployment if needed.
