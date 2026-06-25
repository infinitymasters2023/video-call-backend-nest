import FormData from 'form-data';
import fetch from 'node-fetch';

export class WhisperApiClient {
    constructor(private readonly baseUrl: string) { }

    async transcribe(
        buffer: Buffer,
        mimeType: string,
        filename: string,
        language = 'en',
    ): Promise<{ text: string; error?: string }> {
        try {
            const form = new FormData()
            form.append('audio', buffer, {
                filename,
                contentType: mimeType,
            })
            form.append('language', language)   // ← passed to Python

            const res = await fetch(`${this.baseUrl}/transcribe`, {
                method: 'POST',
                body: form,
                headers: form.getHeaders(),
                timeout: 30_000,               // 30s timeout for long audio
            } as any)

            if (!res.ok) {
                const msg = await res.text().catch(() => `HTTP ${res.status}`)
                return { text: '', error: `Whisper server: ${msg}` }
            }

            const data = await res.json() as { text?: string; error?: string }

            if (data.error) {
                return { text: '', error: data.error }
            }

            return { text: (data.text || '').trim() }

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Network error'
            return { text: '', error: msg }
        }
    }
}