// ============================================
// Option Chain Tracker - Vercel Backend
// ============================================

const CONFIG = {
    // Use Vercel serverless function
    API_ENDPOINT: '/api/nse-proxy',
    REFRESH_INTERVAL: 5000,
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
    oiData: {}
};

window.addEventListener('load', async () => {
    console.log('🚀 App starting...');
    setupEventListeners();
    await loadOptionChain();
    startAutoRefresh();
});

async function loadOptionChain() {
    showLoader(true);
    showAppStatus('📡 Loading...', 'info');
    
    try {
        const symbol = STATE.currentSymbol;
        
        // Call Vercel backend
        const url = `${CONFIG.API_ENDPOINT}?symbol=${symbol}`;
        console.log('🔗 Fetching:', url);
        
        const response = await fetch(url);
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Failed to fetch data');
        }
        
        const data = result.data;
        
        if (!data.records || !data.records.data) {
            throw new Error('Invalid data format');
        }
        
        console.log('✅ Data received');
        
        // Process data
        STATE.spotPrice = data.records.underlyingValue;
        const strikeGap = CONFIG.SYMBOLS[symbol].strikeGap;
        STATE.atmStrike = Math.round(STATE.spotPrice / strikeGap) * strikeGap;
        
        // Update UI
        document.getElementById('spotPrice').textContent = STATE.spotPrice.toFixed(2);
        document.getElementById('symbolName').textContent = symbol;
        
        const filteredData = filterStrikes(data.records.data, STATE.atmStrike, strikeGap);
        const processedData = processOptionData(filteredData);
        displayOptionChain(processedData);
        
        const timeStr = new Date().toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        showAppStatus(`✅ ${timeStr}`, 'success');
        document.getElementById('lastUpdate').textContent = timeStr;
        
    } catch (error) {
        console.error('❌ Error:', error);
        showAppStatus(`❌ ${error.message}`, 'error');
        
        if (STATE.autoRefresh) {
            setTimeout(() => loadOptionChain(), 10000);
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

function processOptionData(strikes) {
    const timestamp = Date.now();
    const processedData = [];
    
    for (const strikeData of strikes) {
        const strike = strikeData.strike;
        const key = `${STATE.currentSymbol}_${strike}`;
        
        const ceCurrentOI = strikeData.CE.openInterest || 0;
        const peCurrentOI = strikeData.PE.openInterest || 0;
        
        if (!STATE.oiData[key + '_CE']) {
            STATE.oiData[key + '_CE'] = {
                first: ceCurrentOI,
                history: [{ time: timestamp, oi: ceCurrentOI }]
            };
        }
        
        if (!STATE.oiData[key + '_PE']) {
            STATE.oiData[key + '_PE'] = {
                first: peCurrentOI,
                history: [{ time: timestamp, oi: peCurrentOI }]
            };
        }
        
        const ceHistory = STATE.oiData[key + '_CE'].history;
        const peHistory = STATE.oiData[key + '_PE'].history;
        
        ceHistory.push({ time: timestamp, oi: ceCurrentOI });
        peHistory.push({ time: timestamp, oi: peCurrentOI });
        
        const oneHourAgo = timestamp - 3600000;
        STATE.oiData[key + '_CE'].history = ceHistory.filter(h => h.time > oneHourAgo);
        STATE.oiData[key + '_PE'].history = peHistory.filter(h => h.time > oneHourAgo);
        
        const ceChangeFromStart = ceCurrentOI - STATE.oiData[key + '_CE'].first;
        const peChangeFromStart = peCurrentOI - STATE.oiData[key + '_PE'].first;
        
        const ceTimeframeChange = calculateTimeframeChange(ceHistory, ceCurrentOI);
        const peTimeframeChange = calculateTimeframeChange(peHistory, peCurrentOI);
        
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
    }
    
    return processedData;
}

function calculateTimeframeChange(history, currentOI) {
    const timeframeSeconds = {
        '30s': 30, '1m': 60, '2m': 120, '3m': 180, '5m': 300,
        '10m': 600, '15m': 900, '30m': 1800, '1h': 3600,
        '2h': 7200, '4h': 14400, '1d': 86400
    }[STATE.currentTimeframe] || 60;
    
    const cutoffTime = Date.now() - (timeframeSeconds * 1000);
    const oldData = history.find(h => h.time >= cutoffTime);
    
    return oldData ? currentOI - oldData.oi : 0;
}

function displayOptionChain(data) {
    const container = document.getElementById('optionChainData');
    container.innerHTML = '';
    
    data.forEach(row => {
        const div = document.createElement('div');
        div.className = `strike-row ${row.isATM ? 'atm' : ''}`;
        div.innerHTML = `
            <div class="ce-data">
                <div class="data-section">
                    <div class="label">CE OI</div>
                    <div class="value-big">${formatNumber(row.ce.totalOI)}</div>
                </div>
                <div class="data-section">
                    <div class="label">Change</div>
                    <div class="value-medium ${getClass(row.ce.changeInOI)}">
                        ${formatChange(row.ce.changeInOI)}
                    </div>
                </div>
                <div class="data-section timeframe-section">
                    <div class="label">${STATE.currentTimeframe}</div>
                    <div class="value-medium ${getClass(row.ce.timeframeChange)}">
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
                    <div class="label">PE OI</div>
                    <div class="value-big">${formatNumber(row.pe.totalOI)}</div>
                </div>
                <div class="data-section">
                    <div class="label">Change</div>
                    <div class="value-medium ${getClass(row.pe.changeInOI)}">
                        ${formatChange(row.pe.changeInOI)}
                    </div>
                </div>
                <div class="data-section timeframe-section">
                    <div class="label">${STATE.currentTimeframe}</div>
                    <div class="value-medium ${getClass(row.pe.timeframeChange)}">
                        ${formatChange(row.pe.timeframeChange)}
                    </div>
                </div>
            </div>
        `;
        container.appendChild(div);
    });
}

function formatNumber(n) {
    if (n >= 10000000) return (n/10000000).toFixed(2) + 'Cr';
    if (n >= 100000) return (n/100000).toFixed(2) + 'L';
    if (n >= 1000) return (n/1000).toFixed(2) + 'K';
    return n.toString();
}

function formatChange(n) {
    return (n >= 0 ? '+' : '') + formatNumber(Math.abs(n));
}

function getClass(n) {
    return n >= 0 ? 'positive' : 'negative';
}

function setupEventListeners() {
    document.querySelectorAll('.btn-symbol').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-symbol').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            STATE.currentSymbol = e.target.dataset.symbol;
            STATE.oiData = {};
            loadOptionChain();
        });
    });
    
    document.getElementById('timeframeSelect')?.addEventListener('change', (e) => {
        STATE.currentTimeframe = e.target.value;
        loadOptionChain();
    });
    
    document.getElementById('autoRefresh')?.addEventListener('change', (e) => {
        STATE.autoRefresh = e.target.checked;
        STATE.autoRefresh ? startAutoRefresh() : stopAutoRefresh();
    });
}

function startAutoRefresh() {
    if (STATE.refreshTimer) clearInterval(STATE.refreshTimer);
    STATE.refreshTimer = setInterval(() => {
        if (STATE.autoRefresh) loadOptionChain();
    }, CONFIG.REFRESH_INTERVAL);
}

function stopAutoRefresh() {
    if (STATE.refreshTimer) {
        clearInterval(STATE.refreshTimer);
        STATE.refreshTimer = null;
    }
}

function showLoader(show) {
    document.getElementById('loader')?.classList.toggle('hidden', !show);
}

function showAppStatus(msg) {
    const el = document.getElementById('statusMsg');
    if (el) el.textContent = msg;
}

console.log('✅ App loaded');