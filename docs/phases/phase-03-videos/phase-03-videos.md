---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-07-20T12:05:08-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-07-20T12:04:47-03:00"
  docs/phases/phase-03-videos/validation.md: "2026-07-20T12:05:21-03:00"
  docs/project-plan.md: "2026-07-20T11:08:56-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-20T11:55:35-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-07-20T11:08:56-03:00"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-07-20T11:08:56-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-07-20T11:08:56-03:00"
  docs/phases/phase-02-auth/context.md: "2026-07-20T11:08:56-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-07-20T11:08:56-03:00"
  .agents/skills/testing-guide-nestjs-project/SKILL.md: "2026-07-20T11:31:17-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar no backend o armazenamento privado de vídeos e thumbnails, upload multipart direto de até 10 GB com pré-cadastro em rascunho, processamento assíncrono por fila e worker FFmpeg, URL única por UUID, streaming por ranges e download sem transportar os arquivos pela API.

---

## Step Implementations

### SI-03.1 — Preparar infraestrutura de storage, fila e worker

**Description:** Instalar e configurar as dependências externas da fase, deixando API e worker com configuração validada e serviços locais reproduzíveis.

**Technical actions:**

1. Adicionar `@nestjs/bullmq`, `bullmq`, `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner` em `nestjs-project/package.json` e `nestjs-project/package-lock.json` nas versões registradas em `library-refs.md` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-03`).
2. Criar `nestjs-project/src/config/storage.config.ts` e `nestjs-project/src/config/queue.config.ts`, registrá-los no `ConfigModule` e ampliar `src/config/env.validation.ts` e `.env.example` com endpoints interno/público do S3, buckets privados, credenciais, região, Redis e concorrência do worker.
3. Ampliar `nestjs-project/compose.yaml` com Redis, MinIO, inicializador idempotente dos dois buckets privados e serviço `nestjs-worker`, usando nomes de serviço e healthchecks.
4. Atualizar `nestjs-project/Dockerfile.dev` para instalar uma versão fixa de FFmpeg/ffprobe e verificar os binários durante o build; adicionar scripts separados de API e worker em `package.json` (per `phase-03-videos/TD-04`).
5. Configurar a conexão global BullMQ em `nestjs-project/src/app.module.ts` com falha rápida no produtor HTTP e manter a política de reconexão do worker isolada em seu módulo (per `phase-03-videos/TD-01`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Storage/queue env | Integration: defaults, required values, invalid URLs/ports | `nestjs-project/src/config/env.validation.integration-spec.ts` |
| `storageConfig` | Unit: internal/public endpoint and private bucket mapping | `nestjs-project/src/config/storage.config.spec.ts` |
| `queueConfig` | Unit: Redis connection, retry mode and worker concurrency | `nestjs-project/src/config/queue.config.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up` inicia `db`, `redis`, `minio`, `mailpit`, `nestjs-api` e `nestjs-worker` com dependências saudáveis.
- Uma configuração sem credenciais/buckets de storage ou Redis válido impede o bootstrap com erro de validação agregado.
- Os buckets de fontes e thumbnails existem após inicializações repetidas e permanecem privados.
- API e worker usam os hosts internos `minio` e `redis`, enquanto URLs assinadas usam o endpoint público configurado.
- A imagem do worker responde com sucesso a `ffmpeg -version` e `ffprobe -version`.

---

### SI-03.2 — Persistir o ciclo de vida de vídeos

**Description:** Criar o modelo relacional que registra o rascunho desde o início do upload e sustenta transições, ownership e resultados do processamento.

**Technical actions:**

1. Criar `nestjs-project/src/videos/entities/video.entity.ts` e `nestjs-project/src/videos/video-status.enum.ts` com os campos, tipos, índices e relação unidirecional definidos em `## Technical Specifications → Data Model` (per `phase-03-videos/TD-05`, `phase-03-videos/TD-06`).
2. Criar migration TypeORM em `nestjs-project/src/database/migrations/` para enum `video_status`, tabela `videos`, FK `channel_id`, checks e índices, com `down` reversível.
3. Criar `nestjs-project/src/videos/videos.module.ts` com `TypeOrmModule.forFeature([Video])` e import explícito de `ChannelsModule`, sem permitir que o módulo de vídeos persista `Channel`.
4. Atualizar os conjuntos de entidades dos testes e garantir que `data-source.ts` descubra a nova entidade e migration sem habilitar `synchronize`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration/PostgreSQL: defaults, UUID, FK, bigint, JSONB, checks and unique keys | `nestjs-project/src/videos/entities/video.entity.integration-spec.ts` |
| Video migration | Integration/PostgreSQL: `up`, constraints and reversible `down` | `nestjs-project/src/database/migrations.integration-spec.ts` |
| `VideosModule` persistence graph | DI integration with real TypeORM metadata | `nestjs-project/src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.1 — configurações e serviços externos precisam estar definidos para compor o módulo

**Acceptance criteria:**

- Criar um upload persiste um `Video` com UUID único e status inicial `DRAFT`.
- Persistir `size_bytes` igual a zero ou superior a `10737418240` é rejeitado pelo banco.
- Persistir `channel_id` inexistente é rejeitado e excluir um canal referenciado é bloqueado.
- `source_key` e `thumbnail_key` não aceitam colisões entre vídeos.
- Executar migrations para cima e para baixo cria e remove todos os objetos da Fase 03 sem `synchronize`.

---

### SI-03.3 — Implementar o adaptador S3 privado

**Description:** Encapsular multipart upload, objetos privados e URLs pré-assinadas em uma fronteira testável compatível com MinIO e AWS S3.

**Technical actions:**

1. Criar `nestjs-project/src/videos/storage/video-storage.types.ts` e `video-storage.service.ts` com uma API de domínio que não exponha comandos ou respostas do SDK aos demais serviços.
2. Construir clientes S3 interno e de assinatura pública a partir de `storageConfig`, usando `forcePathStyle` somente quando configurado para MinIO (per `phase-03-videos/TD-03`).
3. Implementar criação, assinatura em lotes de 1–20 partes, conclusão, `HeadObject` e aborto multipart com parte fixa de 64 MiB e validade de 900 segundos (per `phase-03-videos/TD-02`).
4. Implementar download por stream, upload JPEG, exclusão idempotente e URLs GET assinadas para thumbnail, streaming e download com `Content-Disposition` seguro (per `phase-03-videos/TD-07`).
5. Traduzir falhas do provedor para exceções de domínio `STORAGE_UNAVAILABLE`, sem vazar credenciais, buckets, chaves ou mensagens internas.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoStorageService` | Unit: command mapping, batches, signing options and error translation | `nestjs-project/src/videos/storage/video-storage.service.spec.ts` |
| S3 adapter | Integration/MinIO: multipart, head, abort, private GET, range, upload and cleanup | `nestjs-project/src/videos/storage/video-storage.service.integration-spec.ts` |

