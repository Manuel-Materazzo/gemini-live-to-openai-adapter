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

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return {isValid: false, error: 'messages must be a non-empty array'};
    }

    for (const msg of messages) {
        if (!msg.role || !msg.content) {
            return {isValid: false, error: 'Each message must have role and content'};
        }
        if (!['user', 'assistant', 'system'].includes(msg.role)) {
            return {isValid: false, error: 'Invalid message role'};
        }
    }

    if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
        return {isValid: false, error: 'temperature must be between 0 and 2'};
    }

    if (max_tokens !== undefined && (!Number.isInteger(max_tokens) || max_tokens <= 0)) {
        return {isValid: false, error: 'max_tokens must be a positive integer'};
    }

    if (stream !== undefined && typeof stream !== 'boolean') {
        return {isValid: false, error: 'stream must be a boolean'};
    }

    return {isValid: true};
}

/**
 * Extract the real client IP address considering proxies
 * @param {Object} req - Express request object
 * @returns {string} Real client IP address
 */
function getRealClientIP(req) {
    if (REVERSE_PROXY_MODE) {
        // Check if the immediate proxy is trusted
        const immediateProxyIP = req.ip || req.connection.remoteAddress;
        if (TRUSTED_PROXY_IPS.includes(immediateProxyIP)) {
            // Use Forwarded header first, then X-Forwarded-For
            const forwarded = req.headers.forwarded;
            if (forwarded) {
                const forwardedFor = forwarded.split(';').find(part => part.trim().startsWith('for='));
                if (forwardedFor) {
                    const ipMatch = forwardedFor.trim().match(/for=([^;,\s]+)/u);
                    if (ipMatch) return ipMatch[1].replaceAll(/^"|"$/g, '');
                }
            }

            const xForwardedFor = req.headers['x-forwarded-for'];
            if (xForwardedFor) {
                // Take the first (original client) IP
                return xForwardedFor.split(',')[0].trim();
            }
        }
    }

    // Default to req.ip or remote address
    return req.ip || req.connection.remoteAddress;
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
 * Check if an IP is within a CIDR range (basic implementation)
 * @param {string} ip - IP address to check
 * @param {string} cidr - CIDR notation (e.g., 192.168.1.0/24)
 * @returns {boolean} True if IP is in range
 */
function isIPInCIDR(ip, cidr) {
    if (!cidr.includes('/')) {
        return false; // Not CIDR
    }

    const [network, prefix] = cidr.split('/');
    const prefixLen = Number.parseInt(prefix, 10);

    // For simplicity, support IPv4 only and basic prefixes
    if (prefixLen === 32) return ip === network;
    if (prefixLen === 24) return ip.startsWith(network.split('.').slice(0, 3).join('.'));
    if (prefixLen === 16) return ip.startsWith(network.split('.').slice(0, 2).join('.'));
    if (prefixLen === 8) return ip.startsWith(network.split('.')[0]);

    // For other prefixes, exact match only
    return false;
}
