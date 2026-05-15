# MenuMaker

MenuMaker is a local-first mobile web app for planning Spanish weekly diets with profile-specific macro targets, saved weekly menus, recipe editing, and AI-assisted meal regeneration.

## Local Setup

```bash
npm install
cp .env.example .env
npm run setup:local
npm run dev:web -- --hostname 0.0.0.0 --port 3000
```

Open the printed LAN URL from a phone on the same network.

## Live/Fallback Controls

Recipe generation is LLM-first. Deterministic recipe templates are only a local fallback when the provider is unavailable or too few generated candidates validate.

```bash
ALLOW_RECIPE_TEMPLATE_FALLBACK=false
```

Set this to `false` when testing live behavior: generation fails loudly instead of silently filling missing candidates with templates. The app records recipe source, fallback slots, and AI-cache hits in menu generation metadata.

## Workspaces

- `apps/web`: Next.js mobile web app
- `apps/mcp`: MCP server
- `packages/core`: shared types, schemas, and macro policy
- `packages/db`: Postgres schema, seed, and application service
- `packages/nutrition`: deterministic nutrition matching and seed foods
- `packages/ai`: Codex OAuth-backed chat and planning helpers
- `skills/menumaker`: Codex skill contract

## Verification

```bash
npm run typecheck
npm test
npm run build
```