**Dependencies:** SI-03.1 — MinIO/config; SI-03.2 — keys and persisted upload identity

**Acceptance criteria:**

- Inicializar um objeto de 10 GiB retorna `part_size_bytes: 67108864` e a quantidade calculada de partes sem transportar bytes pela API.
- Assinar partes aceita somente números pertencentes ao upload persistido e produz URLs públicas válidas por 900 segundos.
- Um objeto privado não pode ser lido anonimamente, mas a URL GET assinada permite leitura e respostas `206` para ranges válidos.
- O download assinado devolve `Content-Disposition: attachment` com filename sanitizado.
- Falha do MinIO/S3 retorna `503 STORAGE_UNAVAILABLE` sem detalhes internos do provedor.

---

### SI-03.4 — Orquestrar uploads e publicação do processamento

**Description:** Implementar a aplicação de upload com ownership, transições concorrentes e publicação idempotente do job após a verificação do objeto.

**Technical actions:**

1. Criar `nestjs-project/src/videos/queue/video-processing.queue.ts` para publicar `video.process` com payload versionado, `jobId` por UUID, 3 tentativas, backoff exponencial e retenção limitada (per `phase-03-videos/TD-01`, `phase-03-videos/TD-05`).
2. Criar `nestjs-project/src/videos/videos.service.ts` para localizar o canal do usuário e iniciar upload, compensando a linha quando a criação multipart falhar.
3. Implementar assinatura de partes com lookup por `video.id + channel.user_id`, validação do estado `DRAFT` e limites persistidos.
4. Implementar conclusão idempotente: completar ou reconhecer o objeto já concluído, executar `HeadObject`, validar tamanho, persistir `PROCESSING`, publicar o job e compensar para `DRAFT` em `QUEUE_UNAVAILABLE`.
5. Implementar aborto e limpeza de rascunhos com compare-and-set, além das exceções `VIDEO_NOT_FOUND`, `VIDEO_INVALID_STATE`, `UPLOAD_SIZE_MISMATCH` e `QUEUE_UNAVAILABLE` do catálogo.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingQueue` | Integration/Redis: payload, job ID, deduplication, retry options and retention | `nestjs-project/src/videos/queue/video-processing.queue.integration-spec.ts` |
| `VideosService` | Unit: ownership, transitions, compensation and provider failure branches | `nestjs-project/src/videos/videos.service.spec.ts` |
| Upload lifecycle | Integration/PostgreSQL + MinIO + Redis: initiate, complete, retry and abort | `nestjs-project/src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.2 — persistência; SI-03.3 — adaptador S3

**Acceptance criteria:**

