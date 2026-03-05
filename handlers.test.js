import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {GoogleGenAI, Modality} from '@google/genai';
import {convertToLiveAPITurns, validateChatRequest, buildWavHeader, wantsAudioOutput, calculateTokenUsage} from './utils.js';
import {DEFAULT_MODEL} from './config.js';

// Mock modules
vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn(),
    Modality: {AUDIO: 'AUDIO'}
}));

vi.mock('./utils.js', () => ({
    convertToLiveAPITurns: vi.fn(),
    validateChatRequest: vi.fn(),
    buildWavHeader: vi.fn(),
    wantsAudioOutput: vi.fn(),
    calculateTokenUsage: vi.fn()
}));

vi.mock('./config.js', () => ({
    DEFAULT_MODEL: 'gemini-2.5-flash-native-audio-preview-12-2025'
}));

// Import handler after mocks are set up
const {handleChatCompletions} = await import('./handlers.js');

function createMockRes() {
    return {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        flushHeaders: vi.fn(),
        headersSent: false,
        writableEnded: false,
        destroyed: false
    };
}

function createMockReq(overrides = {}) {
    return {
        headers: {authorization: 'Bearer test-key'},
        body: {
            messages: [{role: 'user', content: 'Hello'}],
            model: 'gemini-2.5-flash-native-audio-preview-12-2025'
        },
        on: vi.fn(),
        ...overrides
    };
}

let mockSession;
let mockConnect;
let capturedCallbacks;

function setupDefaultMocks(messageOverrides) {
    mockSession = {sendClientContent: vi.fn(), close: vi.fn()};
    capturedCallbacks = null;

    mockConnect = vi.fn(async ({callbacks}) => {
        capturedCallbacks = callbacks;
        setTimeout(() => {
            callbacks.onopen();
            if (messageOverrides) {
                messageOverrides(callbacks);
            } else {
                callbacks.onmessage({
                    serverContent: {
                        outputTranscription: {text: 'Hello'},
                        turnComplete: true
                    }
                });
            }
        }, 0);
        return mockSession;
    });

    GoogleGenAI.mockImplementation(function () {
        this.live = {connect: mockConnect};
    });

    validateChatRequest.mockReturnValue({isValid: true});
    convertToLiveAPITurns.mockReturnValue([{role: 'user', parts: [{text: 'Hello'}]}]);
    wantsAudioOutput.mockReturnValue(false);
    buildWavHeader.mockReturnValue(Buffer.alloc(44));
    calculateTokenUsage.mockResolvedValue({prompt_tokens: 10, completion_tokens: 5, total_tokens: 15});
}

