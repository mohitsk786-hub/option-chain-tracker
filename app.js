// ============================================
// NSE India API - Option Chain Tracker
// No Login Required! Direct Free Data!
// ============================================

const CONFIG = {
    NSE_BASE: 'https://www.nseindia.com/api',
    REFRESH_INTERVAL: 3000, // 3 seconds
    SYMBOLS: {
        NIFTY: { 
            name: 'NIFTY',
            strikeGap: 50
        },
        BANKNIFTY: { 
            name: 'BANKNIFTY',
            strikeGap: 100
        }
    }
};

let STATE = {
    currentSymbol: 'NIFTY',
    currentTimeframe: '1m',
    autoRefresh: true,
    refreshTimer: null,
    spotPrice: 0,
    atmStrike: 0,
    isInitialLoad: true
};

let db;

// ============================================
// Initialize App
// ============================================

window.addEventListener('load', async () => {
    console.log('🚀 App starting...');
    
    await initDB();
    setupEventListeners();
    registerServiceWorker();
    
    // Start fetching data
    await setCookies();
    await loadOptionChain();
    startAutoRefresh();
});

// ============================================
// NSE Cookies Setup (Important!)
// ============================================

async function setCookies() {
    try {
        showLoader(true);
        showAppStatus('Initializing...', 'info');
        
        await fetch('https://www.nseindia.com', {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*'
            }
        });
        
        console.log('✅ NSE cookies set');
        
    } catch (error) {
        console.error('Cookie setup error:', error);
    }
}

// ============================================
// Option Chain Functions
// ============================================

async function loadOptionChain() {
    showLoader(true);
    
    try {
        const symbol = STATE.currentSymbol;
        
        // Fetch option chain from NSE
        const url = `${CONFIG.NSE_BASE}/option-chain-indices?symbol=${symbol}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.nseindia.com/option-chain'
            },
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`NSE API returned ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.records || !data.records.data) {
            throw new Error('Invalid data format from NSE');
        }
        
        // Extract spot price
        STATE.spotPrice = data.records.underlyingValue;
        
        // Calculate ATM strike
        const strikeGap = CONFIG.SYMBOLS[symbol].strikeGap;
        STATE.atmStrike = Math.round(STATE.spotPrice / strikeGap) * strikeGap;
        
        // Update header
        document.getElementById('spotPrice').textContent = STATE.spotPrice.toFixed(2);
        document.getElementById('symbolName').textContent = symbol;
        
        // Filter strikes (ATM ± 5)
        const filteredData = filterStrikes(data.records.data, STATE.atmStrike, strikeGap);
        
        // Process and store OI data
        const processedData = await processOptionData(filteredData);
        
        // Display
        displayOptionChain(processedData);
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
        });
        
        showAppStatus(`✅ Updated: ${timeStr}`, 'success');
        document.getElementById('lastUpdate').textContent = `Last: ${timeStr}`;
        
        if (STATE.isInitialLoad) {
            STATE.isInitialLoad = false;
            console.log('✅ Initial load complete');
        }
        
    } catch (error) {
        console.error('Load error:', error);
        showAppStatus(`⚠️ Error: ${error.message}`, 'error');
        
        // Retry after 5 seconds on error
        if (STATE.autoRefresh) {
            setTimeout(() => loadOptionChain(), 5000);
        }
    } finally {
        showLoader(false);
    }
}

function filterStrikes(data, atmStrike, strikeGap) {
    const strikes = [];
    
    for (let i = -5; i <= 5; i++) {
        const strike = atmStrike + (i * strikeGap);
        const strikeData = data.find(d => d.strikePrice === strike);
        
        if (strikeData) {
            strikes.push({
                strike: strike,
                isATM: strike === atmStrike,
                CE: strikeData.CE || {},
                PE: strikeData.PE || {}
            });
        }
    }
    
    return strikes;
}

