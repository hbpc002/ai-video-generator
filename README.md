# AI Video Generator

AI-powered short video batch generator. Input a topic → AI generates script + images + subtitles → Remotion renders the video.

## Features

- **AI Script Generation** — Gemini API generates structured video scripts with scenes, titles, and body copy
- **Auto Image Sourcing** — Free image APIs: Pexels / Pixabay / Unsplash (auto fallback, no API key required)
- **Video Rendering** — Remotion renders vertical 1080×1920 videos (9:16, optimized for TikTok / Xiaohongshu)
- **Multiple Styles** — Tech, minimal, and cute visual themes
- **Job Queue** — Async generation with real-time progress polling
- **Chinese UI** — Interface designed for Chinese content creators

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + TypeScript + TailwindCSS |
| Backend | Node.js + Express + TypeScript |
| Video Rendering | Remotion v4 |
| AI | Google Gemini API (`@google/genai`) |
| Images | Gemini image gen / Unsplash API |

## Project Structure

```
ai-video-generator/
├── frontend/          # React + Vite UI
│   └── src/
│       ├── App.tsx
│       ├── components/    # StyleSelector, ProgressCard
│       └── api/           # API client
├── backend/           # Express API server
│   └── src/
│       ├── server.ts
│       ├── routes/        # generate.ts
│       └── services/      # ai.ts, image.ts, render.ts
├── video/             # Remotion video templates
│   └── src/
│       ├── Root.tsx
│       ├── compositions/  # ShortVideo.tsx
│       └── components/    # Scene, Title, Transition
└── package.json       # npm workspaces monorepo
```

## Getting Started

### Prerequisites

- Node.js 18+
- Google Gemini API key (optional) — [Get one here](https://aistudio.google.com/)
- **No image API key required** — Uses free APIs: Pexels / Pixabay / Unsplash (auto fallback)
  - Pexels: [Get free key](https://www.pexels.com/api/) (recommended, 200 req/month free)
  - Pixabay: [Get free key](https://pixabay.com/api/docs/) (5000 req/hour free)
  - Unsplash: [Get free key](https://unsplash.com/developers) (50K req/month, requires attribution)

### Installation

```bash
git clone https://github.com/Conn-Ho/ai-video-generator.git
cd ai-video-generator
npm run install:all
```

### Configuration

```bash
cp .env.example .env
# Edit .env and add your API keys
```

```env
GEMINI_API_KEY=your_gemini_api_key_here
UNSPLASH_ACCESS_KEY=your_unsplash_access_key_here
PORT=3001
```

### Run

```bash
# Start both frontend and backend
npm run dev
```

Frontend: http://localhost:5173
Backend: http://localhost:3001

## API

```
POST /api/generate
  Body: { topic, style: "tech"|"minimal"|"cute", scenes: number }
  Response: { jobId }

GET /api/job/:jobId
  Response: { status, progress, videoUrl?, script? }

GET /api/download/:jobId
  Response: mp4 file
```

## Output

- Vertical 1080×1920 (9:16)
- 5–8 seconds per scene
- 30–60 seconds total
- Background image + title + body text + transition animations

## License

MIT
