---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-07-20
scope_description: "Upload direto de vídeos grandes, armazenamento S3, processamento assíncrono, URL única e entrega de mídia da Fase 03"
---

# Technical Decisions — Fase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — API, persistência, object storage, fila, worker de processamento e infraestrutura Docker da fase.
- `next-frontend/` — explicitamente fora do escopo da Fase 03; somente o contrato HTTP consumível por clientes é definido aqui.

---

## TD-01: Tecnologia da fila de processamento

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O processamento de metadados e thumbnail não pode disputar o event loop nem o ciclo de vida da API. A fila deve persistir jobs, permitir retries, deduplicação e consumo por um worker em container separado, sem transformar a fase em uma plataforma de mensageria maior que o necessário.

**Options:**

### Option A: BullMQ com Redis
- A API publica jobs serializáveis em uma fila BullMQ persistida no Redis; um processo NestJS separado consome a mesma fila. BullMQ oferece retries, backoff, concorrência, IDs customizados e deduplicação, com integração oficial do NestJS por `@nestjs/bullmq`.
- **Pros:** Integração direta com NestJS e TypeScript; pouca infraestrutura; retries e deduplicação nativos; encaixa naturalmente em um único tipo de job de processamento.
- **Cons:** Introduz Redis; a entrega continua sendo pelo menos uma vez, portanto o worker precisa ser idempotente; Redis e retenção dos jobs exigem configuração explícita.

### Option B: RabbitMQ
- A API publica mensagens persistentes em uma fila AMQP e o worker usa acknowledgements manuais; publisher confirms protegem a publicação. A solução pode crescer para roteamento, exchanges e múltiplos consumidores.
- **Pros:** Broker de mensagens maduro; acknowledgements e publisher confirms explícitos; adequado a topologias complexas e múltiplas linguagens.
- **Cons:** Mais configuração e conceitos operacionais; retries, dead-lettering e idempotência exigem desenho adicional; complexidade desproporcional a uma fila de processamento.

### Option C: pg-boss sobre PostgreSQL
- Os jobs são persistidos no PostgreSQL existente e consumidos com locking baseado em `SKIP LOCKED`. Evita adicionar um datastore exclusivo para a fila.
- **Pros:** Menos um serviço de dados; possibilidade de publicar job na mesma transação do vídeo; retries e políticas de fila incorporados.
- **Cons:** Processamento de mídia compete com a carga transacional principal; adiciona tabelas e ciclo de migrations próprios da biblioteca; integração NestJS menos direta que BullMQ.

**Recommendation:** **Option A (BullMQ com Redis)** — atende retries, deduplicação e worker distribuído com a menor complexidade para NestJS 11; RabbitMQ só se justificaria com roteamento/múltiplos domínios, e pg-boss acoplaria a fila de mídia ao banco principal.

**Decision:** A (BullMQ com Redis)

**Libraries:** `@nestjs/bullmq@^11.0.4`, `bullmq@^5.80.9`

---

## TD-02: Protocolo de upload de até 10 GB

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** Um objeto de 10 GB não pode atravessar, ser bufferizado ou permanecer preso ao processo HTTP da API. Além disso, uma operação S3 simples não cobre 10 GB: o contrato precisa iniciar um multipart upload, assinar cada parte e concluir ou abortar explicitamente.

**Options:**

### Option A: Multipart S3 direto com URLs pré-assinadas
- A API autentica o usuário, cria o rascunho e o multipart upload no storage, então assina operações `UploadPart`. O cliente envia as partes diretamente ao MinIO/S3 e devolve `partNumber` + `ETag` para a API concluir o upload.
- **Pros:** O arquivo não passa pela API; suporta retomada e paralelismo; usa o mesmo protocolo no MinIO local e no S3 de produção; respeita os limites S3 de 5 MiB a 5 GiB por parte e até 10.000 partes.
- **Cons:** Exige mais endpoints e estado de upload; o cliente precisa guardar ETags; CORS e endpoint público do storage precisam ser configurados corretamente.

### Option B: Streaming multipart através da API
- O cliente envia o arquivo à API, que encaminha o stream ao storage sem carregar tudo na memória. O processo evita buffering integral, mas permanece no caminho de todos os bytes.
- **Pros:** Contrato de cliente simples; autenticação e validação ficam centralizadas na API; storage não precisa ser exposto ao cliente.
- **Cons:** Consome banda, sockets e tempo da API durante todo o upload; reinícios quebram o fluxo; contraria o requisito de não impactar o sistema para 10 GB.