async function processOptionData(strikes) {
    const timestamp = Date.now();
    const processedData = [];
    
    for (const strikeData of strikes) {
        const strike = strikeData.strike;
        
        // CE data
        const ceOI = strikeData.CE.openInterest || 0;
        const ceChange = strikeData.CE.changeinOpenInterest || 0;
        const ceVolume = strikeData.CE.totalTradedVolume || 0;
        const ceLTP = strikeData.CE.lastPrice || 0;
        
        // PE data
        const peOI = strikeData.PE.openInterest || 0;
        const peChange = strikeData.PE.changeinOpenInterest || 0;
        const peVolume = strikeData.PE.totalTradedVolume || 0;
        const peLTP = strikeData.PE.lastPrice || 0;
        
        // Store in IndexedDB
        await storeOIData(timestamp, STATE.currentSymbol, strike, 'CE', ceOI);
        await storeOIData(timestamp, STATE.currentSymbol, strike, 'PE', peOI);
        
        // Calculate timeframe changes
        const ceTimeframeChange = await calculateTimeframeChange(strike, 'CE', ceOI);
        const peTimeframeChange = await calculateTimeframeChange(strike, 'PE', peOI);
        
        processedData.push({
            strike: strike,
            isATM: strikeData.isATM,
            ce: {
                totalOI: ceOI,
                changeOI: ceChange,
                timeframeChange: ceTimeframeChange,
                volume: ceVolume,
                ltp: ceLTP
            },
            pe: {
                totalOI: peOI,
                changeOI: peChange,
                timeframeChange: peTimeframeChange,
                volume: peVolume,
                ltp: peLTP
            }
        });
    }
    
    return processedData;
}

async function calculateTimeframeChange(strike, optionType, currentOI) {
    const timeframeSeconds = getTimeframeSeconds(STATE.currentTimeframe);
    const cutoffTime = Date.now() - (timeframeSeconds * 1000);
    
    const historicalData = await getHistoricalOI(
        STATE.currentSymbol,
        strike,
        optionType,
        cutoffTime
    );
    
    if (historicalData.length > 0) {
        const oldestOI = historicalData[0].oi;
        return currentOI - oldestOI;
    }
    
    return 0;
}

function getTimeframeSeconds(timeframe) {
    const map = {
        '30s': 30,
        '1m': 60,
        '2m': 120,
        '3m': 180,
        '5m': 300,
        '10m': 600,
        '15m': 900,
        '30m': 1800,
        '1h': 3600,
        '2h': 7200,
        '4h': 14400,
        '1d': 86400
    };
    return map[timeframe] || 60;
}

// ============================================
// Display Functions
// ============================================

function displayOptionChain(data) {
    const container = document.getElementById('optionChainData');
    container.innerHTML = '';
    
    data.forEach(row => {
        const rowDiv = document.createElement('div');
        rowDiv.className = `strike-row ${row.isATM ? 'atm' : ''}`;
        
        rowDiv.innerHTML = `
            <div class="ce-data">
                <div class="oi-total">OI: ${formatNumber(row.ce.totalOI)}</div>
                <div class="oi-change ${getChangeClass(row.ce.changeOI)}">
                    Chg: ${formatChange(row.ce.changeOI)}
                </div>
                <div class="oi-timeframe ${getChangeClass(row.ce.timeframeChange)}">
                    ${STATE.currentTimeframe}: ${formatChange(row.ce.timeframeChange)}
                </div>
            </div>
            
            <div class="strike-value">
                ${row.strike}
            </div>
            
            <div class="pe-data">
                <div class="oi-total">OI: ${formatNumber(row.pe.totalOI)}</div>
                <div class="oi-change ${getChangeClass(row.pe.changeOI)}">
                    Chg: ${formatChange(row.pe.changeOI)}
                </div>
                <div class="oi-timeframe ${getChangeClass(row.pe.timeframeChange)}">
                    ${STATE.currentTimeframe}: ${formatChange(row.pe.timeframeChange)}
                </div>
            </div>
        `;
        
        container.appendChild(rowDiv);
    });
}

function formatNumber(num) {
    if (num >= 10000000) return (num / 10000000).toFixed(2) + 'Cr';
    if (num >= 100000) return (num / 100000).toFixed(2) + 'L';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return num.toString();
}

function formatChange(num) {
    const sign = num >= 0 ? '+' : '';
    return sign + formatNumber(Math.abs(num));
}

function getChangeClass(num) {
    return num >= 0 ? 'positive' : 'negative';
}

// ============================================
// Event Listeners
// ============================================

