# Backend-specific guidance

- Keep controllers thin: validate/transform input and delegate business logic to services.
- Use DTO validation, domain exceptions and the existing exception filters; preserve the API error envelope.
- Use TypeORM Data Mapper entities and explicit migrations. Do not enable `synchronize` or alter an applied migration.
- Authentication uses Argon2, JWT access tokens and refresh-token rotation. Preserve `@Public()` opt-out and the global auth guard.
- Use real PostgreSQL only for integration/e2e tests; unit tests should isolate repositories and external services.
- Update Swagger/OpenAPI for public API changes and run `npm run openapi:export` when appropriate.
- Keep source videos and thumbnails private. Controllers return metadata or `307` redirects only; they never proxy media bytes or expose buckets/object keys.
- Multipart uploads use fixed 64 MiB parts, at most 20 signed parts per request and 15-minute signed URLs. Ownership is resolved through `videos.channel_id -> channels.user_id` and non-owner lookups return the same `VIDEO_NOT_FOUND` as absent UUIDs.
- The API registers only the BullMQ producer. `worker.ts`/`WorkerModule` own the consumer and FFmpeg execution; jobs contain `{ version, videoId }` only.
- Worker processing must remain idempotent: lock state transitions, use `thumbnails/{videoId}/default.jpg`, clean temporary directories in `finally`, and persist only sanitized bounded terminal diagnostics.
- Validate the video flow with PostgreSQL, Redis, MinIO and real FFmpeg media inside Docker; do not replace these integration boundaries with mocks.
