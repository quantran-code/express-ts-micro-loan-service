export interface ServiceConfig {
  port: number;
  env: string;
  serviceKey: string;
  catalogServiceUrl: string;
  memberServiceUrl: string;
}

export const config: ServiceConfig = {
  port: Number(process.env.PORT) || 3004,
  env: process.env.NODE_ENV || 'development',
  serviceKey: process.env.SERVICE_KEY || 'dev-service-key',
  catalogServiceUrl: process.env.CATALOG_SERVICE_URL || 'http://localhost:3002',
  memberServiceUrl: process.env.MEMBER_SERVICE_URL || 'http://localhost:3003',
};
