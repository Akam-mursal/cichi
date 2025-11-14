document.addEventListener('DOMContentLoaded', () => {
    const activeSignalsContainer = document.getElementById('active-signals');
    const tradesBody = document.getElementById('trades-body');
    const statusElement = document.getElementById('status');
    const marketElement = document.getElementById('market');
    
    // WebSocket connection to our server
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = `${protocol}${window.location.host}`;
    const ws = new WebSocket(wsUrl);
    
    // Keep track of active signals
    const activeSignals = new Map();
    const maxTradeResults = 50;
    
    // Connection handling
    ws.onopen = () => {
        console.log('Connected to server');
        statusElement.textContent = 'Connected';
        statusElement.className = 'status-active';
    };
    
    ws.onclose = () => {
        console.log('Disconnected from server');
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
            
            if (message.type === 'SIGNAL') {
                handleNewSignal(message);
            } else if (message.type === 'TRADE_RESULT') {
                handleTradeResult(message);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    };
    
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
                activeSignals.delete(signalId);
                updateActiveSignalsUI();
                clearInterval(progressInterval);
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
});