- Iniciar upload válido cria exatamente um rascunho associado ao canal do usuário e um multipart correspondente.
- Usuário que tenta operar vídeo de outro canal recebe `404 VIDEO_NOT_FOUND`, indistinguível de um UUID ausente.
- Completar todas as partes com tamanho correto retorna o vídeo em `PROCESSING` e cria um único job `video.process` com seu UUID.
- Completar objeto com tamanho divergente retorna `422 UPLOAD_SIZE_MISMATCH`, remove o objeto inválido e conserva o vídeo em `DRAFT`.
- Indisponibilidade da fila retorna `503 QUEUE_UNAVAILABLE`; repetir a conclusão posteriormente agenda o objeto já enviado sem novo upload.
- Abortar um `DRAFT` remove multipart/objeto e linha; abortar outro estado retorna `409 VIDEO_INVALID_STATE`.

---

### SI-03.5 — Expor os endpoints de upload multipart

**Description:** Materializar o contrato HTTP de upload em DTOs e controller fino protegido pelo JWT global.

**Route:** POST /videos/uploads; POST /videos/{id}/uploads/parts; POST /videos/{id}/uploads/complete; DELETE /videos/{id}/uploads
**Test Specs:** see `nestjs-project/specs/videos-uploads.plan.md`
**Authorization:** Usuário autenticado; operações por ID exigem ownership conforme `Authorization Matrix`

**Technical actions:**

1. Criar DTOs de request/response em `nestjs-project/src/videos/dto/` com `class-validator`, transformação segura de `size_bytes`, UUID e regras exatas de partes definidas em `## Technical Specifications → API Contracts`.
2. Criar `nestjs-project/src/videos/videos.controller.ts` com as quatro rotas, `@CurrentUser()`, status `201/200/202/204` e delegação integral ao `VideosService`.
3. Documentar DTOs, autenticação, respostas e catálogo de erros com `@nestjs/swagger` (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).
4. Registrar controller, serviços, queue e storage em `VideosModule` e importar o módulo em `AppModule` sem afrouxar o guard global.
5. Ampliar `nestjs-project/src/openapi-export.integration-spec.ts` para afirmar que as quatro operações e seus schemas aparecem no documento exportado.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Upload DTOs | Unit: nested validation, bounds, distinct/order rules and transformation | `nestjs-project/src/videos/dto/upload-video.dto.spec.ts` |
| Upload OpenAPI contract | Integration: paths, auth, statuses, schemas and error envelopes | `nestjs-project/src/openapi-export.integration-spec.ts` |
| `VideosModule` HTTP graph | DI compilation with controller and concrete providers | `nestjs-project/src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.4 — casos de uso e publicação do job precisam estar disponíveis

**Acceptance criteria:**

- `POST /videos/uploads` válido retorna `201` com UUID, `DRAFT`, upload ID, tamanho/quantidade de partes e expiração.
- Metadata inválida retorna `400 VALIDATION_ERROR`; tamanho acima de 10 GiB retorna `413 VIDEO_TOO_LARGE`; MIME não aceito retorna `415 VIDEO_TYPE_UNSUPPORTED`.
- `POST /videos/{id}/uploads/parts` válido retorna URLs apenas para as partes solicitadas; lote inválido retorna `400 UPLOAD_PARTS_INVALID`.
- `POST /videos/{id}/uploads/complete` válido retorna `202` com status `PROCESSING`.
- `DELETE /videos/{id}/uploads` válido retorna `204` sem corpo.
- Qualquer uma das quatro rotas sem JWT retorna `401` e não inicia chamadas ao storage ou à fila.

---

### SI-03.6 — Processar vídeos no worker FFmpeg

**Description:** Consumir jobs fora da API, extrair metadata real, gerar thumbnail e finalizar o estado de forma idempotente e recuperável.

**Technical actions:**

1. Criar `nestjs-project/src/worker.ts` e `src/worker.module.ts` com bootstrap Nest sem servidor HTTP, conexão própria BullMQ e shutdown gracioso (per `phase-03-videos/TD-01`, `phase-03-videos/TD-04`).
2. Criar `nestjs-project/src/videos/processing/video-media.service.ts` para executar `ffprobe` e `ffmpeg` via `spawn` com arrays de argumentos, parsear metadata normalizada e validar stream de vídeo/thumbnail.
3. Criar `nestjs-project/src/videos/processors/video.processor.ts` como `WorkerHost`: bloquear a linha, ignorar estados obsoletos/`READY`, baixar a fonte para diretório temporário isolado, processar e enviar o JPEG determinístico.
4. Persistir metadata, duração, chaves e `READY` em uma transação; em falha retryable manter `PROCESSING` e, no esgotamento, persistir `ERROR`, `processed_at` e diagnóstico sanitizado (per `phase-03-videos/TD-05`).
5. Remover temporários em `finally`, fechar worker/conexões no lifecycle Nest e garantir que entrega duplicada nunca crie outro vídeo ou thumbnail key.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoMediaService` | Unit: spawn args, parse, exit errors, malformed metadata and missing stream | `nestjs-project/src/videos/processing/video-media.service.spec.ts` |
| `VideoProcessor` | Unit: state/idempotency branches, cleanup and terminal error sanitization | `nestjs-project/src/videos/processors/video.processor.spec.ts` |
| Processing pipeline | Integration/PostgreSQL + Redis + MinIO + real fixture: retry, metadata and JPEG | `nestjs-project/src/videos/processors/video.processor.integration-spec.ts` |
| `WorkerModule` | DI compilation and lifecycle shutdown | `nestjs-project/src/worker.module.spec.ts` |

