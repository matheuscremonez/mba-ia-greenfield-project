---
libs:
  "@nestjs/bullmq":
    version: "^11.0.4"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-07-20T11:57:36-03:00"
  bullmq:
    version: "^5.80.9"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-07-20T11:57:36-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1090.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-07-20T11:57:36-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1090.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-07-20T11:57:36-03:00"
  ffmpeg:
    version: "system package pinned by worker image"
    context7_id: "/websites/ffmpeg_documentation"
    fetched_at: "2026-07-20T11:57:36-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-20T11:55:35-03:00"
---

# phase-03-videos — Library References

Distilled version-specific documentation for the libraries and binaries fixed by the Phase 03 decisions. Re-fetch through Context7 if the corresponding decision or version changes.

### @nestjs/bullmq

**Source:** `/nestjs/bull` (Context7). Applies to `phase-03-videos/TD-01`.

- Configure the Redis connection with `BullModule.forRootAsync()` so it consumes the existing namespaced config pattern.
- Register the `video-processing` queue with `BullModule.registerQueue()`/`registerQueueAsync()` and inject the producer with `@InjectQueue()`.
- A consumer uses `@Processor(queueName)` and extends `WorkerHost`; its `process(job)` method owns dispatch by job name.
- Queue/worker shutdown must close active workers and Redis connections through Nest lifecycle hooks.
- The API module registers only the producer. The separate worker entrypoint registers the processor, preventing FFmpeg work from running in the API container.

### bullmq

**Source:** `/taskforcesh/bullmq` (Context7). Applies to `phase-03-videos/TD-01` and `TD-05`.

- Add `video.process` with serializable data `{ videoId }`; never place file bytes or credentials in job data.
- Use the video UUID as custom `jobId` or simple deduplication ID while the job is unfinished. Removed jobs no longer participate in ID-based deduplication, so database state remains the final idempotency guard.
- Configure `attempts: 3` with exponential backoff and retain a bounded number of failed jobs for diagnosis.
- CPU-heavy FFmpeg work uses conservative worker concurrency (`1` per worker container initially); scale horizontally after measuring CPU/memory.
- Producer connections serving HTTP must fail promptly when Redis is unavailable; worker connections may retry indefinitely. Do not let an HTTP request wait forever for Redis reconnection.
- Close workers gracefully so active processing either completes or becomes retryable after lock expiry.

### @aws-sdk/client-s3

**Source:** `/aws/aws-sdk-js-v3` (Context7). Applies to `phase-03-videos/TD-02`, `TD-03` and `TD-07`.

- Instantiate `S3Client` from environment-backed endpoint, region and credentials. MinIO local requires the S3-compatible endpoint and `forcePathStyle: true`; AWS production does not.
- Multipart lifecycle: `CreateMultipartUploadCommand` → presigned `UploadPartCommand` requests → `CompleteMultipartUploadCommand`; support `AbortMultipartUploadCommand` for cancellation/cleanup.
- Completion receives the exact `{ PartNumber, ETag }` pairs collected by the client. Verify the resulting object using `HeadObjectCommand` before enqueueing processing.
- S3 permits 1–10,000 part numbers; every non-final part is at least 5 MiB. The phase standard is 64 MiB, producing about 160 parts at 10 GB.
- The worker downloads the private source object as a Node stream to a per-job temporary file and uploads the generated JPEG thumbnail with deterministic keys.

### @aws-sdk/s3-request-presigner

**Source:** `/aws/aws-sdk-js-v3` (Context7). Applies to `phase-03-videos/TD-02` and `TD-07`.

- `getSignedUrl(client, command, { expiresIn })` signs `UploadPartCommand` and `GetObjectCommand` without exposing storage credentials.
- Use short expirations and regenerate on demand. The SDK default is 900 seconds; the plan fixes 15 minutes unless implementation testing demonstrates a multipart UX problem.
- The public endpoint used inside a generated URL must be browser/client reachable; it is distinct from the Compose-internal hostname used by API and worker connections.
- Streaming redirects sign `GetObjectCommand`; the object storage honors client `Range` requests. Download redirects additionally set response content disposition to `attachment` with a sanitized filename.

### FFmpeg and ffprobe

**Source:** `/websites/ffmpeg_documentation` (Context7). Applies to `phase-03-videos/TD-04`.

- Invoke binaries with `node:child_process.spawn` argument arrays, never shell-concatenated user input.
- Extract structured metadata with `ffprobe -v error -print_format json -show_format -show_streams <input>` and parse stdout only after exit code `0`.
- Generate a single JPEG with a representative-frame filter, for example `ffmpeg -v error -i <input> -vf thumbnail=50,scale=640:-2 -frames:v 1 <output.jpg>`.
- Treat non-zero exit, malformed JSON, missing video stream or missing thumbnail output as processing failure eligible for queue retry.
- Each job owns an isolated temporary directory; cleanup runs in `finally` on success, retryable failure and shutdown.
- The Dockerfile pins the worker base/image and verifies both `ffmpeg -version` and `ffprobe -version`; the application does not add a deprecated Node wrapper.
