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
                return ipMatch[1].replaceAll(/(^"|"$)/g, '');
            }
        }
    }

    const xForwardedFor = req.headers['x-forwarded-for'];
    if (xForwardedFor) {
        return xForwardedFor.split(',')[0].trim();
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
 * Check if an IP is within a CIDR range
 * @param {string} ip - IP address to check
 * @param {string} cidr - CIDR notation (e.g., 192.168.1.0/24)
 * @returns {boolean} True if IP is in range
 */
function isIPInCIDR(ip, cidr) {
    if (!cidr.includes('/')) {
        return false; // Not CIDR
    }

    const [networkStr, prefixStr] = cidr.split('/');
    const prefix = Number.parseInt(prefixStr, 10);

    // Support IPv4 only
    if (prefix < 0 || prefix > 32) {
        return false;
    }

    // Convert IPs to 32-bit integers
    const ipToInt = (ipStr) => ipStr.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;

    const network = ipToInt(networkStr);
    const ipNum = ipToInt(ip);

    // Calculate subnet mask
    const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;

    // Check if IP is in the subnet
    return (ipNum & mask) === (network & mask);
}
