# StreamTube — Codex guidance

## Purpose and architecture

StreamTube is a video-sharing platform. This repository is a monorepo with:

- `nestjs-project/`: NestJS 11 API, PostgreSQL, Mailpit and TypeORM migrations.
- `next-frontend/`: Next.js 16 frontend. It uses a BFF: browsers call same-origin `app/api/**` Route Handlers, never the Nest API directly.
- `docs/`: the project plan, technical decisions, phase artifacts and C4 diagram.

Implemented scope is phases 01–03 (base setup, authentication, multipart video upload, private media access and asynchronous FFmpeg processing). Treat phases 04–07 as planned work; read `docs/project-plan.md` and the relevant phase/decision documents before changing them.

## Working rules

- Work on one feature, bug, or refactor at a time. Do not combine cosmetic changes with functional work.
- Preserve strict TypeScript, module ownership and layer separation. Extract cross-domain logic instead of allowing a module to own another domain's entities.
- Use Docker Compose service names (for example `db`) for connections between containers; `localhost` is only valid for a host-side tool such as the PostgreSQL MCP.
- Before using a non-trivial library API, read the installed version in the applicable `package.json` and verify the API with Context7. Prefer the versioned official documentation over memory.
- Keep API changes documented through OpenAPI. When the backend contract changes, run `scripts/sync-openapi.sh` and regenerate frontend types with `npm run openapi:types` in `next-frontend`.
- Video bytes never pass through NestJS controllers: clients upload parts and consume media through short-lived signed S3 URLs. Object keys and bucket names remain internal.
- The API only produces `video.process`; FFmpeg/ffprobe run in the dedicated `nestjs-worker` process. Preserve database-state idempotency, bounded retries and deterministic thumbnail keys.
- Between Compose services use `db`, `redis` and `minio`. `S3_PUBLIC_ENDPOINT` is the only browser-reachable storage endpoint.
- Do not commit directly to `main`; use `feature/*`, `bugfix/*`, `hotfix/*`, or `docs/*` branches.

## Definition of done

1. Run focused tests while implementing, then the full relevant suite before declaring completion.
2. Run TypeScript compilation without errors and the relevant lint command.
3. For backend work, include unit/integration/e2e coverage as appropriate. For frontend work, include Vitest/MSW and Playwright coverage as appropriate.
4. Record any intentionally deferred, out-of-scope follow-up as a separate task rather than silently including it.

## Commands

Backend commands run in `nestjs-project` (normally inside its `nestjs-api` container):

```bash
npm test
npm run test:integration
npm run test:e2e
npm run lint
npx tsc --noEmit
docker compose exec nestjs-worker ffmpeg -version
docker compose exec nestjs-worker ffprobe -version
```

Frontend commands run in `next-frontend`:

```bash
npm test
npm run test:e2e
npm run lint
npx tsc --noEmit
```

## Codex workflow

- Use `$streamtube-plan` for a phase or task that needs research, decisions and an implementation plan.
- Use `$streamtube-implement` to execute an approved phase/task plan one step at a time.
- Use `$streamtube-research` for a decision record before implementation.
- Delegate bounded read-only extraction to the project agents in `.codex/agents/` when it would reduce broad context loading. The parent agent remains responsible for decisions, edits and user communication.

The former Claude-specific foundation remains in `.claude/` as a historical reference. Do not treat `CLAUDE.md` or `.claude/settings.json` as active Codex configuration.
