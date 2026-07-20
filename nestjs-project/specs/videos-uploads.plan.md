---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5
target_file: test/videos-upload.e2e-spec.ts
---

# Videos Upload Endpoints Test Plan

## Application Overview

Valida o contrato HTTP autenticado para iniciar, assinar partes, concluir e abortar uploads multipart, usando PostgreSQL, Redis e MinIO reais e preservando os efeitos externos definidos para cada erro.

## Test Scenarios

### 1. Initialize multipart upload

**Setup:** Limpar as tabelas de teste, garantir os buckets privados, inicializar `AppModule` com pipes/filtros/guard globais e autenticar um usuário com canal.

#### 1.1. initialize-valid-draft

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-20T15:13:10Z

**Steps:**
  1. Enviar `POST /videos/uploads` com título, filename, MIME aceito e tamanho válido.
    - expect: status HTTP `201`.
    - expect: corpo contém UUID, status `DRAFT`, `upload_id`, `part_size_bytes: 67108864`, `part_count` e `expires_in_seconds: 900`.
  2. Consultar PostgreSQL e MinIO pelo identificador retornado.
    - expect: existe exatamente um rascunho associado ao canal autenticado e um multipart ativo na chave determinística.

#### 1.2. reject-invalid-upload-metadata

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-20T15:13:10Z

**Steps:**
  1. Enviar metadata ausente ou malformada.
    - expect: status HTTP `400` com `error: "VALIDATION_ERROR"`.
  2. Enviar `size_bytes` superior a `10737418240`.
    - expect: status HTTP `413` com `error: "VIDEO_TOO_LARGE"`.
  3. Enviar MIME fora da allowlist.
    - expect: status HTTP `415` com `error: "VIDEO_TYPE_UNSUPPORTED"`.
  4. Consultar banco e storage após cada rejeição.
    - expect: nenhum vídeo ou multipart residual foi criado.

### 2. Sign upload parts

**Setup:** Criar um upload `DRAFT` do usuário autenticado com multipart ativo e quantidade de partes conhecida.

#### 2.1. sign-only-requested-valid-parts

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-20T15:13:10Z

**Steps:**
  1. Enviar `POST /videos/{id}/uploads/parts` com números distintos dentro do intervalo.
    - expect: status HTTP `200` e uma URL pública de 900 segundos para cada parte solicitada, sem credenciais ou object key no corpo.
  2. Repetir com lote vazio, duplicado, desordenado, maior que 20 ou fora do intervalo.
    - expect: status HTTP `400` com `error: "UPLOAD_PARTS_INVALID"`.

### 3. Complete multipart upload

**Setup:** Enviar todas as partes diretamente ao MinIO e guardar `{ part_number, etag }` na ordem completa.

#### 3.1. complete-valid-upload-for-processing

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-07-20T15:13:10Z

**Steps:**
  1. Enviar `POST /videos/{id}/uploads/complete` com a lista completa de partes.
    - expect: status HTTP `202` com o mesmo UUID e status `PROCESSING`.
  2. Consultar PostgreSQL e Redis.
    - expect: `uploaded_at` está preenchido, `multipart_upload_id` foi limpo e existe um único job `video.process` para o UUID.

### 4. Abort multipart upload

**Setup:** Criar um upload `DRAFT` com multipart ativo e pelo menos uma parte enviada.

#### 4.1. abort-draft-and-clean-resources

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-07-20T15:13:10Z

**Steps:**
  1. Enviar `DELETE /videos/{id}/uploads` como dono.
    - expect: status HTTP `204` e corpo vazio.
  2. Consultar PostgreSQL e MinIO.
    - expect: a linha, o multipart e qualquer parte incompleta deixaram de existir.

### 5. Authentication boundary

**Setup:** Criar um rascunho válido, mas não enviar cabeçalho `Authorization` nas chamadas deste grupo.

#### 5.1. reject-anonymous-upload-operations-without-side-effects

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-07-20T15:13:10Z

**Steps:**
  1. Chamar cada uma das quatro rotas de upload sem JWT.
    - expect: todas retornam status HTTP `401` no envelope padrão.
  2. Comparar banco, Redis e MinIO antes e depois das chamadas.
    - expect: nenhuma linha, parte, assinatura, conclusão, aborto ou job foi criado.
