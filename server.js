import express from 'express';
import { GoogleGenAI, Modality } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY environment variable not set');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Convert OpenAI messages to Live API turns
function convertToLiveAPITurns(messages) {
  return messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : msg.role,
    parts: [{ text: msg.content }]
  }));
}

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, model = 'gemini-live-2.5-flash-preview', stream = false, temperature, max_tokens } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: {
          message: 'Invalid request: messages must be an array',
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
                  delta: { content: message.text },
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

    // Send the last user message (or all for context if needed)
    const lastUserMessage = turns[turns.length - 1];
    session.sendClientContent({ turns: lastUserMessage, turnComplete: true });

    // Wait for complete response
    const completeResponse = await responsePromise;

    // Close the session (stateless approach)
    session.close();

    // Send response in OpenAI format
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
    console.error('Error:', error);

    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: error.message || 'Internal server error',
          type: 'server_error'
        }
      });
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gemini-live-openai-adapter' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Gemini Live API → OpenAI Adapter running on http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST http://localhost:${PORT}/v1/chat/completions`);
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`\nSet your OpenAI base URL to: http://localhost:${PORT}/v1`);
});