**Dependencies:** SI-03.4 — job e lifecycle; SI-03.1 — worker/FFmpeg; SI-03.3 — transferência de objetos

**Acceptance criteria:**

- Um job válido para vídeo `PROCESSING` termina em `READY` com duração, metadata normalizada, thumbnail JPEG e `processed_at`.
- O processamento ocorre no serviço `nestjs-worker`; a API continua respondendo enquanto FFmpeg trabalha.
- Uma entrega duplicada para vídeo `READY` termina como no-op e preserva metadata e thumbnail existentes.
- Falha transitória é tentada no máximo três vezes com backoff; a falha final muda o vídeo para `ERROR` com mensagem sanitizada.
- Sucesso e falha deixam o diretório temporário do job vazio e não expõem caminhos locais no registro retornado pela API.

---

### SI-03.7 — Expor metadata, streaming, thumbnail e download

**Description:** Entregar a URL canônica do vídeo e acessos privados por redirecionamento, preservando autorização e mantendo os bytes fora da API.

**Route:** GET /videos/{id}; GET /videos/{id}/thumbnail; GET /videos/{id}/stream; GET /videos/{id}/download
**Test Specs:** see `nestjs-project/specs/videos-media-access.plan.md`
**Authorization:** Somente o dono autenticado; recursos binários exigem status `READY`

**Technical actions:**

1. Criar DTO de leitura em `nestjs-project/src/videos/dto/video-response.dto.ts`, expondo somente os campos e links condicionais definidos no contrato, com `size_bytes` serializado sem perda de precisão.
2. Ampliar `VideosService` com consulta owner-scoped e projeção por status; não retornar buckets, keys, multipart ID ou dados brutos do ffprobe.
3. Implementar assinatura on-demand de thumbnail, stream e download; configurar filename sanitizado no download e responder `VIDEO_NOT_READY` antes de acessar o storage (per `phase-03-videos/TD-07`).
4. Adicionar as quatro rotas ao `VideosController` com respostas `200`/`307`, `Location` e decorators OpenAPI completos.
5. Ampliar `openapi-export.integration-spec.ts` para validar schemas, redirects, segurança e códigos de erro dos endpoints de leitura.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Video read service | Unit: ownership, status projection, redaction and signing branches | `nestjs-project/src/videos/videos.service.spec.ts` |
| Video read queries | Integration/PostgreSQL: owner-scoped lookup and lifecycle projection | `nestjs-project/src/videos/videos.service.integration-spec.ts` |
| Read OpenAPI contract | Integration: response schema, redirects, security and errors | `nestjs-project/src/openapi-export.integration-spec.ts` |

**Dependencies:** SI-03.6 — metadata e thumbnail; SI-03.3 — URLs GET assinadas; SI-03.5 — controller/módulo HTTP

**Acceptance criteria:**

- `GET /videos/{id}` do dono retorna `200` com a URL canônica baseada no UUID e links de mídia somente quando aplicáveis ao estado.
- Consultar UUID inexistente ou pertencente a outro canal retorna o mesmo `404 VIDEO_NOT_FOUND`.
- Thumbnail, stream ou download antes de `READY` retorna `409 VIDEO_NOT_READY` sem assinar objeto algum.
- Cada endpoint binário de vídeo `READY` retorna `307` para URL privada válida por 900 segundos.
- Seguir o redirect de streaming com `Range` retorna `206`, `Accept-Ranges`, `Content-Range` e apenas o intervalo solicitado.
- Seguir o redirect de download retorna o arquivo completo como attachment com nome sanitizado.

---

### SI-03.8 — Sincronizar contratos e documentação operacional

**Description:** Fechar a fase com contrato consumível, arquitetura atualizada e instruções reproduzíveis para executar e verificar todo o fluxo.

**Technical actions:**

