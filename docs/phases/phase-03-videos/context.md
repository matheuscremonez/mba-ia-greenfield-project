---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-07-20T11:08:56-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-20T11:55:35-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-07-20T11:08:56-03:00"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-07-20T11:08:56-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-07-20T11:08:56-03:00"
  docs/phases/phase-02-auth/context.md: "2026-07-20T11:08:56-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-07-20T11:08:56-03:00"
  .agents/skills/testing-guide-nestjs-project/SKILL.md: "2026-07-20T11:31:17-03:00"
  .agents/skills/testing-guide-nestjs-project/references/external-systems.md: "2026-07-20T11:08:56-03:00"
  .agents/skills/testing-guide-nestjs-project/artifacts/entities.md: "2026-07-20T11:08:56-03:00"
  .agents/skills/testing-guide-nestjs-project/artifacts/services.md: "2026-07-20T11:08:56-03:00"
  .agents/skills/testing-guide-nestjs-project/artifacts/modules.md: "2026-07-20T11:08:56-03:00"
  .agents/skills/testing-guide-nestjs-project/artifacts/controllers.md: "2026-07-20T11:08:56-03:00"
  .agents/skills/testing-guide-nestjs-project/artifacts/dtos.md: "2026-07-20T11:08:56-03:00"
  .agents/skills/testing-guide-nestjs-project/artifacts/future-types.md: "2026-07-20T11:08:56-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-07-20T12:04:47-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities**

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** Interface de upload/player; edição, publicação, visibilidade e thumbnail customizada da Fase 04; página de visualização, acesso anônimo e player da Fase 05.

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando e URLs únicas geradas.

**Affected subprojects:** `nestjs-project/` e infraestrutura Docker do backend.

**Deferred subprojects:** `next-frontend/` — somente os artefatos OpenAPI/tipos gerados são sincronizados quando o contrato muda; nenhuma interface de vídeo é implementada.

**Sequencing notes:** Depende das Fases 01 e 02.

**Neighbors (for boundary detection only):**

- **Phase 02:** Cadastro, Login e Gerenciamento de Conta — fornece autenticação, usuários e canais.
- **Phase 04:** Gerenciamento de Vídeos e Canal — depende desta fase para editar, publicar e listar vídeos.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | technical-decisions-phase-03-videos.md | Backend | Tecnologia da fila de processamento | decided | A (BullMQ com Redis) | `@nestjs/bullmq@^11.0.4`, `bullmq@^5.80.9` |
| phase-03-videos/TD-02 | technical-decisions-phase-03-videos.md | Backend | Protocolo de upload de até 10 GB | decided | A (multipart S3 direto) | `@aws-sdk/client-s3@^3.1090.0`, `@aws-sdk/s3-request-presigner@^3.1090.0` |
| phase-03-videos/TD-03 | technical-decisions-phase-03-videos.md | Backend | Organização e acesso ao object storage | decided | A (dois buckets privados e AWS SDK v3) | `@aws-sdk/client-s3@^3.1090.0`, `@aws-sdk/s3-request-presigner@^3.1090.0` |
| phase-03-videos/TD-04 | technical-decisions-phase-03-videos.md | Backend | Processo do worker e integração com FFmpeg | decided | A (worker NestJS separado) | FFmpeg/ffprobe system packages |
| phase-03-videos/TD-05 | technical-decisions-phase-03-videos.md | Backend | Garantia de processamento, retries e ciclo de status | decided | A (pelo menos uma vez + idempotência) | `bullmq@^5.80.9` |
| phase-03-videos/TD-06 | technical-decisions-phase-03-videos.md | Backend | Identificador da URL única | decided | A (UUID do vídeo) | — |
| phase-03-videos/TD-07 | technical-decisions-phase-03-videos.md | Backend | Streaming e download | decided | A (redirecionamento GET pré-assinado) | `@aws-sdk/client-s3@^3.1090.0`, `@aws-sdk/s3-request-presigner@^3.1090.0` |

_Source files:_

- `phase-03-videos` — `docs/decisions/technical-decisions-phase-03-videos.md` (`scope_type: phase`, `related_phases: [3]`)

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-03 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-05 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-04, phase-03-videos/TD-05 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-04 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-06 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-07 |
| Download do vídeo pelo usuário | phase-03-videos/TD-07 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** BullMQ com Redis atende retries, deduplicação e worker distribuído com a menor complexidade para NestJS 11.

**Libraries:** `@nestjs/bullmq@^11.0.4`, `bullmq@^5.80.9`

### phase-03-videos/TD-02

**Recommendation:** Multipart S3 direto combina 10 GB, retomada por partes, compatibilidade MinIO/S3 e remoção do tráfego pesado da API; partes de 64 MiB limitam o máximo a aproximadamente 160 partes.

**Libraries:** `@aws-sdk/client-s3@^3.1090.0`, `@aws-sdk/s3-request-presigner@^3.1090.0`

### phase-03-videos/TD-03

**Recommendation:** Dois buckets privados com AWS SDK v3 preservam a portabilidade MinIO/S3, mantêm a futura visibilidade fora do storage e permitem lifecycle independente.

**Libraries:** `@aws-sdk/client-s3@^3.1090.0`, `@aws-sdk/s3-request-presigner@^3.1090.0`

### phase-03-videos/TD-04

**Recommendation:** Um worker NestJS separado com FFmpeg/ffprobe do sistema mantém a API responsiva e evita wrappers desnecessários; temporários existem somente durante o job.