### Option C: Protocolo tus com servidor dedicado
- Um servidor tus gerencia upload retomável por offsets e encaminha o resultado ao storage. O cliente usa o protocolo tus em vez do ciclo multipart S3.
- **Pros:** Retomada padronizada e boa experiência em redes instáveis; protocolo próprio para uploads grandes.
- **Cons:** Adiciona servidor, cliente e tradução para S3; foge do contrato S3 já definido pelo projeto; aumenta a infraestrutura sem necessidade para a entrega backend.

**Recommendation:** **Option A (multipart S3 direto com URLs pré-assinadas)** — é a única alternativa que combina 10 GB, retomada por partes, compatibilidade MinIO/S3 e remoção total do tráfego pesado da API; partes de 64 MiB limitam um upload máximo a aproximadamente 160 partes.

**Decision:** A (multipart S3 direto com URLs pré-assinadas)

**Libraries:** `@aws-sdk/client-s3@^3.1090.0`, `@aws-sdk/s3-request-presigner@^3.1090.0`

---

## TD-03: Organização e acesso ao object storage

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** O projeto já fixa S3-compatible storage com MinIO local. Ainda é necessário definir isolamento, nomes de objetos, privacidade e cliente de acesso de forma portátil para S3 em produção.

**Options:**

### Option A: Dois buckets privados e AWS SDK v3
- Vídeos e thumbnails ficam em buckets privados separados, com chaves derivadas do UUID do vídeo, por exemplo `videos/{videoId}/source` e `thumbnails/{videoId}/default.jpg`. A aplicação usa `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner`, configurados com endpoint e path-style no MinIO.
- **Pros:** Mesmo SDK e contrato em MinIO/S3; políticas e lifecycle independentes; chaves não dependem de título nem nome original; nenhum objeto fica público por padrão.
- **Cons:** Dois buckets e políticas para inicializar/testar; requer configuração correta de endpoint externo para URLs assinadas no ambiente local.

### Option B: Um bucket privado com prefixos
- Todos os objetos ficam em um único bucket, separados por prefixos `videos/` e `thumbnails/`. A aplicação continua controlando todo acesso com URLs pré-assinadas.
- **Pros:** Bootstrap e configuração mais simples; menos variáveis de ambiente.
- **Cons:** Lifecycle, quotas e políticas de vídeos e thumbnails ficam acoplados; aumenta o risco de aplicar uma política ampla ao tipo de objeto errado.

### Option C: Buckets públicos para leitura
- Uploads permanecem autenticados, mas os objetos processados ficam publicamente acessíveis por URL estável do storage.
- **Pros:** Leitura e cache simples; nenhuma assinatura para streaming ou thumbnail.
- **Cons:** Anteciparia visibilidade pública antes da Fase 04; impediria autorização por dono; vazaria objetos por enumeração ou compartilhamento da URL.

**Recommendation:** **Option A (dois buckets privados e AWS SDK v3)** — preserva a portabilidade MinIO/S3, mantém a visibilidade da futura Fase 04 fora do storage e permite lifecycle independente sem criar um adapter específico do MinIO.

**Decision:** A (dois buckets privados e AWS SDK v3)

**Libraries:** `@aws-sdk/client-s3@^3.1090.0`, `@aws-sdk/s3-request-presigner@^3.1090.0`

---

## TD-04: Processo do worker e integração com FFmpeg

**Scope:** Backend

**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados), Geração automática de thumbnail a partir de um frame do vídeo

**Context:** FFmpeg e ffprobe são processos externos e potencialmente custosos. Eles precisam rodar fora da API, com acesso controlado ao objeto e sem depender de uma biblioteca Node abandonada ou de arquivos permanentes no filesystem do container.

**Options:**

### Option A: Aplicação NestJS worker separada, binaries do sistema e diretório temporário
- Um entrypoint NestJS sem servidor HTTP consome BullMQ, baixa o objeto para um diretório temporário por job, chama `ffprobe` e `ffmpeg` com `node:child_process.spawn`, envia a thumbnail ao storage e remove os temporários. O container do worker instala versões fixadas dos binaries.
- **Pros:** DI e configurações compartilhadas com a API; isolamento de CPU/memória; sem wrapper Node adicional; processo e filesystem temporário são facilmente testáveis.
- **Cons:** Exige um segundo entrypoint/build e limpeza defensiva; o vídeo é transferido do storage para o worker; limites de concorrência precisam ser conservadores.

### Option B: Processador forkado pelo processo da API
- A integração BullMQ cria processos filhos para o processamento, mantendo o produtor e o consumidor sob o mesmo serviço/container da API.
- **Pros:** Menos serviço no Compose; algum isolamento do event loop.
- **Cons:** Escala e reinicia junto com a API; mistura dependências FFmpeg na imagem da API; falhas e pressão de recursos ainda atingem o container público.

