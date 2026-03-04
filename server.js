import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {handleChatCompletions} from './handlers.js';
import {ipRestrictionMiddleware} from './utils.js';
import {DEFAULT_PORT, SERVICE_NAME, ALLOWED_IPS, TRUSTED_PROXY_IPS, REVERSE_PROXY_MODE} from './config.js';

const app = express();
if (REVERSE_PROXY_MODE && TRUSTED_PROXY_IPS.length > 0) {
    app.set('trust proxy', TRUSTED_PROXY_IPS);
}
app.use(helmet());
app.use(cors({origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : false}));
app.use(express.json({limit: process.env.JSON_LIMIT || '256kb'}));
app.use(ipRestrictionMiddleware);

const PORT = process.env.PORT || DEFAULT_PORT;

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', (req, res) => handleChatCompletions(req, res));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({status: 'ok', service: SERVICE_NAME});
});

const server = app.listen(PORT, () => {
    console.log(`\n🚀 ${SERVICE_NAME} running on http://localhost:${PORT}`);
    console.log(`\n🖇️Endpoints:`);
    console.log(`  POST http://localhost:${PORT}/v1/chat/completions`);
    console.log(`  GET  http://localhost:${PORT}/health`);
    console.log(`\n🔗 OpenAI base URL: http://localhost:${PORT}/v1`);

    // Log IP restrictions
    if (ALLOWED_IPS.length > 0) {
        console.log(`\n🔒 IP Restrictions Enabled:`);
        console.log(`  Allowed IPs: ${ALLOWED_IPS.join(', ')}`);
        if (REVERSE_PROXY_MODE) {
            console.log(`  Reverse Proxy Mode: Enabled`);
            console.log(`  Trusted Proxy IPs: ${TRUSTED_PROXY_IPS.length > 0 ? TRUSTED_PROXY_IPS.join(', ') : 'None'}`);
        } else {
            console.log(`  Reverse Proxy Mode: Disabled`);
        }
    } else {
        console.log(`\n🔓 No IP restrictions (open access)`);
    }
});

function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
    setTimeout(() => {
        console.error('Forced shutdown after timeout.');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