function setupEventListeners() {
    // Symbol buttons
    document.querySelectorAll('.btn-symbol').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-symbol').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            STATE.currentSymbol = e.target.dataset.symbol;
            loadOptionChain();
        });
    });
    
    // Timeframe selector
    document.getElementById('timeframeSelect').addEventListener('change', (e) => {
        STATE.currentTimeframe = e.target.value;
        // Reload to recalculate timeframe changes
        loadOptionChain();
    });
    
    // Auto-refresh toggle
    document.getElementById('autoRefresh').addEventListener('change', (e) => {
        STATE.autoRefresh = e.target.checked;
        if (STATE.autoRefresh) {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    });
}

// ============================================
// Auto Refresh
// ============================================

function startAutoRefresh() {
    if (STATE.refreshTimer) {
        clearInterval(STATE.refreshTimer);
    }
    
    STATE.refreshTimer = setInterval(() => {
        if (STATE.autoRefresh) {
            loadOptionChain();
        }
    }, CONFIG.REFRESH_INTERVAL);
    
    console.log('✅ Auto-refresh started (3s interval)');
}

function stopAutoRefresh() {
    if (STATE.refreshTimer) {
        clearInterval(STATE.refreshTimer);
        STATE.refreshTimer = null;
    }
    
    console.log('⏸️ Auto-refresh stopped');
}

// ============================================
// IndexedDB Functions
// ============================================

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('OptionChainDB', 1);
        
        request.onerror = () => {
            console.error('❌ Database failed');
            reject(request.error);
        };
        
        request.onsuccess = () => {
            db = request.result;
            console.log('✅ Database ready');
            resolve();
        };
        
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            
            if (!db.objectStoreNames.contains('oiData')) {
                const objectStore = db.createObjectStore('oiData', { 
                    keyPath: 'id', 
                    autoIncrement: true 
                });
                objectStore.createIndex('timestamp', 'timestamp', { unique: false });
                objectStore.createIndex('symbol', 'symbol', { unique: false });
                objectStore.createIndex('strike', 'strike', { unique: false });
                console.log('✅ Database created');
            }
        };
    });
}

async function storeOIData(timestamp, symbol, strike, optionType, oi) {
    if (!db) return;
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['oiData'], 'readwrite');
        const objectStore = transaction.objectStore('oiData');
        
        const request = objectStore.add({
            timestamp,
            symbol,
            strike,
            optionType,
            oi
        });
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function getHistoricalOI(symbol, strike, optionType, cutoffTime) {
    if (!db) return [];
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['oiData'], 'readonly');
        const objectStore = transaction.objectStore('oiData');
        
        const results = [];
        const request = objectStore.openCursor();
        
        request.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const data = cursor.value;
                if (
                    data.symbol === symbol &&
                    data.strike === strike &&
                    data.optionType === optionType &&
                    data.timestamp >= cutoffTime
                ) {
                    results.push(data);
                }
                cursor.continue();
            } else {
                resolve(results.sort((a, b) => a.timestamp - b.timestamp));
            }
        };
        
        request.onerror = () => reject(request.error);
    });
}

// Clean old data every hour (>24 hours)
setInterval(() => {
    if (!db) return;
    
    const cutoff = Date.now() - (86400 * 1000); // 24 hours
    const transaction = db.transaction(['oiData'], 'readwrite');
    const objectStore = transaction.objectStore('oiData');
    const request = objectStore.openCursor();
    
    let deletedCount = 0;
    
    request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            if (cursor.value.timestamp < cutoff) {
                cursor.delete();
                deletedCount++;
            }
            cursor.continue();
        } else {
            if (deletedCount > 0) {
                console.log(`🗑️ Cleaned ${deletedCount} old records`);
            }
        }
    };
}, 3600000); // Every hour

// ============================================
// UI Helper Functions
// ============================================

function showLoader(show) {
    const loader = document.getElementById('loader');
    if (show) {
        loader.classList.remove('hidden');
    } else {
        loader.classList.add('hidden');
    }
}

function showAppStatus(message) {
    document.getElementById('statusMsg').textContent = message;
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('✅ Service Worker registered'))
            .catch(err => console.error('❌ SW registration failed:', err));
    }
}