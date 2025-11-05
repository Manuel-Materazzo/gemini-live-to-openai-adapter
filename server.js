import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {GoogleGenAI} from '@google/genai';
import dotenv from 'dotenv';
import {handleChatCompletions} from './handlers.js';
import {DEFAULT_PORT, SERVICE_NAME} from './config.js';

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || DEFAULT_PORT;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY environment variable not set');
    process.exit(1);
}

const ai = new GoogleGenAI({apiKey: GEMINI_API_KEY});

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', (req, res) => handleChatCompletions(ai, req, res));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({status: 'ok', service: SERVICE_NAME});
});

app.listen(PORT, () => {
    console.log(`\n🚀 ${SERVICE_NAME} running on http://localhost:${PORT}`);
    console.log(`\nEndpoints:`);
    console.log(`  POST http://localhost:${PORT}/v1/chat/completions`);
    console.log(`  GET  http://localhost:${PORT}/health`);
    console.log(`\nSet your OpenAI base URL to: http://localhost:${PORT}/v1`);
});
