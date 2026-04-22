<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/f9b5f9b4-1953-4e26-b189-9f7216a4de3d

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create `.env` (or `.env.local`) and set:
   - `DATABASE_URL` (optional for now, reserved for future PostgreSQL use)
   - `SUPERADMIN_EMAIL` (optional bootstrap)
   - `SUPERADMIN_PASSWORD` (optional bootstrap)
   - AI provider/model/key are managed globally in-app by superadmin (`/api/superadmin/ai-config`)
3. Run the app:
   `npm run dev`
4. Open:
   `http://localhost:3000`

## Current local storage mode

For local development, data is persisted in `data/db.json`.
The backend routes (`/api/users`, `/api/cases`, `/api/searches`, `/api/rulings`) use this JSON file instead of PostgreSQL.

## Backend API (local JSON)

The app runs a local Express backend via `npm run dev` and stores everything in `data/db.json`.

Available endpoints:

- `GET /api/auth/status`
- `GET /api/auth/captcha`
- `POST /api/auth/setup-superadmin`
- `POST /api/auth/login`
- `GET /api/health`
- `GET /api/users/me` (requires `x-user-id` header)
- `GET /api/superadmin/users` (superadmin only)
- `POST /api/superadmin/users` (superadmin only)
- `PATCH /api/superadmin/users/:id` (superadmin only)
- `DELETE /api/superadmin/users/:id` (superadmin only)
- `GET /api/superadmin/ai-config` (superadmin only)
- `PATCH /api/superadmin/ai-config` (superadmin only)
- `GET /api/superadmin/reset-challenge` (superadmin only)
- `POST /api/superadmin/reset-app` (superadmin only)
- `POST /api/ai/analyze-case` (authenticated user)
- `POST /api/ai/generate-search` (authenticated user)
- `POST /api/ai/analyze-ruling` (authenticated user)
- `POST /api/ai/find-similar-cases` (authenticated user)
- `POST /api/cases`
- `GET /api/cases?userId=...`
- `GET /api/cases/:id`
- `PATCH /api/cases/:id`
- `DELETE /api/cases/:id`
- `POST /api/searches`
- `GET /api/searches?userId=...`
- `GET /api/searches/:id`
- `PATCH /api/searches/:id`
- `DELETE /api/searches/:id`
- `POST /api/rulings`
- `GET /api/rulings?userId=...`
- `GET /api/rulings/:id`
- `PATCH /api/rulings/:id`
- `DELETE /api/rulings/:id`

Quick health check:

```bash
curl http://localhost:3000/api/health
```

## Login real (email/senha)

- Login is performed by backend with email/password.
- If no `superadmin` exists, the app opens an initial setup screen to create one.
- The initial superadmin setup still uses math captcha for first-time security.
- Superadmin has an exclusive dashboard with only:
   - User management
   - Settings
- In Settings, superadmin can configure a global AI provider and API key (Gemini, Groq, ChatGPT).
- This global AI configuration is used by the whole app for all AI analysis endpoints.
- Settings includes a factory reset flow protected by a mini-game with 3 checkbox captchas.
- The frontend no longer uses mock users.
- On startup, any legacy test users (`mock_*` and sample test emails) are removed from `data/db.json`.
