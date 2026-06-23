import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhisperApiClient } from './whisper-api.client';

@Injectable()
export class LiveTranscribeService {
    private readonly whisperClient: WhisperApiClient;

    constructor(private readonly config: ConfigService) {
        const whisperUrl =
            this.config.get<string>('WHISPER_API_URL') || 'http://192.168.1.11:5084';
        this.whisperClient = new WhisperApiClient(whisperUrl);
    }

    async transcribe(file: Express.Multer.File | undefined, language = 'en') {
        if (!file?.buffer || file.size < 800) {
            return { text: '' };
        }

        // Frontend always sends WAV now — force correct mime if browser set it wrong
        const mimeType = this.normaliseMime(file.mimetype, file.originalname)
        const ext = this.extensionForMime(mimeType)

        const result = await this.whisperClient.transcribe(
            file.buffer,
            mimeType,
            `audio.${ext}`,
            language,
        );

        if (result.error) {
            return { text: '', error: result.error };
        }

        return { text: result.text };
    }

    // If browser sends wrong mime but filename says .wav, trust the filename
    private normaliseMime(mime: string | undefined, filename: string | undefined): string {
        if (filename?.endsWith('.wav')) return 'audio/wav';
        if (filename?.endsWith('.ogg')) return 'audio/ogg';
        if (filename?.endsWith('.mp3')) return 'audio/mpeg';
        return mime || 'audio/wav';
    }

    private extensionForMime(mimeType: string): string {
        if (mimeType.includes('wav')) return 'wav';
        if (mimeType.includes('ogg')) return 'ogg';
        if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
        if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
        return 'wav'; // default to wav since frontend converts
    }
}