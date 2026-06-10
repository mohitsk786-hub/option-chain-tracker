// ============================================
// NSE Option Chain Tracker - Vercel Ready
// Real-time OI Analysis
// ============================================

const CONFIG = {
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
    oiData: {},
    isFirstLoad: true
};

// ============================================
// Initialize
// ============================================

window.addEventListener('load', async () => {
    console.log('🚀 App Started');
    setupEventListeners();
    await loadOptionChain();
    startAutoRefresh();
});

// ============================================
// Load Option Chain
// ============================================

async function loadOptionChain() {
    showLoader(true);
    showAppStatus('📡 Loading...', 'info');
    
    try {
        const symbol = STATE.currentSymbol;
        const url = `/api/nse-proxy?symbol=${symbol}`;
        
        console.log('🔗 Fetching:', url);
        
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
            throw new Error('Invalid data format');
        }
        
        console.log('✅ Data received');
        
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

// ============================================
// Filter Strikes
// ============================================

function filterStrikes(data, atmStrike, strikeGap) {
    const strikes = [];
    
    for (let i = -5; i <= 5; i++) {
        const strike = atmStrike + (i * strikeGap);
        const strikeData =