1. Exportar `nestjs-project/openapi.json`, executar `scripts/sync-openapi.sh` e regenerar `next-frontend/lib/api/types.gen.ts` com `npm run openapi:types` (per `openapi-docs-nestjs/TD-02`, `next-frontend-openapi-typing/TD-01`, `next-frontend-openapi-typing/TD-02`).
2. Atualizar `docs/diagrams/software-arch.mermaid` e `README.md` com Redis, MinIO, worker FFmpeg, buckets privados, fluxo multipart e comandos de operação.
3. Atualizar `AGENTS.md` e `nestjs-project/AGENTS.md` como equivalentes ativos das instruções da ferramenta, documentando convenções de upload, storage, fila, worker e verificação da Fase 03.
4. Documentar no `README.md` um roteiro manual autenticado: iniciar upload, enviar partes diretamente, completar, acompanhar `PROCESSING → READY`, reproduzir por range e baixar.
5. Executar a matriz completa de validação da fase, incluindo suites backend/frontend afetadas, compilação, lint, migrations e smoke do Compose com mídia real.

**Tests:** _(empty — contract generation and operational documentation; behavior tests belong to SI-03.1 through SI-03.7)_

**Dependencies:** SI-03.5 — contrato de upload; SI-03.7 — contrato de leitura; SI-03.6 — fluxo operacional completo

**Acceptance criteria:**

- `nestjs-project/openapi.json` e `next-frontend/openapi.json` são idênticos e descrevem todas as oito operações de vídeo.
- Regenerar `next-frontend/lib/api/types.gen.ts` não produz erro nem tipos manuais para os contratos de vídeo.
- O diagrama e o README mostram corretamente API → Redis → worker e API/worker → MinIO, sem usar `localhost` entre containers.
- As instruções permitem que outra pessoa execute upload multipart, processamento, streaming parcial e download do início ao fim.
- O fluxo operacional com fixture real termina em `READY`, entrega JPEG válido, responde `206` no range e baixa o arquivo original.
- Nenhuma credencial, bucket, object key, caminho temporário ou erro bruto do FFmpeg aparece nas respostas HTTP.

---

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | `uuid` | PK, generated; canonical public identifier and unique URL segment |
| `channel_id` | `uuid` | FK → `channels.id`, not null, `ON DELETE RESTRICT` |
| `title` | `varchar(255)` | not null; trimmed; 1–255 characters |
| `status` | `video_status` enum | not null, default `DRAFT`; values `DRAFT`, `PROCESSING`, `READY`, `ERROR` |
| `original_filename` | `varchar(255)` | not null; display/audit only, never used as an object key |
| `content_type` | `varchar(127)` | not null; accepted initial values `video/mp4`, `video/webm`, `video/quicktime` |
| `size_bytes` | `bigint` | not null; check `size_bytes > 0 AND size_bytes <= 10737418240` |
| `source_bucket` | `varchar(63)` | not null; private video bucket from storage config |
| `source_key` | `varchar(1024)` | not null, unique; deterministic `videos/{id}/source` prefix |
| `thumbnail_bucket` | `varchar(63)` | nullable until processing succeeds |
| `thumbnail_key` | `varchar(1024)` | nullable, unique; deterministic `thumbnails/{id}/default.jpg` |
| `multipart_upload_id` | `varchar(512)` | nullable; present while the source upload is incomplete |
| `duration_seconds` | `numeric(12,3)` | nullable until processing succeeds, non-negative |
| `metadata` | `jsonb` | nullable; normalized format/stream metadata owned by the worker |
| `processing_error` | `varchar(500)` | nullable; sanitized terminal error only, cleared on success |
| `uploaded_at` | `timestamptz` | nullable; set after object completion and `HeadObject` verification |
| `processed_at` | `timestamptz` | nullable; set with `READY` or terminal `ERROR` |
| `created_at` | `timestamptz` | not null, default now() |
| `updated_at` | `timestamptz` | not null, auto-updated |

**Relations:** `Video` belongs to one `Channel` through a unidirectional `ManyToOne`; `channel_id` remains explicit for ownership queries. The videos module never persists a `Channel` entity.

**Indexes:** btree on `channel_id`; btree on `status`; unique on `source_key`; partial unique on `thumbnail_key WHERE thumbnail_key IS NOT NULL`.

**Metadata JSON shape:**

```json
{
  "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
  "bit_rate": 1200000,
  "video_codec": "h264",
  "audio_codec": "aac",
  "width": 1920,
  "height": 1080,
  "frame_rate": "30/1"
}
```

**State transitions:**

| From | Trigger | To | Required side effects |
|------|---------|----|-----------------------|
| — | initiate upload | `DRAFT` | Create multipart upload and persist its ID |
| `DRAFT` | complete upload + verify object + accept queue publication | `PROCESSING` | Clear `multipart_upload_id`, set `uploaded_at`, enqueue one `video.process` job |
| `PROCESSING` | worker succeeds | `READY` | Persist duration/metadata/thumbnail and set `processed_at` atomically |
| `PROCESSING` | final BullMQ attempt fails | `ERROR` | Persist sanitized `processing_error` and set `processed_at` |
| `READY` | duplicate delivery | `READY` | No-op success; do not regenerate assets |

