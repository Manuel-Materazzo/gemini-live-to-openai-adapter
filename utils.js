// Utility functions for the Gemini Live to OpenAI Adapter

import {ALLOWED_IPS, TOKEN_COUNT_MODE} from './config.js';

/**
 * Convert OpenAI messages to Live API turns
 * @param {Array} messages - Array of OpenAI message objects
 * @returns {Array} Array of Live API turn objects
 */
export function convertToLiveAPITurns(messages) {
    return messages.map(msg => {
        let role;
        if (msg.role === 'assistant') {
            role = 'model';
        } else if (msg.role === 'system') {
            role = 'user';
        } else {
            role = msg.role;
        }
        const text = msg.role === 'system' ? `[SYSTEM] ${msg.content}` : msg.content;
        return {role, parts: [{text}]};
    });
}

/**
 * Validate request parameters for chat completions
 * @param {Object} body - Request body
 * @returns {Object} Validation result with isValid and error message
 */
export function validateChatRequest(body) {
    const {messages, stream, temperature, max_tokens} = body;
    const errors = [];

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        errors.push('messages must be a non-empty array');
    } else {
        for (const msg of messages) {
            if (!msg.role || typeof msg.content !== 'string') {
                errors.push('Each message must have role and content (content must be a string)');
            } else if (!['user', 'assistant', 'system'].includes(msg.role)) {
                errors.push('Invalid message role');
            }
        }
    }

    if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
        errors.push('temperature must be between 0 and 2');
    }

    if (max_tokens !== undefined && (!Number.isInteger(max_tokens) || max_tokens <= 0)) {
        errors.push('max_tokens must be a positive integer');
    }

    if (stream !== undefined && typeof stream !== 'boolean') {
        errors.push('stream must be a boolean');
    }

    const audio = body.audio;
    if (audio?.format && !['wav', 'pcm16'].includes(audio.format)) {
        errors.push('audio.format must be "wav" or "pcm16"');
    }

    if (errors.length > 0) {
        return {isValid: false, error: errors.join(', ')};
    }

    return {isValid: true};
}

/**
 * Extract the real client IP address considering proxies
 * @param {Object} req - Express request object
 * @returns {string} Real client IP address
 */
function getRealClientIP(req) {
    let ip = req.ip || req.connection.remoteAddress;
    if (ip?.startsWith('::ffff:')) ip = ip.substring(7);
    return ip;
}

/**
 * Middleware to restrict access by IP address
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
export function ipRestrictionMiddleware(req, res, next) {
    if (ALLOWED_IPS.length === 0) {
        // No restrictions if no IPs configured
        return next();
    }

    const clientIP = getRealClientIP(req);

    if (ALLOWED_IPS.includes(clientIP)) {
        return next();
    }

    // Check for CIDR matches (basic implementation for /32, /24, /16, /8)
    for (const allowed of ALLOWED_IPS) {
        if (isIPInCIDR(clientIP, allowed)) {
            return next();
        }
    }

    console.log(`🚫 Access denied for IP: ${clientIP} (not in allowed list: ${ALLOWED_IPS.join(', ')})`);
    return res.status(403).json({
        error: {
            message: 'Access denied: IP not allowed',
            type: 'access_denied'
        }
    });
}

/**
 * Build a WAV header for raw PCM data
 * @param {number} dataLength - Length of the PCM data in bytes
 * @param {number} sampleRate - Sample rate (default 24000 for Gemini output)
 * @param {number} channels - Number of channels (default 1 mono)
 * @param {number} bitsPerSample - Bits per sample (default 16)
 * @returns {Buffer} WAV header buffer
 */
export function buildWavHeader(dataLength, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return header;
}

/**
 * Determine if the request wants audio output
 * @param {Array} modalities - The modalities array from the request
 * @returns {boolean} True if audio output is requested
 */
export function wantsAudioOutput(modalities) {
    if (!modalities || !Array.isArray(modalities)) return false;
    return modalities.some(m => m.toLowerCase() === 'audio');
}

/**
 * Estimate token count from text using character heuristic (1 token ≈ 4 characters)
 * @param {string} text - Text to estimate tokens for
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

/**
 * Count prompt tokens using the Gemini countTokens API
 * @param {Object} ai - GoogleGenAI instance
 * @param {string} model - Model name
 * @param {Array} messages - OpenAI-format messages
 * @returns {Promise<number>} Token count
 */
async function countPromptTokensViaAPI(ai, model, messages) {
    try {
        const contents = messages.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{text: msg.role === 'system' ? `[SYSTEM] ${msg.content}` : msg.content}]
        }));
        const response = await ai.models.countTokens({model, contents});
        return response.totalTokens || 0;
    } catch (e) {
        console.error('[Token Count] countTokens API failed, falling back to estimate:', e.message);
        return estimateTokens(messages.map(m => m.content).join(''));
    }
}

