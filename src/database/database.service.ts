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

    /**
     * Run a parameterised SQL batch and return its last result set.
     *
     * Types are declared explicitly rather than left to mssql's inference,
     * because inference throws on a bare `null` — and optional columns like
     * Mobile or GoogleID are null far more often than not.
     */
    async query<T = any>(
        sqlText: string,
        params: Record<string, any> = {},
    ): Promise<T[]> {
        const pool = await this.getPool();
        const request = pool.request();

        Object.keys(params).forEach((key) => {
            const value = params[key];
            if (value === undefined || value === null) {
                request.input(key, sql.NVarChar(sql.MAX), null);
            } else if (typeof value === 'number') {
                request.input(
                    key,
                    Number.isInteger(value) ? sql.BigInt : sql.Float,
                    value,
                );
            } else if (typeof value === 'boolean') {
                request.input(key, sql.Bit, value);
            } else if (value instanceof Date) {
                request.input(key, sql.DateTime, value);
            } else {
                request.input(key, sql.NVarChar(sql.MAX), String(value));
            }
        });

        const result = await request.query(sqlText);
        const sets = (result.recordsets ?? []) as unknown as T[][];
        for (let i = sets.length - 1; i >= 0; i--) {
            if (sets[i]?.length) return sets[i];
        }
        return [];
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
