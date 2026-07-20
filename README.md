# StreamTube — Plataforma de Compartilhamento de Vídeos

Projeto da disciplina **Desenvolvimento de Aplicações de IA** do MBA de Engenharia de Software com IA da [Full Cycle](https://fullcycle.com.br).

Este é um projeto greenfield desenvolvido para demonstrar como construir uma aplicação do zero utilizando IA de forma adequada no processo de desenvolvimento.

## Professor

<a href="https://github.com/argentinaluiz">
    <img src="https://avatars.githubusercontent.com/u/4926329?v=4?s=100" width="100px;" alt=""/>
    <br />
    <sub>
        <b>Luiz Carlos</b>
    </sub>
</a>

---

## Quadro Branco

- [Quadro Branco](./whiteboard.png)

---

## 🎨 Design System (Figma)

- [FC Tube.fig](./FC%20Tube.fig) — arquivo-fonte do **design system** do projeto no Figma.

Contém os fundamentos visuais do StreamTube — tokens (cores, tipografia, espaçamento, raios), componentes e as telas da plataforma. É a referência de design para a implementação do frontend: os componentes em `next-frontend/components/ui` (shadcn) e os tokens em `next-frontend/app/globals.css` derivam deste arquivo. Abra-o no Figma (`Arquivo → Importar`) para consultar especificações e estados visuais.

---

## 📋 Pré-requisitos

- Docker e Docker Compose
- Node.js v25+ (para rodar os testes E2E do Playwright no host)
- npm

## 🏗️ Arquitetura

O projeto é um monorepo baseado em containers Docker. Cada subprojeto sobe sua própria stack via `docker compose`.

- **Frontend** (Next.js 16, App Router + React Server Components) — interface da plataforma. Segue o **modelo BFF**: o navegador nunca chama a API NestJS diretamente; todo tráfego passa por Route Handlers same-origin em `app/api/**`, que fazem proxy server-side para a API.
- **API** (NestJS 11) — regras de negócio, autenticação (JWT + refresh token rotation), envio de e-mails e acesso ao banco.
- **Database** (PostgreSQL 17) — usuários, canais, tokens e ciclo de vida dos vídeos.
- **Email Service** (Mailpit) — captura os e-mails transacionais (confirmação de conta e recuperação de senha) em uma UI local.
- **Video Worker** (NestJS + FFmpeg/ffprobe) — extrai metadados e gera thumbnails fora da API.
- **Object Storage** (MinIO local, compatível com S3) — dois buckets privados para fontes e thumbnails.
- **Message Queue** (Redis + BullMQ) — entrega persistente e retries dos jobs `video.process`.

O diagrama de arquitetura completo (C4) está em `docs/diagrams/software-arch.mermaid`.

## 🚀 Como rodar

Os dois subprojetos têm stacks Docker **separadas**. Suba primeiro o backend, rode as migrations e depois o frontend.

### 1. Backend (NestJS + PostgreSQL + Redis + MinIO + FFmpeg + Mailpit)

```bash
cd nestjs-project

# Sobe API, worker, banco, fila, storage e Mailpit
docker compose up -d

# Instala dependências (apenas na primeira vez)
docker compose exec nestjs-api npm install

# Cria o schema do banco (obrigatório — synchronize está desabilitado)
docker compose exec nestjs-api npm run migration:run

# Confirma API e worker ativos
docker compose ps
```

Serviços disponíveis:

| Serviço | URL / Porta |
|---------|-------------|
| API NestJS | http://localhost:3000 |
| PostgreSQL | `localhost:5432` (db/user/senha: `streamtube`) |
| Redis | `localhost:6379` |
| MinIO S3 API | http://localhost:9000 |
| MinIO Console | http://localhost:9001 |
| Mailpit (UI de e-mails) | http://localhost:8025 |
| Swagger (opcional) | http://localhost:3000/api/docs — habilite com `SWAGGER_ENABLED=true` |

### 2. Frontend (Next.js)

```bash
cd next-frontend

# Garanta que o .env.local existe (veja .env.example)
# API_URL aponta para o backend; SESSION_PASSWORD protege a sessão (iron-session)

docker compose up -d
docker compose exec next-frontend npm install        # apenas na primeira vez
docker compose exec -d next-frontend npm run dev
```

A aplicação ficará disponível em **http://localhost:3001**.

> As stacks são separadas, então o frontend acessa o backend via `host.docker.internal:3000` (configurado em `next-frontend/.env.local` e no `extra_hosts` do compose).

## 🧪 Testes

### Backend (Jest)

```bash
cd nestjs-project
docker compose exec nestjs-api npm test               # unitários + integração
docker compose exec nestjs-api npm run test:e2e       # end-to-end (HTTP via supertest)
docker compose exec nestjs-api npm run test:cov       # cobertura
docker compose exec nestjs-worker ffmpeg -version      # binário do worker
docker compose exec nestjs-worker ffprobe -version
```

Sufixos: `*.spec.ts` (unitário), `*.integration-spec.ts` (integração com banco real), `*.e2e-spec.ts` (end-to-end). Testes de integração/e2e rodam com `--runInBand`.

### Frontend (Vitest + Playwright)

```bash
cd next-frontend
docker compose exec next-frontend npm test            # unitários + integração (Vitest + MSW)
npx playwright test                                   # end-to-end (no host, com dev server em MSW_ENABLED=true)
```

Sufixos: `*.test.ts(x)` (unitário), `*.integration.test.ts(x)` (Route Handlers com MSW), `*.e2e-spec.ts` (Playwright). MSW intercepta as chamadas à API NestJS — os testes nunca batem no backend real.

## ✅ Funcionalidades implementadas

**Fases 01–03** estão concluídas: configuração base, autenticação e backend de upload/processamento de vídeos. A interface de upload/player permanece nas fases seguintes.

### Autenticação (Fase 02)

Fluxo completo de **cadastro → confirmação por e-mail → login → recuperação de senha**, com canal criado automaticamente para cada usuário (a partir do prefixo do e-mail).

Endpoints da API (`nestjs-project`):

| Método & Rota | Descrição |
|---------------|-----------|
| `POST /auth/register` | Cadastro de usuário (cria usuário + canal) |
| `GET /auth/confirm-email?token=` | Confirmação de conta via link do e-mail |
| `POST /auth/resend-confirmation` | Reenvio do e-mail de confirmação |
| `POST /auth/login` | Login (retorna access + refresh token) |
| `POST /auth/refresh` | Rotação de refresh token (com family + grace period) |
| `POST /auth/logout` | Revoga os refresh tokens da sessão |
| `POST /auth/forgot-password` | Solicita e-mail de recuperação de senha |
| `POST /auth/reset-password` | Redefine a senha via token |
| `GET /auth/me` | Dados do usuário autenticado (protegido por JWT) |

Telas e Route Handlers BFF (`next-frontend`):

- `/(auth)/signup`, `/(auth)/login`, `/(auth)/forgot-password` — formulários com React Hook Form + Zod e validação inline.
- `app/api/auth/{signup,login,logout,forgot-password}` — proxy same-origin para a API.

Segurança: senhas com **Argon2**, **JWT** com `JwtAuthGuard` global (opt-out via `@Public()`), **rotação de refresh token** com detecção de reuso, **rate limiting** (`ThrottlerGuard`) nos endpoints de auth, e sessão no navegador via **iron-session** (cookies HTTP-only).

### Vídeos (Fase 03)

O navegador envia partes diretamente ao MinIO/S3 por URLs assinadas; a API não transporta os bytes. Após a conclusão, a API publica `video.process`, o `nestjs-worker` executa FFmpeg/ffprobe e o vídeo muda de `PROCESSING` para `READY` ou `ERROR`. Streaming, thumbnail e download são privados e retornam `307` para URLs válidas por 15 minutos.

| Método & Rota | Descrição |
|---------------|-----------|
| `POST /videos/uploads` | Cria o rascunho e o multipart upload |
| `POST /videos/{id}/uploads/parts` | Assina lotes de até 20 partes |
| `POST /videos/{id}/uploads/complete` | Valida o objeto e publica o processamento |
| `DELETE /videos/{id}/uploads` | Aborta e limpa um rascunho |
| `GET /videos/{id}` | Retorna metadata owner-scoped |
| `GET /videos/{id}/thumbnail` | Redireciona para o JPEG privado |
| `GET /videos/{id}/stream` | Redireciona para a fonte com suporte a `Range` |
| `GET /videos/{id}/download` | Redireciona para download como attachment |

#### Roteiro manual autenticado

Use um JWT obtido em `POST /auth/login`, um arquivo MP4 e `jq`. Para arquivos acima de 64 MiB, repita a assinatura/envio para todas as partes e conclua com a lista ordenada completa.

```bash
API_URL=http://localhost:3000
VIDEO_FILE=/caminho/video.mp4
ACCESS_TOKEN='<access_token>'
SIZE_BYTES=$(wc -c < "$VIDEO_FILE" | tr -d ' ')

INIT=$(curl -sS -X POST "$API_URL/videos/uploads" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Vídeo de teste\",\"original_filename\":\"video.mp4\",\"content_type\":\"video/mp4\",\"size_bytes\":$SIZE_BYTES}")
VIDEO_ID=$(jq -r '.id' <<<"$INIT")

PART=$(curl -sS -X POST "$API_URL/videos/$VIDEO_ID/uploads/parts" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"part_numbers":[1]}')
PART_URL=$(jq -r '.parts[0].url' <<<"$PART")
curl -sS -D /tmp/streamtube-part.headers -o /dev/null -X PUT --upload-file "$VIDEO_FILE" "$PART_URL"
ETAG=$(awk 'tolower($1)=="etag:" {gsub(/\r/,"",$2); print $2}' /tmp/streamtube-part.headers)

curl -sS -X POST "$API_URL/videos/$VIDEO_ID/uploads/complete" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"parts\":[{\"part_number\":1,\"etag\":$ETAG}]}"

# Repita até status READY.
curl -sS "$API_URL/videos/$VIDEO_ID" -H "Authorization: Bearer $ACCESS_TOKEN" | jq

STREAM_LOCATION=$(curl -sSI "$API_URL/videos/$VIDEO_ID/stream" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | awk 'tolower($1)=="location:" {sub(/\r$/, "", $2); print $2}')
curl -i -H 'Range: bytes=0-1023' "$STREAM_LOCATION"

DOWNLOAD_LOCATION=$(curl -sSI "$API_URL/videos/$VIDEO_ID/download" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | awk 'tolower($1)=="location:" {sub(/\r$/, "", $2); print $2}')
curl -OJ "$DOWNLOAD_LOCATION"
```

Dentro do Compose, API e worker usam exclusivamente os hosts `db`, `redis` e `minio`; `localhost` aparece acima somente porque os comandos são executados no host.

## 🛠️ Estrutura do Projeto

```
green-field-ia-project/
├── docs/
│   ├── project-plan.md                  # Planejamento geral do projeto
│   ├── phases/                          # Planos e implementação por fase
│   │   ├── phase-01-configuracao-base/
│   │   ├── phase-02-auth/               # Auth (backend)
│   │   └── phase-02-auth-frontend/      # Auth (frontend)
│   └── diagrams/
│       └── software-arch.mermaid        # Diagrama de arquitetura (C4)
├── nestjs-project/                      # Backend API (NestJS 11)
│   ├── src/
│   │   ├── auth/                        # Cadastro, login, JWT, refresh, reset de senha
│   │   ├── users/                       # Entidade e serviço de usuários
│   │   ├── channels/                    # Canal 1:1 por usuário (nickname do e-mail)
│   │   ├── mail/                        # Envio de e-mails (templates Handlebars)
│   │   ├── common/                      # Filtros, pipes e exceptions de domínio
│   │   ├── config/                      # Configs namespaced (Joi)
│   │   ├── database/                    # data-source, migrations e seeds
│   │   ├── videos/                      # upload, storage, fila e processamento
│   │   ├── worker.module.ts             # aplicação Nest dedicada ao consumidor
│   │   └── worker.ts                    # entrypoint sem servidor HTTP
│   ├── test/                            # Testes e2e
│   ├── compose.yaml                     # API + worker + PostgreSQL + Redis + MinIO + Mailpit
│   └── Dockerfile.dev
├── next-frontend/                       # Frontend (Next.js 16, App Router)
│   ├── app/                             # Rotas, layouts, páginas e Route Handlers BFF
│   ├── components/                      # Componentes de auth, UI (shadcn) e ícones
│   ├── lib/                             # env, api (openapi-fetch), auth/session
│   ├── mocks/                           # MSW (handlers + server)
│   ├── tests/                           # E2E (Playwright)
│   ├── compose.yaml                     # Docker Compose (dev server)
│   └── Dockerfile.dev
├── CLAUDE.md                            # Instruções para IA
├── FC Tube.fig                          # Design system do projeto (Figma)
├── whiteboard.png                       # Quadro branco do projeto
└── README.md
```

## 📚 Fases do Projeto

| Fase | Descrição | Status |
|------|-----------|--------|
| **01** | Configuração Base do Projeto | ✅ Concluída |
| **02** | Cadastro, Login e Gerenciamento de Conta | ✅ Concluída |
| **03** | Upload e Processamento de Vídeos | ✅ Concluída |
| **04** | Gerenciamento de Vídeos e Canal | ⏳ Planejada |
| **05** | Página de Visualização do Vídeo | ⏳ Planejada |
| **06** | Interações Sociais (Likes, Comentários, Inscrições) | ⏳ Planejada |
| **07** | Página Inicial, Busca e Finalização | ⏳ Planejada |

Detalhes completos em `docs/project-plan.md`.

## 📖 Stack Tecnológica

| Camada | Tecnologia |
|--------|------------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, React Hook Form + Zod, iron-session, openapi-fetch |
| Backend | NestJS 11, TypeScript, TypeORM, JWT, Argon2, BullMQ, AWS SDK S3, Mailer |
| Banco de Dados | PostgreSQL 17 |
| Fila | Redis 7.4 + BullMQ |
| Mídia e storage | FFmpeg/ffprobe + MinIO/S3 privado |
| E-mail (dev) | Mailpit |
| Containerização | Docker, Docker Compose |
| Testes | Jest, Supertest (backend); Vitest, MSW, Playwright (frontend) |
| Qualidade | ESLint, Prettier |
</content>