**Libraries:** FFmpeg/ffprobe system packages (version pinned by worker image)

### phase-03-videos/TD-05

**Recommendation:** Entrega pelo menos uma vez com worker idempotente combina retries e simplicidade; o estado `PROCESSING` só é confirmado quando a publicação do job é aceita.

**Libraries:** `bullmq@^5.80.9`

### phase-03-videos/TD-06

**Recommendation:** O UUID do vídeo fornece URL única, estável e não sequencial desde o rascunho, sem outro campo ou dependência.

**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** Endpoints autorizados redirecionam para GET pré-assinado, mantendo autorização no domínio e bytes fora da API; nesta fase o acesso é restrito ao dono autenticado.

**Libraries:** `@aws-sdk/client-s3@^3.1090.0`, `@aws-sdk/s3-request-presigner@^3.1090.0`

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Usar `@nestjs/config` com factories `registerAs()` compartilháveis entre DI e TypeORM CLI.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Validar ambiente com Joi integrado ao `ConfigModule`.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Organizar configuração por domínio com factories namespaced.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Reutilizar as mesmas factories fora da DI, sem duplicar configuração no `data-source.ts`.

**Libraries:** `dotenv` (transitiva)

### phase-02-auth/TD-02

**Recommendation:** A autenticação JWT existente permanece a fronteira para identificar o usuário atual.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-06

**Recommendation:** DTOs usam `class-validator` e `class-transformer`, conforme o padrão NestJS já implementado.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Serviços lançam exceções de domínio; filtros convertem para `{ statusCode, error, message }` com códigos legíveis por máquina.

**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** Documentar controllers/DTOs com `@nestjs/swagger`, preservando o stack `class-validator`.

**Libraries:** `@nestjs/swagger`

### openapi-docs-nestjs/TD-02

**Recommendation:** Manter Swagger UI local e o artefato `openapi.json` exportável/commitado.

**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** Expor Swagger UI somente em desenvolvimento/staging.

**Libraries:** —

### next-frontend-openapi-typing/TD-01

**Recommendation:** Consumir o contrato com `openapi-typescript` e `openapi-fetch` no BFF.

**Libraries:** `openapi-typescript`, `openapi-fetch`

### next-frontend-openapi-typing/TD-02

**Recommendation:** Sincronizar uma cópia local commitada do OpenAPI por script na raiz, preservando a independência dos Compose stacks.

**Libraries:** —

### next-frontend-openapi-typing/TD-03

**Recommendation:** Commitar spec e tipos gerados e verificar freshness em CI.

**Libraries:** —

## Inherited Conventions

- Backend config usa `@nestjs/config` com factories `registerAs()` namespaced, uma por domínio. _(from phase 01)_
- Variáveis de ambiente são validadas com Joi; chaves desconhecidas são permitidas e todos os erros são reportados. _(from phase 01)_
- Config é injetada com `ConfigType<typeof config>` e `@Inject(config.KEY)`; a factory permanece chamável fora da DI. _(from phase 01)_
- `data-source.ts` carrega `.env` e reutiliza `databaseConfig`; não duplica parâmetros de conexão. _(from phase 01)_
- TypeORM usa `forRootAsync`, `autoLoadEntities: true` e `synchronize: false`; mudanças de schema usam migrations. _(from phase 01)_
- Módulos mantêm ownership de domínio; vídeos referenciam canais por serviço/repositório explícito sem assumir ownership da entidade de outro módulo. _(from phase 02)_
- Serviços lançam exceções de domínio e controllers permanecem finos. _(from phase 02)_
- Endpoints protegidos usam o guard JWT global e `@CurrentUser()` já existentes. _(from phase 02)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | UI foi postergada na fundação original. |
| Confirmação e destino de reset de senha | deferred | phase-02-auth-frontend | Telas ausentes permanecem fora desta fase backend. |
| Logout no chrome autenticado | deferred | phase-02-auth-frontend | Pertence a uma fase futura de UI. |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| `Video` entity + migration | Integração com PostgreSQL real: UUID, enum/status defaults, FK para canal, JSONB/metadados, constraints e migration `up/down`. |
| Video application/domain services | Unit para ownership, transições e idempotência; integração para queries e transações reais. |
| S3 storage adapter | Integração de multipart, `HeadObject`, upload/download/range e cleanup. O guia genérico prevê filesystem local, enquanto a fase exige MinIO real no Compose; a validação deve reconciliar a estratégia. |
| BullMQ producer/consumer | Integração com Redis real: publicação, deduplicação, retries e resultado; filas isoladas/limpas entre testes. |
| Worker/processor | Unit para branches e comandos; integração com PostgreSQL, MinIO, Redis e mídia fixture real para ffprobe/thumbnail. |
| Config modules | Unit/integração de bootstrap: envs ausentes ou inválidos falham; hosts usam nomes de serviço no Compose. |
| `VideosModule` / worker module | Teste de compilação DI com TypeORM, BullMQ, storage e configurações reais/test-safe. |
| Controllers + DTOs | E2E via Supertest com `AppModule`, pipes/filtros/guard globais, auth, validação, status e error envelope. Sem unit test de controller. |
| OpenAPI | Integração do documento exportado; sincronizar `openapi.json` e regenerar tipos do frontend quando o contrato mudar. |
| Compose stack | Teste operacional dos healthchecks e do fluxo API → MinIO/Redis → worker → PostgreSQL, sem mocks para serviços disponíveis localmente. |