/**
 * Calculate token usage for prompt and completion
 * @param {Object} options - Options
 * @param {Object} options.ai - GoogleGenAI instance (required for 'count_tokens' mode)
 * @param {string} options.model - Model name
 * @param {Array} options.messages - OpenAI-format input messages
 * @param {string} options.completionText - Generated completion text
 * @returns {Promise<Object>} Usage object with prompt_tokens, completion_tokens, total_tokens
 */
export async function calculateTokenUsage({ai, model, messages, completionText}) {
    if (TOKEN_COUNT_MODE === 'off') {
        return {prompt_tokens: 0, completion_tokens: 0, total_tokens: 0};
    }

    let promptTokens, completionTokens;

    if (TOKEN_COUNT_MODE === 'count_tokens') {
        promptTokens = await countPromptTokensViaAPI(ai, model, messages);
        // countTokens doesn't work for Live API output, so estimate completion
        completionTokens = estimateTokens(completionText);
    } else {
        // 'estimate' mode
        const promptText = messages.map(m => m.content).join('');
        promptTokens = estimateTokens(promptText);
        completionTokens = estimateTokens(completionText);
    }

    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
    };
}

/**
 * Check if string is a valid IPv4 address
 * @param {string} ip - IP address string
 * @returns {boolean} True if valid IPv4
 */
function isValidIPv4(ip) {
    const octets = ip.split('.');
    return octets.length === 4 && octets.every(o => {
        const num = Number.parseInt(o, 10);
        return num >= 0 && num <= 255 && o === num.toString();
    });
}

/**
 * Check if string is a valid IPv6 address
 * @param {string} ip - IP address string
 * @returns {boolean} True if valid IPv6
 */
function isValidIPv6(ip) {
    const normalized = normalizeIPv6(ip);
    const parts = normalized.split(':');
    return parts.length === 8 && parts.every(p => /^[0-9a-fA-F]{1,4}$/.test(p));
}

/**
 * Normalize an IPv6 address by expanding :: abbreviations
 * @param {string} ip - IPv6 address
 * @returns {string} Normalized IPv6 address
 */
function normalizeIPv6(ip) {
    if (!ip.includes('::')) return ip;
    const parts = ip.split('::');
    const left = parts[0] ? parts[0].split(':').filter(p => p !== '') : [];
    const right = parts[1] ? parts[1].split(':').filter(p => p !== '') : [];
    const missing = 8 - left.length - right.length;
    const zeros = new Array(missing).fill('0');
    return [...left, ...zeros, ...right].join(':');
}

/**
 * Convert an IPv6 address to BigInt
 * @param {string} ip - IPv6 address
 * @returns {bigint} 128-bit BigInt representation
 */
function ipv6ToBigInt(ip) {
    const normalized = normalizeIPv6(ip);
    const parts = normalized.split(':');
    let result = 0n;
    for (const part of parts) {
        result = (result << 16n) | BigInt(Number.parseInt(part, 16));
    }
    return result;
}

/**
 * Check if an IP is within a CIDR range
 * @param {string} ip - IP address to check
 * @param {string} cidr - CIDR notation (e.g., 192.168.1.0/24 or 2001:db8::/32)
 * @returns {boolean} True if IP is in range
 */
function isIPInCIDR(ip, cidr) {
    if (!cidr.includes('/')) {
        return false; // Not CIDR
    }

    const [networkStr, prefixStr] = cidr.split('/');
    const prefix = Number.parseInt(prefixStr, 10);

    const isIPv6 = ip.includes(':') || networkStr.includes(':');

    // Validate IP addresses
    if (isIPv6) {
        if (!isValidIPv6(ip) || !isValidIPv6(networkStr)) return false;
    } else {
        if (!isValidIPv4(ip) || !isValidIPv4(networkStr)) return false;
    }
    if (isIPv6) {
        // IPv6
        if (prefix < 0 || prefix > 128) {
            return false;
        }
        const network = ipv6ToBigInt(networkStr);
        const ipNum = ipv6ToBigInt(ip);
        const mask = ~((1n << (128n - BigInt(prefix))) - 1n);
        return (ipNum & mask) === (network & mask);
    } else {
        // IPv4
        if (prefix < 0 || prefix > 32) {
            return false;
        }
        // Convert IPs to 32-bit integers
        const ipToInt = (ipStr) => ipStr.split('.').reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0) >>> 0;
        const network = ipToInt(networkStr);
        const ipNum = ipToInt(ip);
        // Calculate subnet mask
        const mask = prefix === 0 ? 0 : ((0xFFFFFFFF << (32 - prefix)) >>> 0);
        // Check if IP is in the subnet
        return (ipNum & mask) === (network & mask);
    }
}
