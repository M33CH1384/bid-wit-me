/**
 * Tiny local TURN server for automated WebRTC tests (node-turn). This box's Chrome is locked to
 * WebRtcIPHandling=default_public_interface_only (no host candidates) and has no UDP route to public STUN,
 * so two headless contexts can only meet through a relay — which also exercises the TURN config hook.
 * Usage: node scripts/turn-local.mjs [listenIp=auto] [port=3478]
 */
import Turn from 'node-turn';
import { networkInterfaces } from 'node:os';

const ip = process.argv[2] ?? Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address ?? '127.0.0.1';
const port = Number(process.argv[3] ?? 3478);
const server = new Turn({ listeningPort: port, listeningIps: [ip], relayIps: [ip], authMech: 'long-term', credentials: { bwm: 'test' }, realm: 'bwm', debugLevel: 'ERROR' });
server.start();
console.log(JSON.stringify([{ urls: `turn:${ip}:${port}?transport=udp`, username: 'bwm', credential: 'test' }]));
