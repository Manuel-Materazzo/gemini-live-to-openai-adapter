import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import {handleChatCompletions} from './handlers.js';
import {ipRestrictionMiddleware} from './utils.js';
import {DEFAULT_PORT, SERVICE_NAME, ALLOWED_IPS, TRUSTED_PROXY_IPS, REVERSE_PROXY_MODE} from './config.js';

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(ipRestrictionMiddleware);

const PORT = process.env.PORT || DEFAULT_PORT;

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', (req, res) => handleChatCompletions(req, res));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({status: 'ok', service: SERVICE_NAME});
});

app.listen(PORT, () => {
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
