import { DataSource, DataSourceOptions, MigrationInterface } from 'typeorm';

interface TestDataSourceOptions {
  synchronize?: boolean;
  migrations?: (new () => MigrationInterface)[];
}

export function createTestDataSource(
  entities: NonNullable<DataSourceOptions['entities']>,
  options: TestDataSourceOptions = {},
): DataSource {
  const { synchronize = true, migrations } = options;
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'db',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME ?? 'streamtube',
    password: process.env.DB_PASSWORD ?? 'streamtube',
    database: process.env.DB_DATABASE ?? 'streamtube',
    entities,
    synchronize,
    ...(migrations !== undefined && { migrations, migrationsRun: false }),
  });
}

export async function cleanAllTables(dataSource: DataSource): Promise<void> {
  const hasVideos = (await dataSource.query(
    `SELECT to_regclass('public.videos') AS table_name`,
  )) as unknown;
  if (
    Array.isArray(hasVideos) &&
    hasVideos.some(
      (row: unknown) =>
        typeof row === 'object' &&
        row !== null &&
        'table_name' in row &&
        row.table_name !== null,
    )
  ) {
    await dataSource.query('DELETE FROM "videos"');
  }
  await dataSource.query('DELETE FROM "refresh_tokens"');
  await dataSource.query('DELETE FROM "verification_tokens"');
  await dataSource.query('DELETE FROM "channels"');
  await dataSource.query('DELETE FROM "users"');
}
