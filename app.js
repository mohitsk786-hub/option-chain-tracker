const CONFIG = {
    API_ENDPOINT: '/api/proxy',
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
    oiData: {},
    isFirstLoad: true
};

window.addEventListener('load', async () => {
    console.log('🚀 App Started');
    setupEventListeners();
    await loadOptionChain();
    startAutoRefresh();
});

async function loadOptionChain() {
    showLoader(true);
    showAppStatus('📡 Loading...', 'info');
    
    try {
        const symbol = STATE.currentSymbol;
        const url = `/api/proxy?symbol=${symbol}`;
        
        console.log('🔗 API Call:', url);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`HTTP ${response.status}: ${text.substring(0, 100)}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'API failed');
        }
        
        const data = result.data;
        
        if (!data.records || !data.records.data) {
            throw new Error('Invalid data');
        }
        
        console.log('✅ Data OK');
        
        STATE.spotPrice = data.records.underlyingValue;
        const strikeGap = CONFIG.SYMBOLS[symbol].strikeGap;
        STATE.atmStrike = Math.round(STATE.spotPrice / strikeGap) * strikeGap;
        
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
        
        if (STATE.isFirstLoad) {
            STATE.isFirstLoad = false;
        }
        
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
        
        const oneDayAgo = timestamp - 86400000;
        STATE.oiData[key + '_CE'].history = ceHistory.filter(h => h.time > oneDayAgo);
        STATE.oiData[key + '_PE'].history = peHistory.filter(h => h.time > oneDayAgo);
        
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
    const timeframeSeconds = getTimeframeSeconds(STATE.currentTimeframe);
    const cutoffTime = Date.now() - (timeframeSeconds * 1000);
    const oldData = history.find(h => h.time >= cutoffTime);
    return oldData ? currentOI - oldData.oi : 0;
}

function getTimeframeSeconds(timeframe) {
    const map = {
        '30s': 30, '1m': 60, '2m': 120, '3m': 180, '5m': 300,
        '10m': 600, '15m': 900, '30m': 1800, '1h': 3600,
        '2h': 7200, '4h': 14400, '1d': 86400
    };
    return map[timeframe] || 60;
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
                    <div class="label">Total OI</div>
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
                    <div class="label">Total OI</div>
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
        
        container.appendChild(div);
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
    
    const tfSelect = document.getElementById('timeframeSelect');
    if (tfSelect) {
        tfSelect.addEventListener('change', (e) => {
            STATE.currentTimeframe = e.target.value;
            loadOptionChain();
        });
    }
    
    const autoRefresh = document.getElementById('autoRefresh');
    if (autoRefresh) {
        autoRefresh.addEventListener('change', (e) => {
            STATE.autoRefresh = e.target.checked;
            STATE.autoRefresh ? startAutoRefresh() : stopAutoRefresh();
        });
    }
}

function startAutoRefresh() {
    if (STATE.refreshTimer) clearInterval(STATE.refreshTimer);
    STATE.refreshTimer = setInterval(() => {
        if (STATE.autoRefresh) loadOptionChain();
    }, CONFIG.REFRESH_INTERVAL);
    console.log('✅ Auto-refresh ON');
}

function stopAutoRefresh() {
    if (STATE.refreshTimer) {
        clearInterval(STATE.refreshTimer);
        STATE.refreshTimer = null;
    }
    console.log('⏸️ Auto-refresh OFF');
}

function showLoader(show) {
    const loader = document.getElementById('loader');
    if (loader) loader.classList.toggle('hidden', !show);
}

function showAppStatus(message) {
    const el = document.getElementById('statusMsg');
    if (el) el.textContent = message;
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(() => console.log('✅ SW OK'))
        .catch(err => console.error('SW error:', err));
}

console.log('✅ App.js loaded');
