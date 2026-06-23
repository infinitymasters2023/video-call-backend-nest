import { Logger } from '@nestjs/common';
import axios from 'axios';
import FormData from 'form-data';

export type WhisperTranscribeResult = {
    text: string;
    error?: string;
};

export class WhisperApiClient {
    private readonly logger = new Logger(WhisperApiClient.name);
    private readonly transcribeUrl: string;

    constructor(private readonly baseUrl: string) {
        this.transcribeUrl = `${baseUrl.replace(/\/$/, '')}/transcribe`;
        this.logger.log(`Whisper endpoint: ${this.transcribeUrl}`);
    }

    async transcribe(buffer: Buffer, mimeType: string, filename = 'audio.webm', language: string): Promise<WhisperTranscribeResult> {
        const form = new FormData();
        form.append('audio', buffer, {
            filename,
            contentType: mimeType || 'audio/webm',
        });

        try {
            const res = await axios.post(this.transcribeUrl, form, {
                headers: {
                    ...form.getHeaders(),
                    accept: 'application/json',
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 120_000,
                validateStatus: () => true,
            });

            const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);

            if (res.status < 200 || res.status >= 300) {
                this.logger.error(`Whisper API ${res.status}: ${raw}`);
                let detail = `Whisper API error (${res.status})`;
                try {
                    const parsed = typeof res.data === 'object' && res.data
                        ? res.data as Record<string, unknown>
                        : JSON.parse(raw) as Record<string, unknown>;
                    if (typeof parsed.detail === 'string') detail = parsed.detail;
                } catch { /* noop */ }
                return { text: '', error: detail };
            }

            const text = this.extractText(raw);
            return { text };
        } catch (err: unknown) {
            const message = this.formatError(err);
            this.logger.error(`Whisper request failed → ${this.transcribeUrl} :: ${message}`);
            return {
                text: '',
                error: `Cannot reach Whisper server at ${this.baseUrl}. Start Python with: uvicorn main:app --host 0.0.0.0 --port 5085`,
            };
        }
    }

    private formatError(err: unknown): string {
        if (axios.isAxiosError(err)) {
            const code = err.code || 'UNKNOWN';
            const cause = err.cause instanceof Error ? err.cause.message : '';
            return [code, err.message, cause].filter(Boolean).join(' | ');
        }
        if (err instanceof Error) return err.message;
        return 'Unknown error';
    }

    private extractText(raw: string): string {
        const trimmed = raw.trim();
        if (!trimmed) return '';

        try {
            const data = JSON.parse(trimmed) as Record<string, unknown>;
            const text =
                data.text ??
                data.transcript ??
                data.transcription ??
                data.result;

            if (typeof text === 'string') return text.trim();
            if (text && typeof text === 'object' && 'text' in (text as Record<string, unknown>)) {
                const nested = (text as Record<string, unknown>).text;
                if (typeof nested === 'string') return nested.trim();
            }
        } catch {
            return trimmed;
        }

        return '';
    }
}
