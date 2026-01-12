const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 8080;

// Current state to sync new connections
let currentState = {
    text: '',
    speed: 150,
    fontSize: 48,
    segmentLength: 10 * 60,
    segmentMinutes: 10,
    segmentSeconds: 0,
    isPlaying: false,
    isPaused: false,
    currentPosition: 0,
    startTime: null,
    pausedTime: 0,
    mirrorMode: false,
    hideTimer: false,
    onAir: false,
    scheduledStartTime: null
};

// Polling Support for Legacy Devices
const pollingClients = new Map();
const eventQueues = new Map();
let eventIdCounter = 0;

function queueEventForClient(clientId, data) {
    eventIdCounter++;
    const event = {
        id: eventIdCounter,
        data: data,
        timestamp: Date.now()
    };
    
    const queue = eventQueues.get(clientId) || [];
    queue.push(event);
    
    if (queue.length > 100) {
        queue.shift();
    }
    
    eventQueues.set(clientId, queue);
}

function broadcastToPollingDisplays(data) {
    pollingClients.forEach((client, clientId) => {
        if (client.role === 'display') {
            queueEventForClient(clientId, data);
        }
    });
}

function broadcastToPollingControllers(data) {
    pollingClients.forEach((client, clientId) => {
        if (client.role === 'controller') {
            queueEventForClient(clientId, data);
        }
    });
}

function cleanupStalePollingClients() {
    const staleThreshold = 60000;
    const now = Date.now();
    
    pollingClients.forEach((client, clientId) => {
        if (now - client.lastPoll > staleThreshold) {
            pollingClients.delete(clientId);
            eventQueues.delete(clientId);
            console.log('Removed stale polling client:', clientId);
            broadcastConnectionCount();
        }
    });
}

setInterval(cleanupStalePollingClients, 30000);

function parseJSONBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > 1048576) {
                reject(new Error('Body too large'));
            }
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

function parseQuery(url) {
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) return {};
    
    const queryString = url.slice(queryIndex + 1);
    const params = {};
    
    queryString.split('&').forEach(pair => {
        const [key, value] = pair.split('=');
        params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    });
    
    return params;
}

function handlePollingAPI(req, res, urlPath) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return true;
    }
    
    if (urlPath === '/api/state' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(currentState), 'utf-8');
        return true;
    }
    
    if (urlPath === '/api/register' && req.method === 'POST') {
        parseJSONBody(req)
            .then(data => {
                const { role, clientId } = data;
                
                if (!clientId || !role) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing clientId or role' }));
                    return;
                }
                
                pollingClients.set(clientId, {
                    role: role,
                    registeredAt: Date.now(),
                    lastPoll: Date.now()
                });
                
                eventQueues.set(clientId, []);
                
                queueEventForClient(clientId, {
                    type: 'stateSync',
                    state: currentState
                });
                
                console.log(`Polling ${role} registered: ${clientId}`);
                broadcastConnectionCount();
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, clientId: clientId }));
            })
            .catch(err => {
                console.error('Register error:', err);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request' }));
            });
        return true;
    }
    
    if (urlPath.startsWith('/api/poll') && req.method === 'GET') {
        const query = parseQuery(req.url);
        const clientId = query.clientId;
        const lastEventId = parseInt(query.lastEventId) || 0;
        
        if (!clientId || !pollingClients.has(clientId)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Client not registered' }));
            return true;
        }
        
        const client = pollingClients.get(clientId);
        client.lastPoll = Date.now();
        
        const clientEvents = eventQueues.get(clientId) || [];
        const newEvents = clientEvents.filter(e => e.id > lastEventId);
        
        eventQueues.set(clientId, clientEvents.filter(e => e.id > lastEventId));
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            events: newEvents,
            timestamp: Date.now()
        }));
        return true;
    }
    
    if (urlPath === '/api/send' && req.method === 'POST') {
        parseJSONBody(req)
            .then(data => {
                const { clientId, message } = data;
                
                if (!clientId || !pollingClients.has(clientId)) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Client not registered' }));
                    return;
                }
                
                const client = pollingClients.get(clientId);
                client.lastPoll = Date.now();
                
                handleClientMessage(message, client.role, null);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            })
            .catch(err => {
                console.error('Send error:', err);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request' }));
            });
        return true;
    }
    
    if (urlPath === '/api/unregister' && req.method === 'POST') {
        parseJSONBody(req)
            .then(data => {
                const { clientId } = data;
                
                if (clientId && pollingClients.has(clientId)) {
                    pollingClients.delete(clientId);
                    eventQueues.delete(clientId);
                    console.log('Polling client unregistered:', clientId);
                    broadcastConnectionCount();
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            })
            .catch(err => {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request' }));
            });
        return true;
    }
    
    return false;
}