### Option C: Serviço gerenciado de transcodificação
- A API envia o objeto para um serviço cloud especializado e recebe callback/evento com metadados e derivados.
- **Pros:** Escala e codecs administrados; remove FFmpeg e CPU da aplicação.
- **Cons:** Não funciona como infraestrutura local autocontida exigida; adiciona custo e vendor lock-in; excede o escopo de thumbnail e metadados.

**Recommendation:** **Option A (worker NestJS separado + binaries do sistema)** — satisfaz o container dedicado previsto na arquitetura, mantém a API responsiva e evita depender de wrappers FFmpeg não necessários; `ffprobe` produz JSON e `ffmpeg` seleciona um frame para JPEG.

**Decision:** A (worker NestJS separado, binaries do sistema e diretório temporário)

**Libraries:** FFmpeg/ffprobe system packages (version pinned by worker image)

---

## TD-05: Garantia de processamento, retries e ciclo de status

**Scope:** Backend

**Capability:** Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload, Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** A conclusão do multipart upload e a publicação do job não formam uma transação distribuída. Além disso, BullMQ pode entregar um job novamente após falha. O estado persistido precisa tornar repetição, retry e falha terminal observáveis e seguros.

**Options:**

### Option A: Entrega pelo menos uma vez com worker idempotente
- O vídeo nasce `DRAFT`; somente uma conclusão de upload válida muda para `PROCESSING` e publica `video.process` com `videoId` como ID/deduplication key. O worker revalida o estado e a existência do objeto, sobrescreve deterministicamente a thumbnail e finaliza em `READY`; após retries exponenciais esgotados, registra `ERROR` e uma mensagem sanitizada.
- **Pros:** Alinha-se às garantias reais da fila; retries são seguros; estado do banco é auditável; chamadas repetidas de conclusão não duplicam processamento ativo.
- **Cons:** Publicar banco + fila ainda exige reconciliação quando Redis falha após o upload; transições condicionais e testes de concorrência são obrigatórios.

### Option B: Job único sem retry automático
- Cada upload publica uma vez; qualquer erro leva imediatamente a `ERROR` e exige um futuro endpoint ou intervenção manual para reprocessar.
- **Pros:** Fluxo simples e previsível; não repete efeitos externos.
- **Cons:** Falhas transitórias de storage ou processo tornam o vídeo inutilizável; não aproveita a principal capacidade da fila.

### Option C: Outbox transacional completo
- A conclusão grava uma mensagem de outbox na mesma transação do vídeo; um relay publica na fila e marca o evento como enviado. O worker continua idempotente.
- **Pros:** Elimina a janela banco-atualizado/fila-não-publicada; histórico explícito e recuperação determinística.
- **Cons:** Introduz tabela, relay e mais um ciclo assíncrono para uma única mensagem; amplia significativamente a fase.

**Recommendation:** **Option A (pelo menos uma vez + idempotência)** — combina retries e simplicidade adequada à fase; a API só confirma `PROCESSING` quando a publicação for aceita e, se a publicação falhar, mantém/retorna o vídeo a um estado recuperável sem afirmar que o processamento começou.

**Decision:** A (entrega pelo menos uma vez com worker idempotente)

**Libraries:** `bullmq@^5.80.9`

---

## TD-06: Identificador da URL única do vídeo

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** O endereço do vídeo precisa ser único e estável antes de a Fase 04 permitir editar título e publicação. Ele não pode depender de normalização textual nem expor sequências enumeráveis.

**Options:**

### Option A: UUID do próprio vídeo como identificador público
- A chave primária UUID gerada no pré-cadastro também compõe `/videos/{id}` e os endpoints de mídia. Não existe um segundo identificador para sincronizar.
- **Pros:** Unicidade forte sem biblioteca nova; estável; criado antes do upload; não muda com o título.
- **Cons:** URL longa e não semântica; o mesmo identificador aparece em banco, API e storage keys.

### Option B: Slug de título com sufixo aleatório
- A URL combina título normalizado e um sufixo para evitar colisões, preservando alguma legibilidade.
- **Pros:** URL amigável; permite reconhecer o título visualmente.
- **Cons:** O título ainda pode mudar na Fase 04; precisa definir redirecionamentos ou imutabilidade; maior superfície de validação e colisão.

### Option C: Public ID separado e curto
- A entidade mantém UUID interno e um identificador aleatório curto, como Nano ID, exclusivo para URLs.
- **Pros:** URL menor e não enumerável; desacopla identidade interna da pública.
- **Cons:** Nova biblioteca/algoritmo, índice unique e tratamento de colisão; dois identificadores sem benefício funcional exigido nesta fase.

**Recommendation:** **Option A (UUID do vídeo)** — entrega uma URL única, estável e não sequencial desde o rascunho, sem criar outro campo ou dependência; um slug amigável pode ser introduzido depois sem quebrar o ID canônico.

