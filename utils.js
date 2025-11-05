// Utility functions for the Gemini Live to OpenAI Adapter

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
    const {messages, model, stream, temperature, max_tokens} = body;

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
