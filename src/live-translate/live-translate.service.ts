import { Injectable } from '@nestjs/common';

type FixedLang = 'en' | 'ta' | 'te' | 'kn' | 'ml';

// MyMemory language code map
const LANG_MAP: Record<FixedLang, string> = {
    en: 'en',
    ta: 'ta',
    te: 'te',
    kn: 'kn',
    ml: 'ml',
};

// Simple heuristic to detect language from common scripts
function detectLang(text: string): FixedLang {
    if (/[\u0B80-\u0BFF]/.test(text)) return 'ta'; // Tamil
    if (/[\u0C00-\u0C7F]/.test(text)) return 'te'; // Telugu
    if (/[\u0C80-\u0CFF]/.test(text)) return 'kn'; // Kannada
    if (/[\u0D00-\u0D7F]/.test(text)) return 'ml'; // Malayalam
    return 'en'; // Default to English
}

@Injectable()
export class LiveTranslateService {
    async translate(body: {
        text: string;
        sourceLang: string;
        targetLangs: string[];
        speakerName: string;
    }) {
        const { text, sourceLang, targetLangs, speakerName } = body;
        const startedAt = Date.now();

        // Detect source language
        const detectedSourceLang: FixedLang =
            sourceLang === 'auto' ? detectLang(text) : (sourceLang as FixedLang);

        // Always ensure English is in targets (required by your frontend)
        const targets = Array.from(new Set([...targetLangs, 'en'])) as FixedLang[];

        // Translate to all target languages in parallel using MyMemory free API
        const translationResults = await Promise.allSettled(
            targets.map(async (targetLang) => {
                // Skip translating if source and target are the same
                if (targetLang === detectedSourceLang) {
                    return { lang: targetLang, text };
                }

                const fromCode = LANG_MAP[detectedSourceLang] || 'en';
                const toCode = LANG_MAP[targetLang] || 'en';

                const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromCode}|${toCode}`;

                const res = await fetch(url);
                const data = await res.json();

                const translated =
                    data?.responseData?.translatedText || text;

                return { lang: targetLang, text: translated };
            }),
        );

        // Build translatedByLanguage map
        const translatedByLanguage: Partial<Record<FixedLang, string>> = {};
        let confidence = 0.9;

        for (const result of translationResults) {
            if (result.status === 'fulfilled') {
                translatedByLanguage[result.value.lang] = result.value.text;
            }
        }

        // If English translation failed or missing, fallback to original
        if (!translatedByLanguage['en']) {
            translatedByLanguage['en'] = text;
        }

        return {
            originalText: text,
            translatedByLanguage,
            detectedSourceLang,
            confidence,
            latencyMs: Date.now() - startedAt,
            timestamp: Date.now(),
            speakerName,
        };
    }
}