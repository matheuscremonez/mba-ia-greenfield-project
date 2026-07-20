# phase-03-videos — Progress

**Status:** in progress
**SIs:** 5/8 completed

### SI-03.1 — Preparar infraestrutura de storage, fila e worker
- **Status:** completed
- **Tests:** 19/19 passing (`storage.config.spec.ts`, `queue.config.spec.ts`, `env.validation.integration-spec.ts`); focused ESLint, `npx tsc --noEmit` and `docker compose config --quiet` passed.
- **Observations:** Docker image build, FFmpeg/ffprobe verification and live infrastructure healthchecks passed after starting OrbStack. MinIO uses the server-wide `MINIO_API_CORS_ALLOW_ORIGIN` setting because current MinIO Community no longer supports per-bucket CORS configuration. `npm install` reported 33 existing/transitive audit findings; no unsafe automatic audit fix was applied.

### SI-03.2 — Persistir o ciclo de vida de vídeos
- **Status:** completed
- **Tests:** 10/10 passing against PostgreSQL (`video.entity.integration-spec.ts`, `videos.module.spec.ts`, `migrations.integration-spec.ts`); focused ESLint and `npx tsc --noEmit` passed.
- **Observations:** The model uses explicit database checks, a restrictive unidirectional channel relationship, reversible migration and no `synchronize` fallback.

### SI-03.3 — Implementar o adaptador S3 privado
- **Status:** completed
- **Tests:** 10/10 passing (`video-storage.service.spec.ts`, `video-storage.service.integration-spec.ts`, `videos.module.spec.ts`); real MinIO multipart/private GET/range/thumbnail/abort coverage, focused ESLint and `npx tsc --noEmit` passed.
- **Observations:** The SDK is isolated behind domain types, internal and public S3 clients are separate, signed URLs expire in 900 seconds and provider failures are exposed only as `503 STORAGE_UNAVAILABLE`.

### SI-03.4 — Orquestrar uploads e publicação do processamento
- **Status:** completed
- **Tests:** 19 focused unit/integration assertions passing across `videos.service.spec.ts`, `videos.service.integration-spec.ts`, `video-processing.queue.integration-spec.ts` and the storage unit suite; PostgreSQL, MinIO and Redis exercised together; focused ESLint and `npx tsc --noEmit` passed.
- **Observations:** Owner-scoped lookups mask non-owners, multipart completion is retryable after an already completed object, state changes use compare-and-set, and queue publication failure compensates back to a recoverable `DRAFT`.

### SI-03.5 — Expor os endpoints de upload multipart
- **Status:** completed
- **Tests:** DTO/service/filter tests 16/16 passing, OpenAPI/module tests 12/12 passing, and `test/videos-upload.e2e-spec.ts` 5/5 passing against PostgreSQL, MinIO and Redis; focused ESLint and `npx tsc --noEmit` passed.
- **Observations:** The four JWT-protected routes return the planned status/error codes, preserve private object keys, document request/response schemas and reject anonymous calls without side effects.

### SI-03.6 — Processar vídeos no worker FFmpeg
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.7 — Expor metadata, streaming, thumbnail e download
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.8 — Sincronizar contratos e documentação operacional
- **Status:** pending
- **Tests:** pending
- **Observations:** none
