// Handlers for the Gemini Live to OpenAI Adapter

import crypto from 'crypto';
import {GoogleGenAI, Modality} from '@google/genai';
import {convertToLiveAPITurns, validateChatRequest, buildWavHeader, wantsAudioOutput} from './utils.js';
import {DEFAULT_MODEL} from './config.js';

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 60000;

/**
 * Build configuration for Live API session
 * @param {Object} options - Configuration options
 * @returns {Object} Session configuration
 */
function buildSessionConfig(options) {
    const config = {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {}
    };

    // Add voice configuration if provided
    if (options.voice) {
        config.speechConfig = {
            voiceConfig: {
                prebuiltVoiceConfig: {voiceName: options.voice}
            }
        };
    }

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
 * @param {string} requestId - Request ID
 * @param {boolean} includeAudio - Whether to include audio in the stream
 * @returns {Object} Handler functions
 */
function createStreamingHandler(res, model, requestId, includeAudio) {
    let fullTranscript = '';
    const audioChunks = [];

    // Emit initial chunk with assistant role
    const initialChunk = {
        id: requestId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            delta: {role: 'assistant'},
            finish_reason: null
        }]
    };
    res.write(`data: ${JSON.stringify(initialChunk)}\n\n`);

    return {
        onTranscript: (text) => {
            fullTranscript += text;
            if (!includeAudio) {
                sendStreamChunk(res, model, requestId, {content: text});
            }
        },
        onAudioData: (base64Data) => {
            audioChunks.push(base64Data);
            if (includeAudio) {
                sendStreamChunk(res, model, requestId, {audio: {data: base64Data}});
            }
        },
        onComplete: () => {
            if (includeAudio && fullTranscript) {
                sendStreamChunk(res, model, requestId, {audio: {transcript: fullTranscript}});
            }
            sendFinalStreamChunk(res, model, requestId);
            res.write('data: [DONE]\n\n');
            res.end();
        },
        getFullTranscript: () => fullTranscript,
        getAudioChunks: () => audioChunks
    };
}

/**
 * Send a streaming chunk to the response
 * @param {Object} res - Express response object
 * @param {string} model - Model name
 * @param {string} requestId - Request ID
 * @param {Object} delta - Delta content to send
 */
function sendStreamChunk(res, model, requestId, delta) {
    const chunk = {
        id: requestId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            delta: delta,
            finish_reason: null
        }]
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

/**
 * Send the final streaming chunk
 * @param {Object} res - Express response object
 * @param {string} model - Model name
 * @param {string} requestId - Request ID
 */
function sendFinalStreamChunk(res, model, requestId) {
    const finalChunk = {
        id: requestId,
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

    let fullTranscript = '';
    const audioChunks = [];
    let isComplete = false;
    let settled = false;
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
                // Extract audio data from model turn
                if (message.serverContent?.modelTurn?.parts) {
                    for (const part of message.serverContent.modelTurn.parts) {
                        if (part.inlineData?.data) {
                            const base64Data = typeof part.inlineData.data === 'string'
                                ? part.inlineData.data
                                : Buffer.from(part.inlineData.data).toString('base64');
                            audioChunks.push(base64Data);
                            if (streamHandler) {
                                streamHandler.onAudioData(base64Data);
                            }
                        }
                    }
                }

                // Extract transcription text
                if (message.serverContent?.outputTranscription?.text) {
                    fullTranscript += message.serverContent.outputTranscription.text;
                    if (streamHandler) {
                        streamHandler.onTranscript(message.serverContent.outputTranscription.text);
                    }
                }

                if (message.serverContent?.turnComplete) {
                    isComplete = true;
                    settled = true;
                    if (streamHandler) {
                        streamHandler.onComplete();
                    }
                    responseResolver({transcript: fullTranscript, audioChunks});
                }
            },
            onerror: (e) => {
                console.error('[Live API] Error:', e.message);
                if (!settled) {
                    settled = true;
                    responseRejecter(new Error(e.message || 'Live API error'));
                }
            },
            onclose: (e) => {
                console.log('[Live API] Connection closed:', e.reason);
                if (!isComplete && !settled) {
                    settled = true;
                    responseRejecter(new Error(e.reason || 'Connection closed unexpectedly'));
                }
            }
        }
    });

    return sessionPromise.then(session => ({session, responsePromise}));
}

