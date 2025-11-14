const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Configuration
const CONFIG = {
    APP_ID: 1089,
    MARKET: "1HZ100V",
    BARRIER_UPPER: 2.0,
    BARRIER_LOWER: 0.9,
    TICKS_FOR_TRADE: 5,
    COOLDOWN_MS: 20000 // 20 seconds cooldown between signals
};

// Message Types Constants
const MSG_TYPES = {
    TICK: 'tick',
    SIGNAL: 'SIGNAL',
    TRADE_RESULT: 'TRADE_RESULT'
};

// Application State
const state = {
    prices: [],
    lastDigits: [],
    tradeQueue: [],
    lastSignalTime: 0,
    clients: new Set()
};
// WebSocket connection to Deriv
const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${CONFIG.APP_ID}`);

ws.on('open', () => {
    console.log('Connected to Deriv WebSocket');
    ws.send(JSON.stringify({ 
        ticks: CONFIG.MARKET,
        subscribe: 1 
    }));
});

ws.on('message', (data) => {
    try {
        const message = JSON.parse(data);
        if (message.msg_type === MSG_TYPES.TICK) {
            processTick(message.tick);
        }
    } catch (error) {
        console.error('Error processing message:', error);
    }
});

/**
 * Updates the history of prices and last digits.
 * @param {number} price The current tick price.
 */
function updatePriceHistory(price) {
    // Keep only the last 1000 prices
    state.prices.push(price);
    if (state.prices.length > 1000) state.prices.shift();

    // Track last digit of price
    const lastDigit = parseInt(price.toFixed(2).slice(-1));
    state.lastDigits.push(lastDigit);
    if (state.lastDigits.length > 1000) state.lastDigits.shift();
}

/**
 * Checks for the signal pattern and creates a new trade if found.
 * @param {number} price The current tick price.
 */
function checkForSignal(price) {
    const { lastDigits, lastSignalTime } = state;
    const currentTime = Date.now();

    const hasDoubleDigitPattern = lastDigits.length >= 2 && lastDigits[lastDigits.length - 1] === lastDigits[lastDigits.length - 2];
    const isCooldownOver = currentTime - lastSignalTime >= CONFIG.COOLDOWN_MS;

    if (hasDoubleDigitPattern && isCooldownOver) {
        const pattern = [lastDigits[lastDigits.length - 2], lastDigits[lastDigits.length - 1]];
        
        // Add new trade to the queue
        state.tradeQueue.push({
            startPrice: price,
            collected: [],
            pattern: pattern,
            timestamp: currentTime
        });

        state.lastSignalTime = currentTime;

        // Notify clients about the new signal
        const signal = {
            type: MSG_TYPES.SIGNAL,
            price: price,
            time: new Date().toISOString(),
            pattern: pattern
        };
        broadcast(JSON.stringify(signal));
        console.log('New signal detected:', signal);
    }
}

/**
 * Processes each trade in the queue, collecting ticks and evaluating results.
 * @param {number} currentPrice The current tick price.
 */
function processTradeQueue(currentPrice) {
    // Iterate backwards to safely remove items from the array
    for (let i = state.tradeQueue.length - 1; i >= 0; i--) {
        const trade = state.tradeQueue[i];

        // Skip if this trade is already complete (should not happen with current logic, but good practice)
        if (trade.collected.length >= CONFIG.TICKS_FOR_TRADE) continue;

        trade.collected.push(currentPrice);

        // Evaluate the trade once enough ticks are collected
        if (trade.collected.length === CONFIG.TICKS_FOR_TRADE) {
            const upperBarrier = trade.startPrice + CONFIG.BARRIER_UPPER;
            const lowerBarrier = trade.startPrice - CONFIG.BARRIER_LOWER;
            const within = trade.collected.every(p => p >= lowerBarrier && p <= upperBarrier);
            const outcome = within ? 'WIN' : 'LOSS';

            const result = {
                type: MSG_TYPES.TRADE_RESULT,
                startPrice: trade.startPrice,
                prices: [...trade.collected],
                upperBarrier,
                lowerBarrier,
                outcome,
                timestamp: Date.now(),
                pattern: trade.pattern
            };

            broadcast(JSON.stringify(result));
            console.log('Trade completed:', result);

            // Remove the completed trade from the queue
            state.tradeQueue.splice(i, 1);
        }
    }
}

/**
 * Main processing function for each tick.
 * @param {object} tick The tick data from the API.
 */
function processTick(tick) {
    const price = parseFloat(tick.quote);
    
    updatePriceHistory(price);
    checkForSignal(price);
    processTradeQueue(price);
}

// WebSocket server for dashboard clients
wss.on('connection', (clientWs) => {
    state.clients.add(clientWs);
    console.log('New client connected');
    
    clientWs.on('close', () => {
        state.clients.delete(clientWs);
        console.log('Client disconnected');
    });
    
    clientWs.on('error', (error) => {
        console.error('WebSocket error on client connection:', error);
    });
});

function broadcast(message) {
    state.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
