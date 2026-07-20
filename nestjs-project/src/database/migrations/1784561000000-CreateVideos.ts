import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1784561000000 implements MigrationInterface {
  name = 'CreateVideos1784561000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "video_status" AS ENUM ('DRAFT', 'PROCESSING', 'READY', 'ERROR')`,
    );
    await queryRunner.query(`
      CREATE TABLE "videos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "channel_id" uuid NOT NULL,
        "title" character varying(255) NOT NULL,
        "status" "video_status" NOT NULL DEFAULT 'DRAFT',
        "original_filename" character varying(255) NOT NULL,
        "content_type" character varying(127) NOT NULL,
        "size_bytes" bigint NOT NULL,
        "source_bucket" character varying(63) NOT NULL,
        "source_key" character varying(1024) NOT NULL,
        "thumbnail_bucket" character varying(63),
        "thumbnail_key" character varying(1024),
        "multipart_upload_id" character varying(512),
        "duration_seconds" numeric(12,3),
        "metadata" jsonb,
        "processing_error" character varying(500),
        "uploaded_at" TIMESTAMP WITH TIME ZONE,
        "processed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_VIDEOS" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_VIDEOS_TITLE" CHECK (char_length(btrim("title")) BETWEEN 1 AND 255),
        CONSTRAINT "CHK_VIDEOS_SIZE_BYTES" CHECK ("size_bytes" > 0 AND "size_bytes" <= 10737418240),
        CONSTRAINT "CHK_VIDEOS_CONTENT_TYPE" CHECK ("content_type" IN ('video/mp4', 'video/webm', 'video/quicktime')),
        CONSTRAINT "CHK_VIDEOS_DURATION_SECONDS" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0),
        CONSTRAINT "FK_VIDEOS_CHANNEL" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_VIDEOS_CHANNEL_ID" ON "videos" ("channel_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_VIDEOS_STATUS" ON "videos" ("status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_VIDEOS_SOURCE_KEY" ON "videos" ("source_key")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_VIDEOS_THUMBNAIL_KEY" ON "videos" ("thumbnail_key") WHERE "thumbnail_key" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "video_status"`);
  }
}
