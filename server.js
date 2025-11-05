import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import {handleChatCompletions} from './handlers.js';
import {DEFAULT_PORT, SERVICE_NAME} from './config.js';

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || DEFAULT_PORT;

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', (req, res) => handleChatCompletions(req, res));

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
