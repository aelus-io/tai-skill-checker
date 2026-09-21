import 'dotenv/config'
import { fileURLToPath } from 'node:url'
import { cli, ServerOptions } from '@livekit/agents'
import { loadConfig } from './config/index.js'

const config = loadConfig()
if (!config.livekitUrl || !config.livekitApiKey || !config.livekitApiSecret) throw new Error('LiveKit configuration is required')
cli.runApp(new ServerOptions({ agent: fileURLToPath(new URL('./agent.js', import.meta.url)), agentName: config.livekitAgentName, wsURL: config.livekitUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:'), apiKey: config.livekitApiKey, apiSecret: config.livekitApiSecret }))
