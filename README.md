# Intelligent Meeting Assistant (MVP)

Next.js + TypeScript + Tailwind + shadcn/ui prototype for:
- real-time transcript ingestion
- rolling summary
- action item extraction
- sentiment highlight timeline

## Tech Stack
- Next.js App Router
- TypeScript
- Tailwind CSS + shadcn/ui
- OpenAI-compatible SDK (prepared in service layer)
- Tingwu adapter placeholder (prepared for websocket integration)

## Run Locally
1. Install dependencies

```bash
npm install
```

2. Configure environment

> Note: some earlier setup guides referenced copying `.env.example`, but it may be missing in your checkout.
> The safest approach is to create `.env.local` directly.

```bash
touch .env.local
```

Fill in the following variables in `.env.local`:

```env
# Required: your API key (DeepSeek / other OpenAI-compatible providers)
OPENAI_API_KEY="..."

# Required for DeepSeek (OpenAI-compatible gateway)
OPENAI_BASE_URL="https://api.deepseek.com/v1"

# Required: model name for your provider (DeepSeek example)
OPENAI_MODEL="deepseek-chat"
```

DeepSeek is wired into the “Real-time Insights” brain path: the backend entry
`POST /api/meetings/:id/events` appends the incoming transcript to in-memory context,
calls the LLM to regenerate the latest **summary** + structured **action items**,
stores them back into memory, and returns the updated meeting to the frontend.
This also avoids the previous 500 error caused by missing/invalid model configuration
(e.g. `400 Model Not Exist`).

3. Start dev server

```bash
npm run dev
```

4. Open browser

```text
http://localhost:3000
```

## Current API Endpoints
- `POST /api/meetings` create meeting
- `GET /api/meetings` list meetings
- `POST /api/meetings/:id/events` ingest transcript event
- `GET /api/meetings/:id/snapshot` get meeting snapshot

## Notes
- Current persistence is in-memory for MVP verification.
- LLM and Tingwu modules are scaffolded and can be wired in the next step.
