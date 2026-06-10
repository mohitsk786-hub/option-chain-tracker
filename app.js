// ============================================
// NSE Option Chain - CORS Proxy Fixed
// ============================================

const CONFIG = {
    // Using CORS Anywhere proxy
    CORS_PROXY: 'https://corsproxy.io/?',
    NSE_BASE: 'https://www.nseindia.com/api',
    REFRESH_INTERVAL: 5000, // 5 seconds
    SYMBOLS: {
        NIFTY: { name: 'NIFTY', strikeGap: 50 },
        BANKNIFTY: { name: 'BANKNIFTY', strikeGap: 100 }
    }
};

let STATE = {
    currentSymbol: 'NIFTY',
    currentTimeframe: '1m',
    autoRefresh: true,
    refreshTimer: null,
    spotPrice: 0,
    atmStrike: 0,
    oiData: {} // Store OI data in memory
};

// ============================================
// Initialize
// ============================================

window.addEventListener('load', async () => {
    console.log('🚀 App starting...');
    setupEventListeners();
    await loadOptionChain();
    startAutoRefresh();
});

// ============================================
// Load Option Chain (CORS Fixed)
// ============================================

async function loadOptionChain() {
    showLoader(true);
    showAppStatus('📡 Fetching NSE data...', 'info');
    
    try {
        const symbol = STATE.currentSymbol;
        
        // Build URL with CORS proxy
        const nseUrl = `${CONFIG.NSE_BASE}/option-chain-indices?symbol=${symbol}`;
        const url = CONFIG.CORS_PROXY + encodeURIComponent(nseUrl);
        
        console.log('🔗 Fetching:', url);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('✅ Data received');
        
        if (!data.records || !data.records.data) {
            throw new Error('Invalid data format from NSE');
        }
        
        // Process data
        STATE.spotPrice = data.records.underlyingValue;
        const strikeGap = CONFIG.SYMBOLS[symbol].strikeGap;
        STATE.atmStrike = Math.round(STATE.spotPrice / strikeGap) * strikeGap;
        
        // Update header
        document.getElementById('spotPrice').textContent = STATE.spotPrice.toFixed(2);
        document.getElementById('symbolName').textContent = symbol;
        
        // Filter and display strikes
        const filteredData = filterStrikes(data.records.data, STATE.atmStrike, strikeGap);
        const processedData = processOptionData(filteredData);
        displayOptionChain(processedData);
        
        const timeStr = new Date().toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        showAppStatus(`✅ Updated: ${timeStr}`, 'success');
        document.getElementById('lastUpdate').textContent = timeStr;
        
    } catch (error) {
        console.error('❌ Error:', error);
        showAppStatus(`❌ ${error.message}`, 'error');
        
        // Retry after 10 seconds
        if (STATE.autoRefresh) {
            setTimeout(() => loadOptionChain(), 10000);
        }
    } finally {
        showLoader(false);
    }
}

// ============================================
// Filter Strikes (ATM ± 5)
// ============================================

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

// ============================================
// Process Option Data
// ============================================

function processOptionData(strikes) {
    const timestamp = Date.now();
    const processedData = [];
    
    for (const strikeData of strikes) {
        const strike = strikeData.strike;
        const key = `${STATE.currentSymbol}_${strike}`;
        
        // CE Data
        const ceCurrentOI = strikeData.CE.openInterest || 0;
        const ceChangeNSE = strikeData.CE.changeinOpenInterest || 0;
        
        // PE Data
        const peCurrentOI = strikeData.PE.openInterest || 0;
        const peChangeNSE = strikeData.PE.changeinOpenInterest || 0;
        
        // Store first OI value (for running total)
        if (!STATE.oiData[key + '_CE']) {
            STATE.oiData[key + '_CE'] = {
                first: ceCurrentOI,
                previous: ceCurrentOI,
                history: [{ time: timestamp, oi: ceCurrentOI }]
            };
        }
        
        if (!STATE.oiData[key + '_PE']) {
            STATE.oiData[key + '_PE'] = {
                first: peCurrentOI,
                previous: peCurrentOI,
                history: [{ time: timestamp, oi: peCurrentOI }]
            };
        }
        
        // Update history (keep last 1 hour)
        const ceHistory = STATE.oiData[key + '_CE'].history;
        const peHistory = STATE.oiData[key + '_PE'].history;
        
        ceHistory.push({ time: timestamp, oi: ceCurrentOI });
        peHistory.push({ time: timestamp, oi: peCurrentOI });
        
        // Clean old data (>1 hour)
        const oneHourAgo = timestamp - (3600 * 1000);
        STATE.oiData[key + '_CE'].history = ceHistory.filter(h => h.time > oneHourAgo);
        STATE.oiData[key + '_PE'].history = peHistory.filter(h => h.time > oneHourAgo);
        
        // Calculate changes
        const ceChangeFromStart = ceCurrentOI - STATE.oiData[key + '_CE'].first;
        const peChangeFromStart = peCurrentOI - STATE.oiData[key + '_PE'].first;
        
        const ceTimeframeChange = calculateTimeframeChange(STATE.oiData[key + '_CE'].history, ceCurrentOI);
        const peTimeframeChange = calculateTimeframeChange(STATE.oiData[key + '_PE'].history, peCurrentOI);
        
        processedData.push({
            strike: strike,
            isATM: strikeData.isATM,
            ce: {
                totalOI: ceCurrentOI,
                changeInOI: ceChangeFromStart,
                timeframeChange: ceTimeframeChange
            },
            pe: {
                totalOI: peCurrentOI,
                changeInOI: peChangeFromStart,
                timeframeChange: peTimeframeChange
            }
        });
        
        // Update previous
        STATE.oiData[key + '_CE'].previous = ceCurrentOI;
        STATE.oiData[key + '_PE'].previous = peCurrentOI;
    }
    
    return processedData;
}

