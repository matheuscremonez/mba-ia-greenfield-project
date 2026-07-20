import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CONFIRMATION_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  PASSWORD_RESET_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  MAIL_HOST: Joi.string().default('mailpit'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_FROM: Joi.string().default('"StreamTube" <noreply@streamtube.com>'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('false'),
  S3_INTERNAL_ENDPOINT: Joi.string().uri().required(),
  S3_PUBLIC_ENDPOINT: Joi.string().uri().required(),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: Joi.string().min(3).required(),
  S3_SECRET_ACCESS_KEY: Joi.string().min(8).required(),
  S3_SOURCE_BUCKET: Joi.string()
    .pattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
    .required(),
  S3_THUMBNAIL_BUCKET: Joi.string()
    .pattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
    .invalid(Joi.ref('S3_SOURCE_BUCKET'))
    .required(),
  S3_FORCE_PATH_STYLE: Joi.string().valid('true', 'false').default('true'),
  REDIS_HOST: Joi.string().hostname().required(),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().integer().min(0).default(0),
  REDIS_CONNECT_TIMEOUT_MS: Joi.number().integer().min(100).default(5000),
  VIDEO_WORKER_CONCURRENCY: Joi.number().integer().min(1).default(1),
});
