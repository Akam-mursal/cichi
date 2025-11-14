document.addEventListener('DOMContentLoaded', () => {
    const activeSignalsContainer = document.getElementById('active-signals');
    const tradesBody = document.getElementById('trades-body');
    const statusElement = document.getElementById('status');
    const marketElement = document.getElementById('market');
    const footerQuoteElement = document.getElementById('footer-quote');
    
    // --- CONFIGURATION (Moved from Python) ---
    const CONFIG = {
        APP_ID: 1089,
        API_TOKEN: "DcvgxmW376P871t", // WARNING: This is now visible to the public!
        MARKET: "1HZ100V",
        BARRIER_UPPER: 2.0,
        BARRIER_LOWER: 0.9,
        TICKS_FOR_TRADE: 5,
        COOLDOWN_MS: 20000 // 20 seconds
    };

    // --- APPLICATION STATE (Moved from Python) ---
    const state = {
        prices: [],
        lastDigits: [],
        tradeQueue: [],
        lastSignalTime: 0,
    };
    
    // Keep track of active signals
    const activeSignals = new Map();
    const maxTradeResults = 20; // Limit the trade history to 20 entries
    
    // --- DIRECT WEBSOCKET CONNECTION TO DERIV ---
    const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${CONFIG.APP_ID}`;
    const ws = new WebSocket(wsUrl);

    // Connection handling
    ws.onopen = () => {
        console.log('Connected directly to Deriv API');
        statusElement.textContent = 'Connected';
        statusElement.className = 'status-active';
        // Authorize and Subscribe
        ws.send(JSON.stringify({ "authorize": CONFIG.API_TOKEN }));
        ws.send(JSON.stringify({ "ticks": CONFIG.MARKET, "subscribe": 1 }));
    };
    
    ws.onclose = () => {
        console.log('Disconnected from Deriv API');
        statusElement.textContent = 'Disconnected';
        statusElement.className = 'status-inactive';
        
        // Try to reconnect after 5 seconds
        setTimeout(() => {
            window.location.reload();
        }, 5000);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        statusElement.textContent = 'Error';
        statusElement.className = 'status-inactive';
    };
    
    // Handle incoming messages
    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);

            if (message.error) {
                console.error('Deriv API Error:', message.error.message);
                return;
            }

            if (message.msg_type === 'authorize') {
                if (message.authorize) {
                    console.log('Successfully authorized.');
                } else {
                    console.error('Authorization failed.');
                }
            }
            
            if (message.msg_type === 'tick') {
                processTick(message.tick);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    };

    // --- ALL LOGIC IS NOW IN JAVASCRIPT ---

    function processTick(tick) {
        const price = parseFloat(tick.quote);
        updatePriceHistory(price);
        checkForSignal(price);
        processTradeQueue(price);
    }

    function updatePriceHistory(price) {
        state.prices.push(price);
        if (state.prices.length > 1000) state.prices.shift();

        const lastDigit = parseInt(price.toFixed(2).slice(-1));
        state.lastDigits.push(lastDigit);
        if (state.lastDigits.length > 1000) state.lastDigits.shift();
    }

    function checkForSignal(price) {
        const { lastDigits, lastSignalTime } = state;
        const currentTime = Date.now();

        const hasDoubleDigitPattern = lastDigits.length >= 2 && lastDigits[lastDigits.length - 1] === lastDigits[lastDigits.length - 2];
        const isCooldownOver = currentTime - lastSignalTime >= CONFIG.COOLDOWN_MS;

        if (hasDoubleDigitPattern && isCooldownOver) {
            const pattern = [lastDigits[lastDigits.length - 2], lastDigits[lastDigits.length - 1]];
            
            state.tradeQueue.push({
                startPrice: price,
                collected: [],
                pattern: pattern,
                timestamp: currentTime
            });

            state.lastSignalTime = currentTime;

            const signalMessage = {
                price: price,
                time: new Date().toISOString(),
                pattern: pattern
            };
            handleNewSignal(signalMessage); // Directly call the UI function
            console.log('New signal detected:', signalMessage);
        }
    }
    
    // Handle new trading signal
    function handleNewSignal(signal) {
        const signalId = `signal-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        
        // Add to active signals
        activeSignals.set(signalId, {
            ...signal,
            id: signalId,
            startTime: Date.now(),
            progress: 0
        });
        
        // Update UI
        updateActiveSignalsUI();

        // Apply blinking animation to the new card
        const newCard = document.getElementById(signalId);
        if (newCard) {
            newCard.classList.add('new-signal');

            // Remove the animation class after it finishes so it doesn't repeat
            setTimeout(() => {
                newCard.classList.remove('new-signal');
            }, 2400); // Animation is 1.2s and runs twice (1.2 * 2 = 2.4s)
        }
        
        // Start progress animation
        const progressInterval = setInterval(() => {
            const signal = activeSignals.get(signalId);
            if (!signal) {
                clearInterval(progressInterval);
                return;
            }
            
            const elapsed = Date.now() - signal.startTime;
            signal.progress = Math.min((elapsed / 10000) * 100, 100); // 10 seconds total
            
            // Remove signal after completion
            if (signal.progress >= 100) {
                clearInterval(progressInterval); // Stop the timer
                activeSignals.delete(signalId); // Remove from the data map
                updateActiveSignalsUI(); // Redraw the UI to remove the card
            }
        }, 100);
    }
    
    // Update the active signals UI
    function updateActiveSignalsUI() {
        if (activeSignals.size === 0) {
            activeSignalsContainer.innerHTML = '<div class="no-signals">Waiting for signals...</div>';
            return;
        }
        
        activeSignalsContainer.innerHTML = '';
        
        activeSignals.forEach(signal => {
            const patternStr = signal.pattern.join(' → ');
            const timeLeft = ((10000 - (Date.now() - signal.startTime)) / 1000).toFixed(1);
            
            const card = document.createElement('div');
            card.className = 'card';
            card.id = signal.id;
            
            card.innerHTML = `
                <h3>${patternStr}</h3>
                <p>${signal.price.toFixed(2)}</p>
                <div style="margin-top: 10px; font-size: 14px; color: #aaa;">
                    Time Left: <span id="${signal.id}-time">${timeLeft}s</span>
                </div>
            `;
            
            activeSignalsContainer.appendChild(card);
        });
    }
    
    function processTradeQueue(currentPrice) {
        for (let i = state.tradeQueue.length - 1; i >= 0; i--) {
            const trade = state.tradeQueue[i];

            if (trade.collected.length >= CONFIG.TICKS_FOR_TRADE) continue;

            trade.collected.push(currentPrice);

            if (trade.collected.length === CONFIG.TICKS_FOR_TRADE) {
                const upperBarrier = trade.startPrice + CONFIG.BARRIER_UPPER;
                const lowerBarrier = trade.startPrice - CONFIG.BARRIER_LOWER;
                const isWithin = trade.collected.every(p => p >= lowerBarrier && p <= upperBarrier);
                const outcome = isWithin ? 'WIN' : 'LOSS';

                const resultMessage = {
                    startPrice: trade.startPrice,
                    prices: [...trade.collected],
                    outcome: outcome,
                    timestamp: Date.now(),
                    pattern: trade.pattern
                };
                
                handleTradeResult(resultMessage); // Directly call the UI function
                console.log('Trade completed:', resultMessage);

                state.tradeQueue.splice(i, 1);
            }
        }
    }

    // Handle trade results
    function handleTradeResult(result) {
        // Remove "no trades" message if it exists
        const noTradesRow = tradesBody.querySelector('.no-trades');
        if (noTradesRow) {
            tradesBody.removeChild(noTradesRow);
        }
        
        const row = document.createElement('tr');
        const time = new Date(result.timestamp).toLocaleTimeString();
        const patternStr = result.pattern.join(' → ');
        const priceChange = (result.prices[result.prices.length - 1] - result.startPrice).toFixed(2);
        const priceText = `${result.startPrice.toFixed(2)} → ${result.prices[result.prices.length - 1].toFixed(2)} (${priceChange})`;
        
        row.innerHTML = `
            <td>${patternStr}</td>
            <td>${time}</td>
            <td class="${result.outcome.toLowerCase()}">${result.outcome} ${result.outcome === 'WIN' ? '✅' : '❌'}</td>
            <td>${priceText}</td>
        `;
        
        // Add to the top of the table
        if (tradesBody.firstChild) {
            tradesBody.insertBefore(row, tradesBody.firstChild);
        } else {
            tradesBody.appendChild(row);
        }
        
        // Limit the number of displayed trades
        while (tradesBody.children.length > maxTradeResults) {
            tradesBody.removeChild(tradesBody.lastChild);
        }
    }
    
    // Update time remaining for active signals
    setInterval(() => {
        activeSignals.forEach((signal, id) => {
            const timeElement = document.querySelector(`#${id}-time`);
            if (timeElement) {
                const elapsed = Date.now() - signal.startTime;
                const remaining = Math.max(0, 10 - (elapsed / 1000)).toFixed(1);
                timeElement.textContent = `${remaining}s`;
            }
        });
    }, 100);

    // --- Footer Quotes Logic ---
    const quotes = [
        "The trend is your friend until the end when it bends.",
        "Plan your trade and trade your plan.",
        "Cut your losses short and let your profits run.",
        "The market is a device for transferring money from the impatient to the patient.",
        "Don't be afraid to take a loss. It's part of the game.",
        "Never risk more than you can afford to lose.",
        "The four most dangerous words in investing are: 'This time it's different'.",
        "In trading, the impossible happens about twice a day.",
        "Amateurs think about how much money they can make. Professionals think about how much they can lose.",
        "The market can stay irrational longer than you can stay solvent.",
        "Don't focus on making money; focus on protecting what you have.",
        "Successful trading is about managing risk, not avoiding it."
    ];

    let currentQuoteIndex = 0;

    function updateFooterQuote() {
        currentQuoteIndex = (currentQuoteIndex + 1) % quotes.length;
        footerQuoteElement.style.opacity = 0;
        setTimeout(() => {
            footerQuoteElement.textContent = `"${quotes[currentQuoteIndex]}"`;
            footerQuoteElement.style.opacity = 1;
        }, 500); // Wait for fade out before changing text
    }

    // Set initial quote and then update every 30 seconds
    updateFooterQuote();
    setInterval(updateFooterQuote, 30000);
});