**Decision:** A (UUID do próprio vídeo como identificador público)

**Libraries:** —

---

## TD-07: Estratégia de streaming e download

**Scope:** Backend

**Capability:** Transversal — covers: Reprodução via streaming (sem necessidade de download completo), Download do vídeo pelo usuário

**Context:** O acesso deve respeitar autenticação/autorização sem transformar a API em proxy permanente de arquivos grandes. O mecanismo precisa permitir `Range` para reprodução e `Content-Disposition: attachment` para download, mantendo os buckets privados.

**Options:**

### Option A: Endpoints autorizados que redirecionam para GET pré-assinado
- `/videos/{id}/stream` e `/videos/{id}/download` validam dono e status `READY`, geram uma URL GET curta e respondem com redirecionamento temporário. O storage atende `Range`/`206`; para download, a assinatura inclui `response-content-disposition=attachment`.
- **Pros:** A API não transporta bytes; MinIO/S3 implementa ranges; buckets continuam privados; escala para CDN/S3 sem mudar o contrato público.
- **Cons:** Testes E2E precisam seguir o redirecionamento contra storage real; endpoint externo e CORS devem estar corretos; a URL assinada pode ser reutilizada até expirar.

### Option B: API como proxy de stream com `GetObject Range`
- A API recebe o header `Range`, chama `GetObject` com o mesmo intervalo e encaminha o stream e cabeçalhos como `206`; download usa o stream completo com `Content-Disposition`.
- **Pros:** Autorização é verificada em cada range; cliente conhece apenas a API; contrato HTTP pode ser testado em um único host.
- **Cons:** Todo tráfego de reprodução e download atravessa a API; consome conexões e banda; aproxima a fase do mesmo gargalo evitado no upload.

### Option C: Objetos publicamente acessíveis
- A URL única aponta diretamente para o objeto público; browser e clientes usam `Range` nativo.
- **Pros:** Caminho de dados mínimo; cache simples; nenhuma URL expira.
- **Cons:** Viola o storage privado e antecipa visibilidade antes da Fase 04; não permite autorização de dono nesta fase; revogação é difícil.

**Recommendation:** **Option A (redirecionamento para GET pré-assinado)** — mantém autorização no domínio e bytes fora da API; nesta fase, antes de existir visibilidade pública/unlisted, streaming e download permanecem restritos ao dono autenticado.

**Decision:** A (endpoints autorizados que redirecionam para GET pré-assinado)

**Libraries:** `@aws-sdk/client-s3@^3.1090.0`, `@aws-sdk/s3-request-presigner@^3.1090.0`

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Tecnologia da fila | BullMQ com Redis | A |
| TD-02 | Backend | Protocolo de upload | Multipart S3 direto com URLs pré-assinadas | A |
| TD-03 | Backend | Organização do storage | Dois buckets privados com AWS SDK v3 | A |
| TD-04 | Backend | Processo do worker | Worker NestJS separado + FFmpeg/ffprobe do sistema | A |
| TD-05 | Backend | Retries e ciclo de status | Pelo menos uma vez + worker idempotente | A |
| TD-06 | Backend | URL única | UUID do vídeo | A |
| TD-07 | Backend | Streaming e download | Redirecionamento para GET pré-assinado | A |

## Sources

- [NestJS — Queues](https://docs.nestjs.com/techniques/queues) — integração BullMQ, produtores, consumidores e persistência no Redis.
- [BullMQ — Deduplication](https://docs.bullmq.io/guide/jobs/deduplication), [Job IDs](https://docs.bullmq.io/guide/jobs/job-ids), [Idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs) e [Retrying failing jobs](https://docs.bullmq.io/guide/retrying-failing-jobs) — garantias e políticas do worker.
- [RabbitMQ — Consumer acknowledgements and publisher confirms](https://www.rabbitmq.com/docs/confirms) — alternativa de broker e requisitos de entrega confiável.
- [pg-boss — repository and documentation](https://github.com/timgit/pg-boss) — alternativa baseada em PostgreSQL.
- [Amazon S3 — Multipart upload limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html) e [multipart upload overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html) — limites de tamanho, partes, ETags e conclusão.
- [Amazon S3 — Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) — acesso temporário de upload e download sem credenciais do cliente.
- [AWS SDK for JavaScript v3 — S3 client](https://github.com/aws/aws-sdk-js-v3/tree/main/clients/client-s3) e [S3 request presigner](https://github.com/aws/aws-sdk-js-v3/tree/main/packages/s3-request-presigner) — comandos multipart, ranges e assinatura.
- [FFmpeg documentation](https://ffmpeg.org/ffmpeg-all.html) e [ffprobe documentation](https://ffmpeg.org/ffprobe.html) — extração JSON de streams/formato e geração de thumbnail.