function handleClientMessage(data, role, senderWs) {
    switch (data.type) {
        case 'setText':
            currentState.text = data.content;
            broadcastToDisplays({ type: 'setText', content: data.content });
            broadcastToControllers({ type: 'setText', content: data.content }, senderWs);
            break;
            
        case 'setSpeed':
            currentState.speed = data.value;
            broadcastToDisplays({ type: 'setSpeed', value: data.value });
            broadcastToControllers({ type: 'setSpeed', value: data.value }, senderWs);
            break;
            
        case 'setFontSize':
            currentState.fontSize = data.value;
            broadcastToDisplays({ type: 'setFontSize', value: data.value });
            broadcastToControllers({ type: 'setFontSize', value: data.value }, senderWs);
            break;
            
        case 'setSegmentLength':
            currentState.segmentLength = data.totalSeconds || data.value || 10 * 60;
            currentState.segmentMinutes = data.minutes || Math.floor(currentState.segmentLength / 60);
            currentState.segmentSeconds = data.seconds || (currentState.segmentLength % 60);
            const segmentMsg = { 
                type: 'setSegmentLength', 
                totalSeconds: currentState.segmentLength,
                minutes: currentState.segmentMinutes,
                seconds: currentState.segmentSeconds
            };
            broadcastToDisplays(segmentMsg);
            broadcastToControllers(segmentMsg, senderWs);
            break;
            
        case 'setMirrorMode':
            currentState.mirrorMode = data.enabled;
            broadcastToDisplays({ type: 'setMirrorMode', enabled: data.enabled });
            broadcastToControllers({ type: 'setMirrorMode', enabled: data.enabled }, senderWs);
            break;
            
        case 'setHideTimer':
            currentState.hideTimer = data.enabled;
            broadcastToDisplays({ type: 'setHideTimer', enabled: data.enabled });
            broadcastToControllers({ type: 'setHideTimer', enabled: data.enabled }, senderWs);
            break;
            
        case 'setOnAir':
            currentState.onAir = data.enabled;
            broadcastToDisplays({ type: 'setOnAir', enabled: data.enabled });
            broadcastToControllers({ type: 'setOnAir', enabled: data.enabled }, senderWs);
            break;
            
        case 'setScheduledStart':
            currentState.scheduledStartTime = data.scheduledTime;
            broadcastToDisplays({ type: 'setScheduledStart', scheduledTime: data.scheduledTime });
            broadcastToControllers({ type: 'setScheduledStart', scheduledTime: data.scheduledTime }, senderWs);
            break;
            
        case 'clearScheduledStart':
            currentState.scheduledStartTime = null;
            broadcastToDisplays({ type: 'clearScheduledStart' });
            broadcastToControllers({ type: 'clearScheduledStart' }, senderWs);
            break;
            
        case 'start':
            currentState.isPlaying = true;
            currentState.isPaused = false;
            currentState.onAir = true;
            currentState.scheduledStartTime = null;
            currentState.startTime = Date.now() - (currentState.pausedTime || 0);
            const startMsg = { 
                type: 'start', 
                startTime: currentState.startTime,
                pausedTime: currentState.pausedTime
            };
            broadcastToDisplays(startMsg);
            broadcastToDisplays({ type: 'setOnAir', enabled: true });
            broadcastToDisplays({ type: 'clearScheduledStart' });
            broadcastToControllers(startMsg, senderWs);
            broadcastToControllers({ type: 'setOnAir', enabled: true }, senderWs);
            broadcastToControllers({ type: 'clearScheduledStart' }, senderWs);
            break;
            
        case 'pause':
            currentState.isPlaying = false;
            currentState.isPaused = true;
            currentState.pausedTime = Date.now() - currentState.startTime;
            const pauseMsg = { 
                type: 'pause',
                pausedTime: currentState.pausedTime
            };
            broadcastToDisplays(pauseMsg);
            broadcastToControllers(pauseMsg, senderWs);
            break;
            
        case 'reset':
            currentState.isPlaying = false;
            currentState.isPaused = false;
            currentState.currentPosition = 0;
            currentState.startTime = null;
            currentState.pausedTime = 0;
            broadcastToDisplays({ type: 'reset' });
            broadcastToControllers({ type: 'reset' }, senderWs);
            break;
        
        // Scroll Control Messages (displays only, controllers don't need these)
        case 'scrollUp':
            broadcastToDisplays({ type: 'scrollUp', pixels: data.pixels || 100 });
            break;
            
        case 'scrollDown':
            broadcastToDisplays({ type: 'scrollDown', pixels: data.pixels || 100 });
            break;
            
        case 'nextParagraph':
            broadcastToDisplays({ type: 'nextParagraph' });
            break;
            
        case 'prevParagraph':
            broadcastToDisplays({ type: 'prevParagraph' });
            break;
            
        case 'goToParagraph':
            broadcastToDisplays({ type: 'goToParagraph', index: data.index || 0 });
            break;
            
        case 'setScrollPosition':
            currentState.currentPosition = data.position || 0;
            broadcastToDisplays({ type: 'setScrollPosition', position: data.position || 0 });
            break;
            
        default:
            console.log('Unknown message type:', data.type);
    }
}

