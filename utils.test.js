import {describe, it, expect, vi, beforeEach} from 'vitest';

// ── Helpers for ipRestrictionMiddleware tests ──────────────────────────
function mockReq(ip) {
    return {ip};
}

function mockRes() {
    const res = {};
    res.json = vi.fn().mockReturnValue(res);
    res.status = vi.fn().mockReturnValue(res);
    return res;
}

// ── Pure functions (no config dependency) ──────────────────────────────

// These can be imported statically because they don't read config at call-time
// in a way that needs per-test variation.
import {
    convertToLiveAPITurns,
    validateChatRequest,
    buildWavHeader,
    wantsAudioOutput,
} from './utils.js';

// ═══════════════════════════════════════════════════════════════════════
// convertToLiveAPITurns
// ═══════════════════════════════════════════════════════════════════════
describe('convertToLiveAPITurns', () => {
    it('keeps user role as-is', () => {
        const result = convertToLiveAPITurns([{role: 'user', content: 'hello'}]);
        expect(result).toEqual([{role: 'user', parts: [{text: 'hello'}]}]);
    });

    it('maps assistant to model', () => {
        const result = convertToLiveAPITurns([{role: 'assistant', content: 'hi'}]);
        expect(result).toEqual([{role: 'model', parts: [{text: 'hi'}]}]);
    });

    it('maps system to user with [SYSTEM] prefix', () => {
        const result = convertToLiveAPITurns([{role: 'system', content: 'Be helpful'}]);
        expect(result).toEqual([{role: 'user', parts: [{text: '[SYSTEM] Be helpful'}]}]);
    });

    it('handles mixed messages in order', () => {
        const messages = [
            {role: 'system', content: 'sys'},
            {role: 'user', content: 'u'},
            {role: 'assistant', content: 'a'},
        ];
        const result = convertToLiveAPITurns(messages);
        expect(result).toEqual([
            {role: 'user', parts: [{text: '[SYSTEM] sys'}]},
            {role: 'user', parts: [{text: 'u'}]},
            {role: 'model', parts: [{text: 'a'}]},
        ]);
    });

    it('returns empty array for empty input', () => {
        expect(convertToLiveAPITurns([])).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// validateChatRequest
// ═══════════════════════════════════════════════════════════════════════
describe('validateChatRequest', () => {
    const validBody = () => ({
        messages: [{role: 'user', content: 'hi'}],
    });

    it('accepts a valid minimal request', () => {
        expect(validateChatRequest(validBody())).toEqual({isValid: true});
    });

    // ── messages ────────────────────────────────────────────────────
    it('rejects missing messages', () => {
        const result = validateChatRequest({});
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('messages must be a non-empty array');
    });

    it('rejects empty messages array', () => {
        const result = validateChatRequest({messages: []});
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('messages must be a non-empty array');
    });

    it('rejects messages that is not an array', () => {
        const result = validateChatRequest({messages: 'hello'});
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('messages must be a non-empty array');
    });

    it('rejects message without role', () => {
        const result = validateChatRequest({messages: [{content: 'hi'}]});
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Each message must have role and content');
    });

    it('rejects message with non-string content', () => {
        const result = validateChatRequest({messages: [{role: 'user', content: 123}]});
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Each message must have role and content');
    });

    it('rejects invalid role', () => {
        const result = validateChatRequest({messages: [{role: 'admin', content: 'hi'}]});
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Invalid message role');
    });

    // ── temperature ─────────────────────────────────────────────────
    it('accepts temperature 0', () => {
        expect(validateChatRequest({...validBody(), temperature: 0})).toEqual({isValid: true});
    });

    it('accepts temperature 2', () => {
        expect(validateChatRequest({...validBody(), temperature: 2})).toEqual({isValid: true});
    });

    it('rejects temperature -1', () => {
        const result = validateChatRequest({...validBody(), temperature: -1});
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('temperature must be between 0 and 2');
    });

    it('rejects temperature 3', () => {
        const result = validateChatRequest({...validBody(), temperature: 3});
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('temperature must be between 0 and 2');
    });

    // ── max_tokens ──────────────────────────────────────────────────
    it('accepts valid max_tokens', () => {
        expect(validateChatRequest({...validBody(), max_tokens: 100})).toEqual({isValid: true});
    });

    it('rejects max_tokens 0', () => {
        const result = validateChatRequest({...validBody(), max_tokens: 0});
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('max_tokens must be a positive integer');
    });

    it('rejects max_tokens -1', () => {
        const result = validateChatRequest({...validBody(), max_tokens: -1});
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('max_tokens must be a positive integer');
    });

    it('rejects max_tokens float', () => {
        const result = validateChatRequest({...validBody(), max_tokens: 1.5});
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('max_tokens must be a positive integer');
    });

    // ── stream ──────────────────────────────────────────────────────
    it('accepts stream boolean', () => {
        expect(validateChatRequest({...validBody(), stream: true})).toEqual({isValid: true});
        expect(validateChatRequest({...validBody(), stream: false})).toEqual({isValid: true});
    });

    it('rejects stream non-boolean', () => {
        const result = validateChatRequest({...validBody(), stream: 'yes'});
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('stream must be a boolean');
    });

    // ── audio.format ────────────────────────────────────────────────
    it('accepts valid audio formats', () => {
        expect(validateChatRequest({...validBody(), audio: {format: 'wav'}})).toEqual({isValid: true});
        expect(validateChatRequest({...validBody(), audio: {format: 'pcm16'}})).toEqual({isValid: true});
    });

    it('rejects invalid audio format', () => {
        const result = validateChatRequest({...validBody(), audio: {format: 'mp3'}});
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('audio.format must be "wav" or "pcm16"');
    });

    // ── multiple errors ─────────────────────────────────────────────
    it('combines multiple errors', () => {
        const result = validateChatRequest({
            messages: [{role: 'user', content: 'hi'}],
            temperature: 5,
            max_tokens: -1,
            stream: 'yes',
        });
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('temperature');
        expect(result.error).toContain('max_tokens');
        expect(result.error).toContain('stream');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// buildWavHeader
// ═══════════════════════════════════════════════════════════════════════
describe('buildWavHeader', () => {
    it('returns a 44-byte buffer', () => {
        const header = buildWavHeader(1000);
        expect(header.length).toBe(44);
    });

    it('has RIFF signature at offset 0', () => {
        const header = buildWavHeader(1000);
        expect(header.toString('ascii', 0, 4)).toBe('RIFF');
    });

    it('has correct file size at offset 4', () => {
        const dataLength = 2000;
        const header = buildWavHeader(dataLength);
        expect(header.readUInt32LE(4)).toBe(36 + dataLength);
    });

    it('has WAVE at offset 8', () => {
        const header = buildWavHeader(1000);
        expect(header.toString('ascii', 8, 12)).toBe('WAVE');
    });

    it('has fmt at offset 12', () => {
        const header = buildWavHeader(1000);
        expect(header.toString('ascii', 12, 16)).toBe('fmt ');
    });

    it('has subchunk1 size 16 (PCM) at offset 16', () => {
        const header = buildWavHeader(1000);
        expect(header.readUInt32LE(16)).toBe(16);
    });

    it('has audio format 1 (PCM) at offset 20', () => {
        const header = buildWavHeader(1000);
        expect(header.readUInt16LE(20)).toBe(1);
    });

    it('has data sub-chunk marker at offset 36', () => {
        const header = buildWavHeader(1000);
        expect(header.toString('ascii', 36, 40)).toBe('data');
    });

    it('has data length at offset 40', () => {
        const header = buildWavHeader(5000);
        expect(header.readUInt32LE(40)).toBe(5000);
    });

    it('writes default parameters correctly', () => {
        const header = buildWavHeader(1000);
        expect(header.readUInt16LE(22)).toBe(1);     // channels
        expect(header.readUInt32LE(24)).toBe(24000);  // sample rate
        expect(header.readUInt16LE(34)).toBe(16);     // bits per sample
        // byte rate = 24000 * 1 * 2 = 48000
        expect(header.readUInt32LE(28)).toBe(48000);
        // block align = 1 * 2 = 2
        expect(header.readUInt16LE(32)).toBe(2);
    });

    it('writes custom parameters correctly', () => {
        const header = buildWavHeader(4000, 44100, 2, 24);
        expect(header.readUInt16LE(22)).toBe(2);      // channels
        expect(header.readUInt32LE(24)).toBe(44100);   // sample rate
        expect(header.readUInt16LE(34)).toBe(24);      // bits per sample
        // byte rate = 44100 * 2 * 3 = 264600
        expect(header.readUInt32LE(28)).toBe(264600);
        // block align = 2 * 3 = 6
        expect(header.readUInt16LE(32)).toBe(6);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// wantsAudioOutput
// ═══════════════════════════════════════════════════════════════════════
describe('wantsAudioOutput', () => {
    it('returns true when modalities contains "audio"', () => {
        expect(wantsAudioOutput(['audio'])).toBe(true);
    });

    it('returns true when modalities contains "audio" among others', () => {
        expect(wantsAudioOutput(['text', 'audio'])).toBe(true);
    });

    it('returns false when modalities does not contain audio', () => {
        expect(wantsAudioOutput(['text'])).toBe(false);
    });

    it('returns false for null', () => {
        expect(wantsAudioOutput(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(wantsAudioOutput(undefined)).toBe(false);
    });

    it('is case-insensitive for "Audio"', () => {
        expect(wantsAudioOutput(['Audio'])).toBe(true);
    });

    it('is case-insensitive for "AUDIO"', () => {
        expect(wantsAudioOutput(['AUDIO'])).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// ipRestrictionMiddleware  (requires config mock)
// ═══════════════════════════════════════════════════════════════════════
describe('ipRestrictionMiddleware', () => {
    let ipRestrictionMiddleware;

    async function loadMiddleware(allowedIps) {
        vi.resetModules();
        vi.doMock('./config.js', () => ({
            ALLOWED_IPS: allowedIps,
            TOKEN_COUNT_MODE: 'off',
        }));
        const utils = await import('./utils.js');
        ipRestrictionMiddleware = utils.ipRestrictionMiddleware;
    }

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('calls next() when ALLOWED_IPS is empty', async () => {
        await loadMiddleware([]);
        const next = vi.fn();
        ipRestrictionMiddleware(mockReq('1.2.3.4'), mockRes(), next);
        expect(next).toHaveBeenCalled();
    });

    it('calls next() when client IP matches an allowed IP', async () => {
        await loadMiddleware(['10.0.0.1']);
        const next = vi.fn();
        ipRestrictionMiddleware(mockReq('10.0.0.1'), mockRes(), next);
        expect(next).toHaveBeenCalled();
    });

    it('returns 403 when client IP is not in the allowed list', async () => {
        await loadMiddleware(['10.0.0.1']);
        const next = vi.fn();
        const res = mockRes();
        ipRestrictionMiddleware(mockReq('10.0.0.2'), res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.objectContaining({type: 'access_denied'}),
            }),
        );
    });

    it('matches IPv4 CIDR /24', async () => {
        await loadMiddleware(['192.168.1.0/24']);
        const next = vi.fn();
        ipRestrictionMiddleware(mockReq('192.168.1.55'), mockRes(), next);
        expect(next).toHaveBeenCalled();
    });

    it('rejects IP outside IPv4 CIDR /24', async () => {
        await loadMiddleware(['192.168.1.0/24']);
        const next = vi.fn();
        const res = mockRes();
        ipRestrictionMiddleware(mockReq('192.168.2.1'), res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('matches IPv6 CIDR', async () => {
        await loadMiddleware(['2001:db8::/32']);
        const next = vi.fn();
        ipRestrictionMiddleware(mockReq('2001:0db8:0000:0000:0000:0000:0000:0001'), mockRes(), next);
        expect(next).toHaveBeenCalled();
    });

    it('strips ::ffff: prefix from client IP', async () => {
        await loadMiddleware(['10.0.0.5']);
        const next = vi.fn();
        ipRestrictionMiddleware(mockReq('::ffff:10.0.0.5'), mockRes(), next);
        expect(next).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// calculateTokenUsage  (requires config mock)
// ═══════════════════════════════════════════════════════════════════════
describe('calculateTokenUsage', () => {
    let calculateTokenUsage;

    async function loadWithMode(mode) {
        vi.resetModules();
        vi.doMock('./config.js', () => ({
            ALLOWED_IPS: [],
            TOKEN_COUNT_MODE: mode,
        }));
        const utils = await import('./utils.js');
        calculateTokenUsage = utils.calculateTokenUsage;
    }

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('returns zeros in "off" mode', async () => {
        await loadWithMode('off');
        const result = await calculateTokenUsage({
            ai: null,
            model: 'gemini',
            messages: [{role: 'user', content: 'hello world'}],
            completionText: 'some response',
        });
        expect(result).toEqual({prompt_tokens: 0, completion_tokens: 0, total_tokens: 0});
    });

    it('estimates tokens in "estimate" mode using ~4 chars/token', async () => {
        await loadWithMode('estimate');
        const promptContent = 'abcdefgh'; // 8 chars → ceil(8/4) = 2
        const completionText = 'abcdefghijklmnop'; // 16 chars → ceil(16/4) = 4
        const result = await calculateTokenUsage({
            ai: null,
            model: 'gemini',
            messages: [{role: 'user', content: promptContent}],
            completionText,
        });
        expect(result.prompt_tokens).toBe(2);
        expect(result.completion_tokens).toBe(4);
        expect(result.total_tokens).toBe(6);
    });

    it('calls countTokens API in "count_tokens" mode', async () => {
        await loadWithMode('count_tokens');
        const ai = {
            models: {
                countTokens: vi.fn().mockResolvedValue({totalTokens: 42}),
            },
        };
        const completionText = 'abcdefgh'; // 8 chars → ceil(8/4) = 2 (estimated for completion)
        const result = await calculateTokenUsage({
            ai,
            model: 'test-model',
            messages: [{role: 'user', content: 'hello'}],
            completionText,
        });
        expect(ai.models.countTokens).toHaveBeenCalledOnce();
        expect(result.prompt_tokens).toBe(42);
        expect(result.completion_tokens).toBe(2);
        expect(result.total_tokens).toBe(44);
    });

    it('falls back to estimate when countTokens API throws', async () => {
        await loadWithMode('count_tokens');
        const ai = {
            models: {
                countTokens: vi.fn().mockRejectedValue(new Error('API down')),
            },
        };
        const promptContent = 'abcdefghijkl'; // 12 chars → ceil(12/4) = 3
        const completionText = 'abcd'; // 4 chars → ceil(4/4) = 1
        const result = await calculateTokenUsage({
            ai,
            model: 'test-model',
            messages: [{role: 'user', content: promptContent}],
            completionText,
        });
        expect(ai.models.countTokens).toHaveBeenCalledOnce();
        // Fallback: prompt estimated from joined content
        expect(result.prompt_tokens).toBe(3);
        expect(result.completion_tokens).toBe(1);
        expect(result.total_tokens).toBe(4);
    });
});
