# Pre-Deployment Checklist

Use this before pushing to Vercel/Railway to catch misconfigurations early.

## Backend (Railway)

- [ ] `CORS_ORIGINS` is set to your Vercel domain(s):
  - Production: `https://yourdomain.vercel.app`
  - Dev/preview: add comma-separated: `https://yourdomain-*.vercel.app`
  - DO NOT include `/api` suffix in origins
- [ ] `SUPABASE_*` vars are set and correct
- [ ] `SESSION_SECRET` is a random string (changed from dev value)
- [ ] Backend builds without errors:
  ```bash
  cd backend && npm run build
  ```
  Should complete in ~5s with no errors.

## Frontend (Vercel)

- [ ] `VITE_API_URL` is set to your Railway backend:
  - Format: `https://yourdomain.railway.app` (NO `/api` suffix)
  - If API is at same origin (unusual): leave empty or set to relative `/api`
- [ ] Frontend builds without errors:
  ```bash
  cd frontend && npm run build
  ```
  Should complete in ~10s with no errors (some chunk size warnings are OK).
  
## Local Test Before Deploy

```bash
# Terminal 1: Backend
cd backend
export CORS_ORIGINS=http://localhost:5173
export NEXT_PUBLIC_SUPABASE_URL=<test_db_url>
export SUPABASE_SERVICE_ROLE_KEY=<test_key>
npm run dev

# Terminal 2: Frontend
cd frontend
export VITE_API_URL=http://localhost:3001
npm run dev

# Terminal 3: Test
curl -s http://localhost:3001/api/config | jq .
# Should return: {"provider":"siagpt-claude"}

open http://localhost:5173
# Click "New Assessment Project"
# Form should submit → redirect to dashboard

# Check browser DevTools → Network tab
# Should see POST /api/projects with 200 response, no CORS errors
```

## Production Verification (After Deploy)

1. Open https://yourdomain.vercel.app (wait for build to complete)
2. Open browser DevTools → Console (F12)
3. Check for errors:
   - `CORS blocked for origin` → check Railway CORS_ORIGINS
   - `404 /api/api/...` → check Vercel VITE_API_URL (remove `/api`)
   - `Connection refused` → check Railway is running, VITE_API_URL is correct
4. Click "New Assessment Project":
   - Form should submit without network errors
   - Should redirect to /app/dashboard
   - Sidebar should show project name

If any issues→ check [DEPLOYMENT_FIX.md](./DEPLOYMENT_FIX.md) troubleshooting section.
