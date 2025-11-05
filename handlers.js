// Handlers for the Gemini Live to OpenAI Adapter

import {GoogleGenAI, Modality} from '@google/genai';
import {convertToLiveAPITurns, validateChatRequest} from './utils.js';
import {DEFAULT_MODEL} from './config.js';

/**
 * Build configuration for Live API session
 * @param {Object} options - Configuration options
 * @returns {Object} Session configuration
 */
function buildSessionConfig(options) {
    const config = {
        responseModalities: [Modality.TEXT]
    };

    // Add generation config if provided
    if (options.temperature !== undefined || options.maxTokens !== undefined) {
        config.generationConfig = {};
        if (options.temperature !== undefined) config.generationConfig.temperature = options.temperature;
        if (options.maxTokens !== undefined) config.generationConfig.maxOutputTokens = options.maxTokens;
    }

    return config;
}

/**
 * Create streaming response handler
 * @param {Object} res - Express response object
 * @param {string} model - Model name
 * @returns {Object} Handler functions
 */
function createStreamingHandler(res, model) {
    let fullResponse = '';

    return {
        onMessage: (message) => {
            if (message.text) {
                fullResponse += message.text;
                sendStreamChunk(res, model, message.text);
            }
        },
        onComplete: () => {
            sendFinalStreamChunk(res, model);
            res.write('data: [DONE]\n\n');
            res.end();
        },
        getFullResponse: () => fullResponse
    };
}

/**
 * Send a streaming chunk to the response
 * @param {Object} res - Express response object
 * @param {string} model - Model name
 * @param {string} content - Content to send
 */
function sendStreamChunk(res, model, content) {
    const chunk = {
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            delta: {content: content},
            finish_reason: null
        }]
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

/**
 * Send the final streaming chunk
 * @param {Object} res - Express response object
 * @param {string} model - Model name
 */
function sendFinalStreamChunk(res, model) {
    const finalChunk = {
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop'
        }]
    };
    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
}

/**
 * Create Live API session with callbacks
 * @param {Object} ai - GoogleGenAI instance
 * @param {Object} options - Session options
 * @returns {Promise} Promise that resolves with {session, responsePromise}
 */
function createLiveSession(ai, options) {
    const {model, config, streamHandler} = options;

    let fullResponse = '';
    let isComplete = false;
    let responseResolver, responseRejecter;
    const responsePromise = new Promise((resolve, reject) => {
        responseResolver = resolve;
        responseRejecter = reject;
    });

    const sessionPromise = ai.live.connect({
        model: model,
        config: config,
        callbacks: {
            onopen: () => {
                console.log('[Live API] Connection opened');
            },
            onmessage: (message) => {
                if (message.text) {
                    fullResponse += message.text;

                    if (streamHandler) {
                        streamHandler.onMessage(message);
                    }
                }

                if (message.serverContent?.turnComplete) {
                    isComplete = true;
                    if (streamHandler) {
                        streamHandler.onComplete();
                    }
                    responseResolver(fullResponse);
                }
            },
            onerror: (e) => {
                console.error('[Live API] Error:', e.message);
                responseRejecter(new Error(e.message || 'Live API error'));
            },
            onclose: (e) => {
                console.log('[Live API] Connection closed:', e.reason);
                if (!isComplete) {
                    responseRejecter(new Error(e.reason || 'Connection closed unexpectedly'));
                }
            }
        }
    });

    return sessionPromise.then(session => ({session, responsePromise}));
}

/**
 * Format non-streaming response
 * @param {string} content - Response content
 * @param {string} model - Model name
 * @returns {Object} Formatted response
 */
function formatNonStreamingResponse(content, model) {
    return {
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: content
            },
            finish_reason: 'stop'
        }],
        usage: {
            prompt_tokens: -1, // Live API doesn't provide this immediately
            completion_tokens: -1,
            total_tokens: -1
        }
    };
}

/**
 * Set up streaming response headers
 * @param {Object} res - Express response object
 */
function setupStreamingHeaders(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.status(200);
}

/**
 * Handle OpenAI-compatible chat completions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function handleChatCompletions(req, res) {
    try {
        // Extract API key from Bearer token
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({
                error: {
                    message: 'Authorization header with Bearer token required',
                    type: 'authentication_error'
                }
            });
        }
        const apiKey = authHeader.substring(7); // Remove 'Bearer '

        // Create GoogleGenAI instance with the API key
        const ai = new GoogleGenAI({apiKey: apiKey});

        const {messages, model = DEFAULT_MODEL, stream = false, temperature, max_tokens} = req.body;

        // Validate request
        const validation = validateChatRequest(req.body);
        if (!validation.isValid) {
            return res.status(400).json({
                error: {
                    message: validation.error,
                    type: 'invalid_request_error'
                }
            });
        }

        // Build session configuration
        const config = buildSessionConfig({temperature, maxTokens: max_tokens});

        let streamHandler;

        // Set up streaming if requested
        if (stream) {
            setupStreamingHeaders(res);
            streamHandler = createStreamingHandler(res, model);
        }

        // Create Live API session
        const {session, responsePromise} = await createLiveSession(ai, {model, config, streamHandler});

        // Convert and send messages
        const turns = convertToLiveAPITurns(messages);
        const lastUserMessage = turns.at(-1);
        session.sendClientContent({turns: lastUserMessage, turnComplete: true});

        // Wait for response
        const completeResponse = await responsePromise;

        // Close the session
        session.close();

        // Send response
        if (!stream) {
            const response = formatNonStreamingResponse(completeResponse, model);
            res.json(response);
        }

    } catch (error) {
        console.error('Error in chat completions:', error);

        if (!res.headersSent) {
            res.status(500).json({
                error: {
                    message: error.message || 'Internal server error',
                    type: 'server_error'
                }
            });
        } else if (stream) {
            // For streaming, try to send error in stream format
            try {
                res.write(`data: ${JSON.stringify({
                    error: {
                        message: error.message || 'Internal server error',
                        type: 'server_error'
                    }
                })}\n\n`);
                res.end();
            } catch (e) {
                console.error('Failed to send error in stream:', e.message);
            }
        }
    }
}
