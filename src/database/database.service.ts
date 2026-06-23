import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as sql from 'mssql';
import { getDbConfig } from './database.config';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DatabaseService implements OnModuleDestroy {

    private pool: sql.ConnectionPool;
    private readonly logger = new Logger(DatabaseService.name);
    private dbConfig = sql.config;

    constructor(private readonly configService: ConfigService) {
        this.dbConfig = getDbConfig(this.configService);
    }

    private async connectWithRetry(retries = 5, delayMs = 2000): Promise<void> {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                this.pool = await new sql.ConnectionPool(this.dbConfig).connect();
                this.logger.log('✅ Connected to MSSQL database.');
                return;
            } catch (error) {
                this.logger.error(
                    `❌ MSSQL connection failed (Attempt ${attempt}/${retries}): `,
                );
                if (attempt < retries)
                    await new Promise((res) => setTimeout(res, delayMs));
            }
        }
        throw new Error('Failed to connect to MSSQL after multiple attempts');
    }

    async getPool(): Promise<sql.ConnectionPool> {
        if (!this.pool) await this.connectWithRetry();
        return this.pool!;
    }

    async runStoredProcedure(procName: string, params: Record<string, any> = {}) {
        const pool = await this.getPool();
        const request = pool.request();

        // Add all parameters
        Object.keys(params).forEach((key) => {
            request.input(key, params[key]);
        });

        const result = await request.execute(procName);
        return result;
    }

    async onModuleDestroy() {
        if (this.pool) {
            await this.pool.close();
            this.logger.log('🛑 MSSQL connection closed.');
        }
    }
}