### API Contracts

All routes inherit the global JWT guard and error envelope `{ statusCode, error, message }`. Storage credentials, bucket names, object keys and raw FFprobe output never appear in responses.

#### POST /videos/uploads (SI-03.4)

**Request headers:**
- `Authorization: Bearer <access_token>`
- `Content-Type: application/json`

**Request body:**
- `title`: string, required, trimmed, 1–255 characters
- `original_filename`: string, required, 1–255 characters
- `content_type`: enum, required — `video/mp4`, `video/webm`, `video/quicktime`
- `size_bytes`: integer, required — 1 through `10737418240`

**Response 201:**
- `id`: string (uuid)
- `status`: `DRAFT`
- `upload.upload_id`: string
- `upload.part_size_bytes`: `67108864`
- `upload.part_count`: integer, `ceil(size_bytes / 67108864)`
- `upload.expires_in_seconds`: `900`

**Error responses:**
- `400 VALIDATION_ERROR`: malformed metadata
- `413 VIDEO_TOO_LARGE`: `size_bytes` exceeds 10 GB
- `415 VIDEO_TYPE_UNSUPPORTED`: `content_type` is outside the allowlist
- `503 STORAGE_UNAVAILABLE`: multipart initialization fails; no `Video` row remains

---

#### POST /videos/{id}/uploads/parts (SI-03.4)

**Request headers:**
- `Authorization: Bearer <access_token>`
- `Content-Type: application/json`

**Request body:**
- `part_numbers`: array of 1–20 distinct integers; each value is between `1` and the persisted `part_count`

**Response 200:**
- `parts`: array of `{ part_number: integer, url: string, expires_at: string (date-time) }`

**Error responses:**
- `400 UPLOAD_PARTS_INVALID`: duplicates, empty batch, more than 20 values or out-of-range part number
- `404 VIDEO_NOT_FOUND`: ID is absent or not owned by the authenticated user's channel
- `409 VIDEO_INVALID_STATE`: video is not `DRAFT` or has no active multipart upload
- `503 STORAGE_UNAVAILABLE`: one or more URLs cannot be signed

---

#### POST /videos/{id}/uploads/complete (SI-03.4)

**Request headers:**
- `Authorization: Bearer <access_token>`
- `Content-Type: application/json`

**Request body:**
- `parts`: complete ordered array of `{ part_number: integer, etag: string }`; part numbers are distinct and cover `1..part_count`

**Response 202:**
- `id`: string (uuid)
- `status`: `PROCESSING`

**Error responses:**
- `400 UPLOAD_PARTS_INVALID`: part list is incomplete, duplicated, unordered or contains an empty `etag`
- `404 VIDEO_NOT_FOUND`: ID is absent or not owned by the authenticated user's channel
- `409 VIDEO_INVALID_STATE`: video cannot transition from its current state
- `422 UPLOAD_SIZE_MISMATCH`: completed object's `ContentLength` differs from `size_bytes`; object is removed and video remains `DRAFT`
- `503 STORAGE_UNAVAILABLE`: completion or verification fails transiently
- `503 QUEUE_UNAVAILABLE`: job was not accepted; uploaded object remains recoverable and a repeated complete call may enqueue it idempotently

---

#### DELETE /videos/{id}/uploads (SI-03.4)

**Request headers:**
- `Authorization: Bearer <access_token>`

**Response 204:** No content. Aborts an active multipart upload, removes any incomplete source object and deletes the `DRAFT` row.

**Error responses:**
- `404 VIDEO_NOT_FOUND`: ID is absent or not owned by the authenticated user's channel
- `409 VIDEO_INVALID_STATE`: only a `DRAFT` upload may be aborted
- `503 STORAGE_UNAVAILABLE`: storage cleanup failed; database row is preserved for retry

---

#### GET /videos/{id} (SI-03.6)

**Request headers:**
- `Authorization: Bearer <access_token>`

**Response 200:**
- `id`: string (uuid)
- `title`: string
- `status`: `DRAFT | PROCESSING | READY | ERROR`
- `original_filename`: string
- `content_type`: string
- `size_bytes`: integer
- `duration_seconds`: number or null
- `metadata`: normalized object or null
- `processing_error`: string or null; present only for `ERROR`
- `thumbnail_url`: `/videos/{id}/thumbnail` or null
- `stream_url`: `/videos/{id}/stream` or null
- `download_url`: `/videos/{id}/download` or null
- `created_at`, `updated_at`, `uploaded_at`, `processed_at`: date-time or null as applicable

**Error responses:**
- `404 VIDEO_NOT_FOUND`: ID is absent or not owned by the authenticated user's channel

