---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: test/videos-media.e2e-spec.ts
---

# Videos Media Access Endpoints Test Plan

## Application Overview

Valida leitura owner-scoped e entrega privada de metadata, thumbnail, streaming por ranges e download via redirects pré-assinados, mantendo os bytes e detalhes internos fora da API NestJS.

## Test Scenarios

### 1. Read video metadata

**Setup:** Limpar as tabelas, inicializar `AppModule` com configuração global real e autenticar um usuário com vídeos em diferentes estados.

#### 1.1. read-owner-video-with-state-aware-links

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-20T15:13:10Z

**Steps:**
  1. Enviar `GET /videos/{id}` como dono para um vídeo `DRAFT`.
    - expect: status HTTP `200`, UUID canônico e links de thumbnail/stream/download nulos.
  2. Repetir para um vídeo `READY` com metadata e thumbnail.
    - expect: status HTTP `200` com duração, metadata normalizada e os três links relativos.
    - expect: resposta não contém bucket, object key, multipart ID, credenciais ou ffprobe bruto.

#### 1.2. hide-absent-and-foreign-video-equally

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-20T15:13:10Z

**Steps:**
  1. Consultar um UUID inexistente como usuário autenticado.
    - expect: status HTTP `404` com `error: "VIDEO_NOT_FOUND"`.
  2. Consultar um vídeo pertencente a outro canal.
    - expect: status, código e shape são idênticos ao UUID inexistente.

### 2. Enforce ready state

**Setup:** Criar um vídeo do dono em `PROCESSING` sem thumbnail e observar as chamadas ao adaptador de storage.

#### 2.1. reject-media-before-ready

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-20T15:13:10Z

**Steps:**
  1. Chamar `/thumbnail`, `/stream` e `/download` para o vídeo ainda não pronto.
    - expect: cada chamada retorna status HTTP `409` com `error: "VIDEO_NOT_READY"`.
  2. Verificar as interações de assinatura.
    - expect: nenhuma URL GET foi assinada.

### 3. Redirect ready media

**Setup:** Criar um vídeo `READY`, colocar fonte e JPEG válidos nos buckets privados e autenticar o dono.

#### 3.1. issue-short-lived-private-redirects

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-07-20T15:13:10Z

**Steps:**
  1. Chamar os endpoints de thumbnail, stream e download sem seguir redirects.
    - expect: cada resposta tem status HTTP `307` e header `Location` apontando para o endpoint público do storage.
    - expect: cada URL expira em 900 segundos e não revela credenciais.

### 4. Stream byte ranges

**Setup:** Reusar o vídeo `READY` com fonte conhecida e permitir que o cliente siga a URL de streaming.

#### 4.1. stream-only-requested-byte-range

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-07-20T15:13:10Z

**Steps:**
  1. Obter o redirect em `GET /videos/{id}/stream` e segui-lo com `Range: bytes=0-1023`.
    - expect: storage retorna `206 Partial Content`, `Accept-Ranges: bytes`, `Content-Range` correto e `Content-Length: 1024`.
    - expect: corpo contém somente os 1024 bytes solicitados.

### 5. Download original media

**Setup:** Reusar o vídeo `READY` cujo filename original contém espaços e caracteres que exigem sanitização.

#### 5.1. download-complete-source-as-safe-attachment

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-07-20T15:13:10Z

**Steps:**
  1. Obter o redirect em `GET /videos/{id}/download` e segui-lo.
    - expect: status HTTP `200`, corpo igual ao objeto fonte completo e `Content-Disposition` como attachment.
    - expect: filename é sanitizado e não contém separadores de caminho ou caracteres de controle.