// ============================================
// Calculate Timeframe Change
// ============================================

function calculateTimeframeChange(history, currentOI) {
    const timeframeSeconds = getTimeframeSeconds(STATE.currentTimeframe);
    const cutoffTime = Date.now() - (timeframeSeconds * 1000);
    
    // Find oldest value in timeframe
    const oldData = history.find(h => h.time >= cutoffTime);
    
    if (oldData) {
        return currentOI - oldData.oi;
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
// Display Option Chain
// ============================================

function displayOptionChain(data) {
    const container = document.getElementById('optionChainData');
    container.innerHTML = '';
    
    data.forEach(row => {
        const rowDiv = document.createElement('div');
        rowDiv.className = `strike-row ${row.isATM ? 'atm' : ''}`;
        
        rowDiv.innerHTML = `
            <div class="ce-data">
                <div class="data-section">
                    <div class="label">CE Total OI</div>
                    <div class="value-big">${formatNumber(row.ce.totalOI)}</div>
                </div>
                
                <div class="data-section">
                    <div class="label">Change in OI</div>
                    <div class="value-medium ${getChangeClass(row.ce.changeInOI)}">
                        ${formatChange(row.ce.changeInOI)}
                    </div>
                </div>
                
                <div class="data-section timeframe-section">
                    <div class="label">${STATE.currentTimeframe}</div>
                    <div class="value-medium ${getChangeClass(row.ce.timeframeChange)}">
                        ${formatChange(row.ce.timeframeChange)}
                    </div>
                </div>
            </div>
            
            <div class="strike-value">
                <div class="strike-number">${row.strike}</div>
                ${row.isATM ? '<div class="atm-badge">ATM</div>' : ''}
            </div>
            
            <div class="pe-data">
                <div class="data-section">
                    <div class="label">PE Total OI</div>
                    <div class="value-big">${formatNumber(row.pe.totalOI)}</div>
                </div>
                
                <div class="data-section">
                    <div class="label">Change in OI</div>
                    <div class="value-medium ${getChangeClass(row.pe.changeInOI)}">
                        ${formatChange(row.pe.changeInOI)}
                    </div>
                </div>
                
                <div class="data-section timeframe-section">
                    <div class="label">${STATE.currentTimeframe}</div>
                    <div class="value-medium ${getChangeClass(row.pe.timeframeChange)}">
                        ${formatChange(row.pe.timeframeChange)}
                    </div>
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
            STATE.oiData = {}; // Reset data
            loadOptionChain();
        });
    });
    
    // Timeframe selector
    document.getElementById('timeframeSelect')?.addEventListener('change', (e) => {
        STATE.currentTimeframe = e.target.value;
        loadOptionChain();
    });
    
    // Auto-refresh
    document.getElementById('autoRefresh')?.addEventListener('change', (e) => {
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
    if (STATE.refreshTimer) clearInterval(STATE.refreshTimer);
    
    STATE.refreshTimer = setInterval(() => {
        if (STATE.autoRefresh) {
            loadOptionChain();
        }
    }, CONFIG.REFRESH_INTERVAL);
    
    console.log('✅ Auto-refresh started (5s)');
}

function stopAutoRefresh() {
    if (STATE.refreshTimer) {
        clearInterval(STATE.refreshTimer);
        STATE.refreshTimer = null;
    }
    console.log('⏸️ Auto-refresh stopped');
}

// ============================================
// UI Helpers
// ============================================

function showLoader(show) {
    const loader = document.getElementById('loader');
    if (loader) {
        if (show) {
            loader.classList.remove('hidden');
        } else {
            loader.classList.add('hidden');
        }
    }
}

function showAppStatus(message) {
    const statusEl = document.getElementById('statusMsg');
    if (statusEl) {
        statusEl.textContent = message;
    }
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('✅ SW registered'))
            .catch(err => console.error('SW error:', err));
    }
}

console.log('✅ App.js loaded successfully');