---

#### GET /videos/{id}/thumbnail (SI-03.6)

**Request headers:**
- `Authorization: Bearer <access_token>`

**Response 307:** `Location` contains a 15-minute GET URL for the private JPEG thumbnail.

**Error responses:**
- `404 VIDEO_NOT_FOUND`: ID is absent or not owned by the authenticated user's channel
- `409 VIDEO_NOT_READY`: status is not `READY` or thumbnail metadata is absent
- `503 STORAGE_UNAVAILABLE`: URL signing fails

---

#### GET /videos/{id}/stream (SI-03.6)

**Request headers:**
- `Authorization: Bearer <access_token>`
- `Range`: optional byte range; preserved by the `307` redirect when the client follows it

**Response 307:** `Location` contains a 15-minute GET URL for the private source object. MinIO/S3 serves range requests with `206 Partial Content`, `Accept-Ranges`, `Content-Range` and bounded `Content-Length`.

**Error responses:**
- `404 VIDEO_NOT_FOUND`: ID is absent or not owned by the authenticated user's channel
- `409 VIDEO_NOT_READY`: status is not `READY`
- `503 STORAGE_UNAVAILABLE`: URL signing fails

---

#### GET /videos/{id}/download (SI-03.6)

**Request headers:**
- `Authorization: Bearer <access_token>`

**Response 307:** `Location` contains a 15-minute GET URL whose response overrides `Content-Disposition` to `attachment; filename="<sanitized-original-filename>"`.

**Error responses:**
- `404 VIDEO_NOT_FOUND`: ID is absent or not owned by the authenticated user's channel
- `409 VIDEO_NOT_READY`: status is not `READY`
- `503 STORAGE_UNAVAILABLE`: URL signing fails

---

#### Validation Rules — uploads and media access

- `id`: valid UUID; malformed values return the standard `400 VALIDATION_ERROR`
- `original_filename`: basename only after sanitization; path separators and control characters are rejected
- Declared `content_type` and extension are preliminary; the worker treats missing video streams or an incompatible probed format as processing failure
- `size_bytes` is checked before multipart creation and rechecked against `HeadObject.ContentLength` after completion
- Multipart part URLs are signed only for the stored bucket, key and `upload_id`; the client cannot choose object keys
- Completion and abort operations use ownership + state compare-and-set semantics to remain idempotent under concurrent requests

### Authorization Matrix

| Operation | Anonymous | Authenticated non-owner | Video owner | Additional condition |
|---|---:|---:|---:|---|
| Initialize multipart upload | No (`401`) | Yes, for the authenticated user's channel | Yes | The authenticated user must own an existing channel |
| Sign upload parts | No (`401`) | No (`404`) | Yes | Video must be `DRAFT` |
| Complete multipart upload | No (`401`) | No (`404`) | Yes | Video must be `DRAFT` and submitted parts must match storage |
| Abort multipart upload | No (`401`) | No (`404`) | Yes | Video must be `DRAFT` |
| Read video metadata | No (`401`) | No (`404`) | Yes | Available in every lifecycle state |
| Read thumbnail | No (`401`) | No (`404`) | Yes | Video must be `READY` |
| Stream video | No (`401`) | No (`404`) | Yes | Video must be `READY` |
| Download video | No (`401`) | No (`404`) | Yes | Video must be `READY` |

Ownership is resolved through `videos.channel_id -> channels.user_id`. Owner-only access is intentional for Phase 03; anonymous/public playback and catalog visibility belong to later phases. Existing JWT guards continue to produce `401`, while owner-protected lookups use `404` for non-owners to avoid disclosing whether a video exists.

### Error Catalog

All new HTTP errors use the existing envelope `{ statusCode, error, message }`. The `error` value is the stable application code below; validation pipes and authentication guards retain their existing framework behavior.

| Error | HTTP | Applies when |
|---|---:|---|
| `VALIDATION_ERROR` | 400 | A request body, parameter or multipart part list is malformed |
| `UPLOAD_PARTS_INVALID` | 400 | Part numbers, ETags, ordering or duplicates are invalid |
| `VIDEO_TOO_LARGE` | 413 | Declared or stored source size exceeds 10 GiB |
| `VIDEO_TYPE_UNSUPPORTED` | 415 | The declared source MIME type is outside the Phase 03 allowlist |
| `VIDEO_NOT_FOUND` | 404 | The video does not exist or is not owned by the caller |
| `VIDEO_INVALID_STATE` | 409 | The requested operation is not permitted in the current lifecycle state |
| `VIDEO_NOT_READY` | 409 | Thumbnail, stream or download is requested before `READY` |
| `UPLOAD_SIZE_MISMATCH` | 422 | The completed object size differs from the size declared at initialization |
| `STORAGE_UNAVAILABLE` | 503 | S3-compatible storage cannot initialize, verify, sign or abort the upload |
| `QUEUE_UNAVAILABLE` | 503 | Processing cannot be scheduled after upload verification |