describe('handleChatCompletions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupDefaultMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Authentication', () => {
        it('should return 401 when authorization header is missing', async () => {
            const req = createMockReq({headers: {}});
            const res = createMockRes();

            await handleChatCompletions(req, res);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({
                error: {
                    message: 'Authorization header with Bearer token required',
                    type: 'authentication_error'
                }
            });
        });

        it('should return 401 when authorization header does not start with Bearer', async () => {
            const req = createMockReq({headers: {authorization: 'Basic abc123'}});
            const res = createMockRes();

            await handleChatCompletions(req, res);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({
                error: {
                    message: 'Authorization header with Bearer token required',
                    type: 'authentication_error'
                }
            });
        });
    });

    describe('Validation', () => {
        it('should return 400 when request body is invalid', async () => {
            validateChatRequest.mockReturnValue({isValid: false, error: 'messages must be a non-empty array'});

            const req = createMockReq({body: {messages: []}});
            const res = createMockRes();

            await handleChatCompletions(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: {
                    message: 'messages must be a non-empty array',
                    type: 'invalid_request_error'
                }
            });
        });
    });

    describe('Non-streaming text response', () => {
        it('should return a chat.completion object with text content', async () => {
            const req = createMockReq();
            const res = createMockRes();

            await handleChatCompletions(req, res);

            expect(res.json).toHaveBeenCalledTimes(1);
            const response = res.json.mock.calls[0][0];

            expect(response.object).toBe('chat.completion');
            expect(response.id).toMatch(/^chatcmpl-/);
            expect(response.model).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
            expect(response.choices).toHaveLength(1);
            expect(response.choices[0].index).toBe(0);
            expect(response.choices[0].message.role).toBe('assistant');
            expect(response.choices[0].message.content).toBe('Hello');
            expect(response.choices[0].finish_reason).toBe('stop');
            expect(response.usage).toEqual({prompt_tokens: 10, completion_tokens: 5, total_tokens: 15});
        });

        it('should pass the API key from the Bearer token to GoogleGenAI', async () => {
            const req = createMockReq({headers: {authorization: 'Bearer my-secret-key'}});
            const res = createMockRes();

            await handleChatCompletions(req, res);

            expect(GoogleGenAI).toHaveBeenCalledWith({apiKey: 'my-secret-key'});
        });

        it('should send converted turns to the session', async () => {
            const turns = [{role: 'user', parts: [{text: 'Hello'}]}];
            convertToLiveAPITurns.mockReturnValue(turns);

            const req = createMockReq();
            const res = createMockRes();

            await handleChatCompletions(req, res);

            expect(mockSession.sendClientContent).toHaveBeenCalledWith({turns, turnComplete: true});
        });

        it('should call calculateTokenUsage with correct parameters', async () => {
            const req = createMockReq();
            const res = createMockRes();

            await handleChatCompletions(req, res);

            expect(calculateTokenUsage).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                    messages: [{role: 'user', content: 'Hello'}],
                    completionText: 'Hello'
                })
            );
        });
    });

    describe('Non-streaming audio response', () => {
        it('should return audio response with data and transcript', async () => {
            wantsAudioOutput.mockReturnValue(true);

            setupDefaultMocks((callbacks) => {
                callbacks.onmessage({
                    serverContent: {
                        modelTurn: {parts: [{inlineData: {data: 'base64audio'}}]}
                    }
                });
                callbacks.onmessage({
                    serverContent: {
                        outputTranscription: {text: 'transcript'}
                    }
                });
                callbacks.onmessage({
                    serverContent: {turnComplete: true}
                });
            });
            wantsAudioOutput.mockReturnValue(true);

            const req = createMockReq({
                body: {
                    messages: [{role: 'user', content: 'Hello'}],
                    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                    modalities: ['audio'],
                    audio: {format: 'wav'}
                }
            });
            const res = createMockRes();

            await handleChatCompletions(req, res);

            expect(res.json).toHaveBeenCalledTimes(1);
            const response = res.json.mock.calls[0][0];

            expect(response.object).toBe('chat.completion');
            expect(response.choices[0].message.role).toBe('assistant');
            expect(response.choices[0].message.content).toBeNull();
            expect(response.choices[0].message.audio).toBeDefined();
            expect(response.choices[0].message.audio.data).toBeDefined();
            expect(response.choices[0].message.audio.transcript).toBe('transcript');
            expect(response.choices[0].finish_reason).toBe('stop');
            expect(response.usage).toEqual({prompt_tokens: 10, completion_tokens: 5, total_tokens: 15});
        });

        it('should fall back to text response when no audio chunks received', async () => {
            wantsAudioOutput.mockReturnValue(true);

            setupDefaultMocks((callbacks) => {
                callbacks.onmessage({
                    serverContent: {
                        outputTranscription: {text: 'text only'}
                    }
                });
                callbacks.onmessage({
                    serverContent: {turnComplete: true}
                });
            });
            wantsAudioOutput.mockReturnValue(true);

            const req = createMockReq({
                body: {
                    messages: [{role: 'user', content: 'Hello'}],
                    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                    modalities: ['audio']
                }
            });
            const res = createMockRes();

            await handleChatCompletions(req, res);

            const response = res.json.mock.calls[0][0];
            expect(response.choices[0].message.content).toBe('text only');
            expect(response.choices[0].message.audio).toBeUndefined();
        });

        it('should use pcm16 format when specified', async () => {
            wantsAudioOutput.mockReturnValue(true);

            setupDefaultMocks((callbacks) => {
                callbacks.onmessage({
                    serverContent: {
                        modelTurn: {parts: [{inlineData: {data: 'base64audio'}}]}
                    }
                });
                callbacks.onmessage({
                    serverContent: {
                        outputTranscription: {text: 'transcript'}
                    }
                });
                callbacks.onmessage({
                    serverContent: {turnComplete: true}
                });
            });
            wantsAudioOutput.mockReturnValue(true);

            const req = createMockReq({
                body: {
                    messages: [{role: 'user', content: 'Hello'}],
                    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                    modalities: ['audio'],
                    audio: {format: 'pcm16'}
                }
            });
            const res = createMockRes();

            await handleChatCompletions(req, res);

            const response = res.json.mock.calls[0][0];
            expect(response.choices[0].message.audio.data).toBeDefined();
            // pcm16 format should not use WAV header
            expect(buildWavHeader).not.toHaveBeenCalled();
        });
    });

    describe('Streaming text response', () => {
        it('should set SSE headers and write chunks', async () => {
            const req = createMockReq({
                body: {
                    messages: [{role: 'user', content: 'Hello'}],
                    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                    stream: true
                }
            });
            const res = createMockRes();

            await handleChatCompletions(req, res);

            // Verify SSE headers
            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
            expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
            expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
            expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.flushHeaders).toHaveBeenCalled();

            // Verify data chunks were written
            const writeCalls = res.write.mock.calls.map(c => c[0]);

            // Should have initial chunk with role
            const initialChunk = writeCalls.find(c => c.includes('"role":"assistant"'));
            expect(initialChunk).toBeDefined();

            // Should have content chunk with transcript
            const contentChunk = writeCalls.find(c => c.includes('"content":"Hello"'));
            expect(contentChunk).toBeDefined();

            // Should have final chunk with finish_reason 'stop'
            const finalChunk = writeCalls.find(c => c.includes('"finish_reason":"stop"'));
            expect(finalChunk).toBeDefined();

            // Should end with [DONE]
            const doneChunk = writeCalls.find(c => c.includes('[DONE]'));
            expect(doneChunk).toBe('data: [DONE]\n\n');

            // Should call res.end()
            expect(res.end).toHaveBeenCalled();
        });

        it('should include usage in the final stream chunk', async () => {
            const req = createMockReq({
                body: {
                    messages: [{role: 'user', content: 'Hello'}],
                    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                    stream: true
                }
            });
            const res = createMockRes();

            await handleChatCompletions(req, res);

            const writeCalls = res.write.mock.calls.map(c => c[0]);
            const finalChunk = writeCalls.find(c => c.includes('"finish_reason":"stop"'));
            const parsed = JSON.parse(finalChunk.replace('data: ', '').trim());
            expect(parsed.usage).toEqual({prompt_tokens: 10, completion_tokens: 5, total_tokens: 15});
        });
    });

    describe('Streaming audio response', () => {
        it('should stream audio data chunks in SSE format', async () => {
            wantsAudioOutput.mockReturnValue(true);

            setupDefaultMocks((callbacks) => {
                callbacks.onmessage({
                    serverContent: {
                        modelTurn: {parts: [{inlineData: {data: 'audiodata1'}}]}
                    }
                });
                callbacks.onmessage({
                    serverContent: {
                        outputTranscription: {text: 'streamed transcript'}
                    }
                });
                callbacks.onmessage({
                    serverContent: {turnComplete: true}
                });
            });
            wantsAudioOutput.mockReturnValue(true);

            const req = createMockReq({
                body: {
                    messages: [{role: 'user', content: 'Hello'}],
                    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                    stream: true,
                    modalities: ['audio']
                }
            });
            const res = createMockRes();

            await handleChatCompletions(req, res);

            const writeCalls = res.write.mock.calls.map(c => c[0]);

            // Should have audio data chunk
            const audioChunk = writeCalls.find(c => c.includes('"audio"') && c.includes('"data":"audiodata1"'));
            expect(audioChunk).toBeDefined();

            // Should have transcript chunk
            const transcriptChunk = writeCalls.find(c => c.includes('"transcript":"streamed transcript"'));
            expect(transcriptChunk).toBeDefined();

            // Should end with [DONE]
            expect(writeCalls.find(c => c.includes('[DONE]'))).toBeDefined();
            expect(res.end).toHaveBeenCalled();
        });
    });

    describe('Error handling', () => {
        it('should return 500 when Live API connection fails', async () => {
            GoogleGenAI.mockImplementation(function () {
                this.live = {
                    connect: vi.fn().mockRejectedValue(new Error('Connection failed'))
                };
            });

            const req = createMockReq();
            const res = createMockRes();

            await handleChatCompletions(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: {
                    message: 'Connection failed',
                    type: 'server_error'
                }
            });
        });

        it('should return 500 when Live API emits an error via onerror callback', async () => {
            GoogleGenAI.mockImplementation(function () {
                this.live = {
                    connect: vi.fn(async ({callbacks}) => {
                        setTimeout(() => {
                            callbacks.onopen();
                            callbacks.onerror({message: 'Live API error'});
                        }, 0);
                        return mockSession;
                    })
                };
            });

            const req = createMockReq();
            const res = createMockRes();

            await handleChatCompletions(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: {
                    message: 'Live API error',
                    type: 'server_error'
                }
            });
        });

        it('should send error in SSE format when streaming and headers already sent', async () => {
            GoogleGenAI.mockImplementation(function () {
                this.live = {
                    connect: vi.fn(async ({callbacks}) => {
                        setTimeout(() => {
                            callbacks.onopen();
                            callbacks.onerror({message: 'Stream error'});
                        }, 0);
                        return mockSession;
                    })
                };
            });

            const req = createMockReq({
                body: {
                    messages: [{role: 'user', content: 'Hello'}],
                    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                    stream: true
                }
            });
            const res = createMockRes();
            res.flushHeaders.mockImplementation(() => {
                res.headersSent = true;
            });

            await handleChatCompletions(req, res);

            const writeCalls = res.write.mock.calls.map(c => c[0]);

            // Should write error in SSE format
            const errorChunk = writeCalls.find(c => c.includes('"error"') && c.includes('Stream error'));
            expect(errorChunk).toBeDefined();

            // Should send [DONE] after error
            const doneChunk = writeCalls.find(c => c.includes('[DONE]'));
            expect(doneChunk).toBeDefined();

            expect(res.end).toHaveBeenCalled();
        });

        it('should return 500 when connection closes unexpectedly via onclose', async () => {
            GoogleGenAI.mockImplementation(function () {
                this.live = {
                    connect: vi.fn(async ({callbacks}) => {
                        setTimeout(() => {
                            callbacks.onopen();
                            callbacks.onclose({reason: 'Unexpected disconnect'});
                        }, 0);
                        return mockSession;
                    })
                };
            });

            const req = createMockReq();
            const res = createMockRes();

            await handleChatCompletions(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: {
                    message: 'Unexpected disconnect',
                    type: 'server_error'
                }
            });
        });
    });

    describe('Timeout', () => {
        it('should close the session when timeout triggers', async () => {
            vi.useFakeTimers();

            let storedCallbacks;
            mockSession = {
                sendClientContent: vi.fn(),
                close: vi.fn(function () {
                    // Simulate connection closing when session.close() is called
                    storedCallbacks?.onclose({reason: 'Session closed by timeout'});
                })
            };

            GoogleGenAI.mockImplementation(function () {
                this.live = {
                    connect: vi.fn(async ({callbacks}) => {
                        storedCallbacks = callbacks;
                        callbacks.onopen();
                        // Never send turnComplete — should timeout
                        return mockSession;
                    })
                };
            });

            const req = createMockReq();
            const res = createMockRes();

            const promise = handleChatCompletions(req, res);

            // Advance past the timeout (default 60s)
            await vi.advanceTimersByTimeAsync(61000);

            await promise;

            expect(mockSession.close).toHaveBeenCalled();
        });
    });

    describe('Client disconnect', () => {
        it('should register a close handler on req and close session on disconnect', async () => {
            const req = createMockReq();
            const res = createMockRes();

            await handleChatCompletions(req, res);

            // Verify req.on('close', ...) was registered
            expect(req.on).toHaveBeenCalledWith('close', expect.any(Function));

            // Simulate client disconnect by calling the registered handler
            const closeHandler = req.on.mock.calls.find(c => c[0] === 'close')[1];
            closeHandler();

            // Session should be closed (may have been closed already by normal completion)
            expect(mockSession.close).toHaveBeenCalled();
        });
    });

    describe('Session configuration', () => {
        it('should pass temperature and max_tokens to session config', async () => {
            const req = createMockReq({
                body: {
                    messages: [{role: 'user', content: 'Hello'}],
                    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                    temperature: 0.7,
                    max_tokens: 100
                }
            });
            const res = createMockRes();

            await handleChatCompletions(req, res);

            const config = mockConnect.mock.calls[0][0].config;

            expect(config.generationConfig.temperature).toBe(0.7);
            expect(config.generationConfig.maxOutputTokens).toBe(100);
        });

        it('should pass voice configuration to session config', async () => {
            const req = createMockReq({
                body: {
                    messages: [{role: 'user', content: 'Hello'}],
                    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                    audio: {voice: 'Puck'}
                }
            });
            const res = createMockRes();

            await handleChatCompletions(req, res);

            const config = mockConnect.mock.calls[0][0].config;

            expect(config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Puck');
        });

        it('should use the default model when none is specified', async () => {
            const req = createMockReq({
                body: {
                    messages: [{role: 'user', content: 'Hello'}]
                }
            });
            const res = createMockRes();

            await handleChatCompletions(req, res);

            expect(mockConnect.mock.calls[0][0].model).toBe(DEFAULT_MODEL);
        });
    });
});
