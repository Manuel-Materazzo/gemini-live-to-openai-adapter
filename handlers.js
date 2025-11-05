// Handlers for the Gemini Live to OpenAI Adapter

import {GoogleGenAI, Modality} from '@google/genai';
import {convertToLiveAPITurns, validateChatRequest} from './utils.js';
import {DEFAULT_MODEL} from './config.js';

/**
 * Handle OpenAI-compatible chat completions
 * @param {Object} ai - GoogleGenAI instance
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function handleChatCompletions(ai, req, res) {
    try {
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

        // Configure Live API session
        const config = {
            responseModalities: [Modality.TEXT]
        };

        // Add generation config if provided
        if (temperature !== undefined || max_tokens !== undefined) {
            config.generationConfig = {};
            if (temperature !== undefined) config.generationConfig.temperature = temperature;
            if (max_tokens !== undefined) config.generationConfig.maxOutputTokens = max_tokens;
        }

        let session;
        let fullResponse = '';
        let resolver, rejecter;
        const responsePromise = new Promise((resolve, reject) => {
            resolver = resolve;
            rejecter = reject;
        });

        // Set streaming headers if needed
        if (stream) {
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.status(200);
        }

        // Create Live API session
        session = await ai.live.connect({
            model: model,
            config: config,
            callbacks: {
                onopen: () => {
                    console.log('[Live API] Connection opened');
                },
                onmessage: (message) => {
                    if (message.text) {
                        fullResponse += message.text;

                        // Handle streaming
                        if (stream) {
                            const chunk = {
                                id: 'chatcmpl-' + Date.now(),
                                object: 'chat.completion.chunk',
                                created: Math.floor(Date.now() / 1000),
                                model: model,
                                choices: [{
                                    index: 0,
                                    delta: {content: message.text},
                                    finish_reason: null
                                }]
                            };
                            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                        }
                    }

                    if (message.serverContent?.turnComplete) {
                        resolver(fullResponse);
                    }
                },
                onerror: (e) => {
                    console.error('[Live API] Error:', e.message);
                    rejecter(new Error(e.message || 'Live API error'));
                },
                onclose: (e) => {
                    console.log('[Live API] Connection closed:', e.reason);
                }
            }
        });

        // Convert and send messages
        const turns = convertToLiveAPITurns(messages);
        const lastUserMessage = turns[turns.length - 1];
        session.sendClientContent({turns: lastUserMessage, turnComplete: true});

        // Wait for complete response
        const completeResponse = await responsePromise;

        // Close the session
        session.close();

        // Send response
        if (stream) {
            // Send final chunk
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
            res.write('data: [DONE]\n\n');
            res.end();
        } else {
            const response = {
                id: 'chatcmpl-' + Date.now(),
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: completeResponse
                    },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: -1, // Live API doesn't provide this immediately
                    completion_tokens: -1,
                    total_tokens: -1
                }
            };
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
                // Ignore if can't write
            }
        }
    }
}
