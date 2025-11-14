import asyncio
import json
import websockets
from flask import Flask, send_from_directory
from flask_cors import CORS
import threading
import time
from datetime import datetime, timezone

# --- Flask App Setup ---
app = Flask(__name__, static_folder='public')
CORS(app)

# Serve the main HTML file
@app.route('/')
def index():
    return send_from_directory('public', 'index.html')

# Serve other static files (CSS, JS)
@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('public', path)

# --- Configuration ---
CONFIG = {
    "APP_ID": 1089, # Your App ID
    "API_TOKEN": "DcvgxmW376P871t", # Your API Token
    "MARKET": "1HZ100V",
    "BARRIER_UPPER": 2.0,
    "BARRIER_LOWER": 0.9,
    "TICKS_FOR_TRADE": 5,
    "COOLDOWN_MS": 20000  # 20 seconds
}

# --- Message Types ---
MSG_TYPES = {
    "TICK": 'tick',
    "SIGNAL": 'SIGNAL',
    "TRADE_RESULT": 'TRADE_RESULT'
}

# --- Application State ---
state = {
    "prices": [],
    "last_digits": [],
    "trade_queue": [],
    "last_signal_time": 0,
    "clients": set()
}

# --- Backend Logic ---

def update_price_history(price):
    """Updates the history of prices and last digits."""
    state["prices"].append(price)
    if len(state["prices"]) > 1000:
        state["prices"].pop(0)

    last_digit = int(f"{price:.2f}"[-1])
    state["last_digits"].append(last_digit)
    if len(state["last_digits"]) > 1000:
        state["last_digits"].pop(0)

async def check_for_signal(price):
    """Checks for the signal pattern and creates a new trade if found."""
    last_digits = state["last_digits"]
    current_time_ms = int(time.time() * 1000)

    has_double_digit_pattern = (
        len(last_digits) >= 2 and last_digits[-1] == last_digits[-2]
    )
    is_cooldown_over = (current_time_ms - state["last_signal_time"]) >= CONFIG["COOLDOWN_MS"]

    if has_double_digit_pattern and is_cooldown_over:
        pattern = [last_digits[-2], last_digits[-1]]
        
        state["trade_queue"].append({
            "startPrice": price,
            "collected": [],
            "pattern": pattern,
            "timestamp": current_time_ms
        })

        state["last_signal_time"] = current_time_ms

        signal_message = {
            "type": MSG_TYPES["SIGNAL"],
            "price": price,
            "time": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            "pattern": pattern
        }
        await broadcast(json.dumps(signal_message))
        print(f"New signal detected: {signal_message}")

async def process_trade_queue(current_price):
    """Processes each trade in the queue, collecting ticks and evaluating results."""
    # Iterate backwards to safely remove items
    for i in range(len(state["trade_queue"]) - 1, -1, -1):
        trade = state["trade_queue"][i]

        if len(trade["collected"]) >= CONFIG["TICKS_FOR_TRADE"]:
            continue

        trade["collected"].append(current_price)

        if len(trade["collected"]) == CONFIG["TICKS_FOR_TRADE"]:
            upper_barrier = trade["startPrice"] + CONFIG["BARRIER_UPPER"]
            lower_barrier = trade["startPrice"] - CONFIG["BARRIER_LOWER"]
            
            is_within = all(lower_barrier <= p <= upper_barrier for p in trade["collected"])
            outcome = "WIN" if is_within else "LOSS"

            result_message = {
                "type": MSG_TYPES["TRADE_RESULT"],
                "startPrice": trade["startPrice"],
                "prices": trade["collected"],
                "upperBarrier": upper_barrier,
                "lowerBarrier": lower_barrier,
                "outcome": outcome,
                "timestamp": int(time.time() * 1000),
                "pattern": trade["pattern"]
            }
            
            await broadcast(json.dumps(result_message))
            print(f"Trade completed: {result_message}")

            # Remove from queue
            state["trade_queue"].pop(i)

async def process_tick(tick):
    """Main processing function for each tick."""
    price = float(tick["quote"])
    update_price_history(price)
    await check_for_signal(price)
    await process_trade_queue(price)

# --- WebSocket Handlers ---

async def broadcast(message):
    """Sends a message to all connected dashboard clients."""
    if state["clients"]:
        websockets.broadcast(state["clients"], message)

async def handle_dashboard_client(websocket):
    """Handles connections from the frontend dashboard."""
    state["clients"].add(websocket)
    print("New client connected")
    try:
        await websocket.wait_closed()
    finally:
        state["clients"].remove(websocket)
        print("Client disconnected")

async def connect_to_deriv():
    """Connects to Deriv WebSocket and processes incoming ticks."""
    uri = f"wss://ws.derivws.com/websockets/v3?app_id={CONFIG['APP_ID']}"
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                # Authorize with the API token
                await websocket.send(json.dumps({
                    "authorize": CONFIG["API_TOKEN"]
                }))
                print("Authorized with Deriv API")
                print("Connected to Deriv WebSocket")
                await websocket.send(json.dumps({
                    "ticks": CONFIG["MARKET"],
                    "subscribe": 1
                }))
                
                async for message in websocket:
                    try:
                        data = json.loads(message)
                        if data.get("msg_type") == MSG_TYPES["TICK"]:
                            await process_tick(data["tick"])
                    except Exception as e:
                        print(f"Error processing message: {e}")
        except Exception as e:
            print(f"Deriv connection error: {e}. Reconnecting in 5 seconds...")
            await asyncio.sleep(5)

async def main():
    """Starts all services."""
    # Start the WebSocket server for dashboard clients
    dashboard_server = await websockets.serve(handle_dashboard_client, "0.0.0.0", 8765)
    print("Dashboard WebSocket server started on ws://0.0.0.0:8765")

    # Start the connection to Deriv
    asyncio.create_task(connect_to_deriv())

    # Keep the servers running
    await asyncio.Future()

def run_flask():
    # Note: Use a production-ready server like Gunicorn or Waitress instead of app.run in production
    app.run(host='0.0.0.0', port=3000)

if __name__ == "__main__":
    # Run Flask in a separate thread
    flask_thread = threading.Thread(target=run_flask)
    flask_thread.daemon = True
    flask_thread.start()
    print("HTTP server started on http://0.0.0.0:3000")

    # Run asyncio event loop for WebSockets
    asyncio.run(main())