// HTTP Server
const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    
    if (urlPath.startsWith('/api/')) {
        if (handlePollingAPI(req, res, urlPath)) {
            return;
        }
    }
    
    let filePath = path.join(__dirname, req.url === '/' ? 'controller.html' : urlPath);
    
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    
    const extname = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml'
    };
    
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// WebSocket Server
const wss = new WebSocket.Server({ server });

const clients = {
    controllers: new Set(),
    displays: new Set()
};

wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            
            if (data.type === 'register') {
                handleRegistration(ws, data);
            } else if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            } else {
                handleClientMessage(data, ws.role, ws);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });
    
    ws.on('close', () => {
        clients.controllers.delete(ws);
        clients.displays.delete(ws);
        console.log('WebSocket connection closed');
        broadcastConnectionCount();
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

function handleRegistration(ws, data) {
    ws.role = data.role;
    
    if (data.role === 'controller') {
        clients.controllers.add(ws);
        console.log('WebSocket Controller registered');
        ws.send(JSON.stringify({ type: 'stateSync', state: currentState }));
    } else if (data.role === 'display') {
        clients.displays.add(ws);
        console.log('WebSocket Display registered');
        ws.send(JSON.stringify({ type: 'stateSync', state: currentState }));
    }
    
    broadcastConnectionCount();
}

function broadcastToDisplays(message) {
    const messageStr = JSON.stringify(message);
    
    clients.displays.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    });
    
    broadcastToPollingDisplays(message);
}

function broadcastToControllers(message, excludeWs) {
    const messageStr = JSON.stringify(message);
    
    // Exclude sender to prevent echo
    clients.controllers.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
            client.send(messageStr);
        }
    });
    
    broadcastToPollingControllers(message);
}

function broadcastConnectionCount() {
    let controllerCount = clients.controllers.size;
    let displayCount = clients.displays.size;
    
    pollingClients.forEach(client => {
        if (client.role === 'controller') controllerCount++;
        if (client.role === 'display') displayCount++;
    });
    
    const connectionInfo = {
        type: 'connectionCount',
        controllers: controllerCount,
        displays: displayCount
    };
    
    const messageStr = JSON.stringify(connectionInfo);
    [...clients.controllers, ...clients.displays].forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    });
    
    pollingClients.forEach((client, clientId) => {
        queueEventForClient(clientId, connectionInfo);
    });
}

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Controller: http://localhost:${PORT}/controller.html`);
    console.log(`Display: http://localhost:${PORT}/display.html`);
    console.log(`Legacy Display: http://localhost:${PORT}/display_legacy.html`);
});

process.on('SIGINT', () => {
    console.log('Shutting down...');
    wss.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});

module.exports = { server, wss };