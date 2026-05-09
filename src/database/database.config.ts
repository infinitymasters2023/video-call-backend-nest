import * as sql from 'mssql';
import { ConfigService } from '@nestjs/config';

export const getDbConfig = (configService: ConfigService): sql.config => ({
    user: configService.get<string>('DB_USER'),
    password: configService.get<string>('DB_PASS'),
    database: configService.get<string>('DB_NAME'),
    server: configService.get<string>('DB_HOST'),
    options: {
        encrypt: false, // change to true if using Az
        trustServerCertificate: true, // needed for local dev
    },
    port: Number(configService.get<number>('DB_PORT', 1433)),
    requestTimeout: 600000,
});
