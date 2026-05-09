import * as sql from 'mssql';
import { ConfigService } from '@nestjs/config';

export const getDbConfig = (
    configService: ConfigService,
): sql.config => ({
    user:
        configService.get<string>('DB_USER') || 'azure-sa',

    password:
        configService.get<string>('DB_PASS') ||
        'ugsf127ghFHSD86dfsDS',

    database:
        configService.get<string>('DB_NAME') ||
        'IAPL',

    server:
        configService.get<string>('DB_HOST') ||
        '192.168.1.13',

    options: {
        encrypt: false,
        trustServerCertificate: true,
    },

    port: Number(
        configService.get<number>('DB_PORT') || 1433,
    ),

    requestTimeout: 600000,
});