/**
 * Format non-streaming text-only response
 * @param {string} content - Response content
 * @param {string} model - Model name
 * @param {string} requestId - Request ID
 * @returns {Object} Formatted response
 */
function formatTextResponse(content, model, requestId) {
    return {
        id: requestId,
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
        }]
    };
}

/**
 * Format non-streaming audio response (OpenAI-compatible)
 * @param {string} transcript - Transcription text
 * @param {string} audioBase64 - Base64 encoded audio data
 * @param {string} model - Model name
 * @param {string} requestId - Request ID
 * @returns {Object} Formatted response
 */
function formatAudioResponse(transcript, audioBase64, model, requestId) {
    return {
        id: requestId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: null,
                audio: {
                    id: 'audio_' + crypto.randomUUID(),
                    data: audioBase64,
                    transcript: transcript
                }
            },
            finish_reason: 'stop'
        }]
    };
}

/**
 * Combine audio chunks into a single WAV base64 string
 * @param {Array} audioChunks - Array of base64 encoded PCM chunks
 * @param {string} format - Output format ('wav' or 'pcm16')
 * @returns {string} Combined base64 audio data
 */
function combineAudioChunks(audioChunks, format) {
    const pcmBuffers = audioChunks.map(chunk => Buffer.from(chunk, 'base64'));
    const pcmData = Buffer.concat(pcmBuffers);

    if (format === 'pcm16') {
        return pcmData.toString('base64');
    }

    // Default to WAV
    const wavHeader = buildWavHeader(pcmData.length);
    const wavBuffer = Buffer.concat([wavHeader, pcmData]);
    return wavBuffer.toString('base64');
}

/**
 * Set up streaming response headers
 * @param {Object} res - Express response object
 */
function setupStreamingHeaders(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.status(200);
    res.flushHeaders();
}

/**
 * Handle OpenAI-compatible chat completions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function handleChatCompletions(req, res) {
    let stream = false;
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
        const requestId = 'chatcmpl-' + crypto.randomUUID();

        const {messages, model = DEFAULT_MODEL, temperature, max_tokens, modalities, audio} = req.body;
        stream = req.body.stream ?? false;

        const includeAudio = wantsAudioOutput(modalities);
        const audioFormat = audio?.format || 'wav';
        const voice = audio?.voice;

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
        const config = buildSessionConfig({temperature, maxTokens: max_tokens, voice});

        let streamHandler;

        // Set up streaming if requested
        if (stream) {
            setupStreamingHeaders(res);
            streamHandler = createStreamingHandler(res, model, requestId, includeAudio);
        }

        // Create Live API session
        const {session, responsePromise} = await createLiveSession(ai, {model, config, streamHandler});

        // Clean up session on client disconnect
        req.on('close', () => { try { session.close(); } catch {} });

        // Convert and send messages
        const turns = convertToLiveAPITurns(messages);
        session.sendClientContent({turns: turns, turnComplete: true});

        // Wait for response with timeout
        const timeout = setTimeout(() => { try { session.close(); } catch {} }, REQUEST_TIMEOUT_MS);
        let result;
        try {
            result = await responsePromise;
        } finally {
            clearTimeout(timeout);
        }

        // Close the session
        session.close();

        // Send response (non-streaming only; streaming is handled by streamHandler)
        if (!stream) {
            if (includeAudio && result.audioChunks.length > 0) {
                const audioBase64 = combineAudioChunks(result.audioChunks, audioFormat);
                const response = formatAudioResponse(result.transcript, audioBase64, model, requestId);
                res.json(response);
            } else {
                const response = formatTextResponse(result.transcript, model, requestId);
                res.json(response);
            }
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
