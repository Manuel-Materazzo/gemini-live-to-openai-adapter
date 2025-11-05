// Utility functions for the Gemini Live to OpenAI Adapter

import {ALLOWED_IPS, TRUSTED_PROXY_IPS, REVERSE_PROXY_MODE} from './config.js';

/**
 * Convert OpenAI messages to Live API turns
 * @param {Array} messages - Array of OpenAI message objects
 * @returns {Array} Array of Live API turn objects
 */
export function convertToLiveAPITurns(messages) {
    return messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts: [{text: msg.content}]
    }));
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
    }

    for (const msg of messages) {
        if (!msg.role || !msg.content) {
            errors.push('Each message must have role and content');
        } else if (!['user', 'assistant', 'system'].includes(msg.role)) {
            errors.push('Invalid message role');
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
    if (!REVERSE_PROXY_MODE) {
        return req.ip || req.connection.remoteAddress;
    }

    const immediateProxyIP = req.ip || req.connection.remoteAddress;
    if (!TRUSTED_PROXY_IPS.includes(immediateProxyIP)) {
        return immediateProxyIP;
    }
    const forwarded = req.headers.forwarded;
    if (forwarded) {
        const forwardedFor = forwarded.split(';').find(part => part.trim().startsWith('for='));
        if (forwardedFor) {
            const ipMatch = forwardedFor.trim().match(/for=([^;,\s]+)/u);
            if (ipMatch) {
            return ipMatch[1].replaceAll(/^\[|\]$/g, '').replaceAll(/(^"|"$)/g, '');
            }
        }
    }

    const xForwardedFor = req.headers['x-forwarded-for'];
    if (xForwardedFor) {
        return xForwardedFor.split(',')[0].trim().replaceAll(/^\[|\]$/g, '').replaceAll(/(^"|"$)/g, '');
    }

    return immediateProxyIP;
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
        const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
        // Check if IP is in the subnet
        return (ipNum & mask) === (network & mask);
    }
}