The API must not return provider errors, bucket names, object keys, filesystem paths or FFmpeg output to clients. Processing diagnostics are stored in `processing_error` in a sanitized, bounded form and written in full only to server logs.

### Events and Messages

#### `video.process`

| Property | Contract |
|---|---|
| Queue | `video-processing` |
| Producer | Videos API after multipart completion and `HeadObject` verification |
| Consumer | Dedicated NestJS worker process (`VideoProcessor`) |
| Payload | `{ "version": 1, "videoId": "<uuid>" }` |
| Delivery | At least once |
| Deduplication | BullMQ `jobId` derived from `videoId`; the database state remains the source of truth |
| Retry | 3 attempts with exponential backoff starting at 5 seconds |
| Retention | Keep the latest 100 completed and 500 failed jobs |
| Concurrency | 1 job per worker instance initially; configurable by environment variable |

The completion flow verifies the stored object, persists `PROCESSING`, and publishes the job. If publication fails, it compensates the video back to `DRAFT`, retains the completed source and multipart identity, and returns `QUEUE_UNAVAILABLE`, allowing a safe completion retry without uploading the bytes again.

The worker locks the video row and applies these idempotency rules:

1. `READY` is a successful no-op.
2. Any state other than `PROCESSING` is ignored as stale work.
3. For `PROCESSING`, download the source into a per-job temporary directory, run `ffprobe` for normalized metadata, generate one JPEG thumbnail with `ffmpeg`, upload it to the thumbnail bucket, and atomically persist metadata plus `READY`.
4. A retryable failure leaves the row in `PROCESSING` so BullMQ can retry it. Once attempts are exhausted, a failure hook changes the row to `ERROR` and stores a sanitized diagnostic.
5. Temporary source and output files are removed in `finally`; repeated processing overwrites the deterministic thumbnail key and never creates a second video row.

Queue payloads carry identifiers only. Video titles, storage credentials, signed URLs and processing metadata never cross Redis.

---

## Dependency Map

SI-03.1 (root — dependencies, config and Compose services)
└── SI-03.2 — depends on SI-03.1 (module and environment foundation)
    └── SI-03.3 — depends on SI-03.1 + SI-03.2 (storage config and persisted object identity)
        └── SI-03.4 — depends on SI-03.2 + SI-03.3 (lifecycle plus storage operations)
            ├── SI-03.5 — depends on SI-03.4 (upload use cases before HTTP wiring)
            └── SI-03.6 — depends on SI-03.1 + SI-03.3 + SI-03.4 (worker runtime, media transfer and jobs)
                └── SI-03.7 — depends on SI-03.3 + SI-03.5 + SI-03.6 (signed delivery, controller and ready assets)
                    └── SI-03.8 — depends on SI-03.5 + SI-03.6 + SI-03.7 (complete contract and flow)

---

## Deliverables

- [x] SI-03.1 — Preparar infraestrutura de storage, fila e worker
- [x] SI-03.2 — Persistir o ciclo de vida de vídeos
- [x] SI-03.3 — Implementar o adaptador S3 privado
- [x] SI-03.4 — Orquestrar uploads e publicação do processamento
- [x] SI-03.5 — Expor os endpoints de upload multipart
- [x] SI-03.6 — Processar vídeos no worker FFmpeg
- [x] SI-03.7 — Expor metadata, streaming, thumbnail e download
- [x] SI-03.8 — Sincronizar contratos e documentação operacional

**Full test suites:**

- [x] Backend unit tests pass (`cd nestjs-project && npm test -- --runInBand`)
- [x] Backend integration tests pass (`cd nestjs-project && npm run test:integration`)
- [x] Backend E2E tests pass (`cd nestjs-project && npm run test:e2e`)
- [x] Backend lint passes (`cd nestjs-project && npm run lint`)
- [x] Backend compilation passes (`cd nestjs-project && npx tsc --noEmit`)
- [x] Backend build succeeds (`cd nestjs-project && npm run build`)
- [x] TypeORM migrations pass in both directions against PostgreSQL (`cd nestjs-project && npm run test:integration -- migrations.integration-spec.ts`)
- [x] OpenAPI export and sync complete (`cd nestjs-project && npm run openapi:export`, then `./scripts/sync-openapi.sh`)
- [x] Frontend generated types are current (`cd next-frontend && npm run openapi:types && npx tsc --noEmit`)
- [x] Frontend contract-facing tests and lint pass (`cd next-frontend && npm test && npm run lint`)
- [x] Compose healthchecks and the authenticated upload → process → range stream → download smoke flow pass with real PostgreSQL, Redis, MinIO and FFmpeg.
