// ============================================
// Configuration & Global Variables
// ============================================

const CONFIG = {
    API_BASE: 'https://apiconnect.angelbroking.com',
    REFRESH_INTERVAL: 2000, // 2 seconds
    SYMBOLS: {
        NIFTY: { token: '99926000', strikeGap: 50 },
        BANKNIFTY: { token: '99926009', strikeGap: 100 }
    }
};

let STATE = {
    authToken: null,
    apiKey: null,
    currentSymbol: 'NIFTY',
    currentTimeframe: '1m',
    autoRefresh: true,
    refreshTimer: null,
    spotPrice: 0,
    atmStrike: 0
};

// IndexedDB for data storage
let db;

// ============================================
// Initialize App
// ============================================

window.addEventListener('load', () => {
    initDB();
    checkLoginStatus();
    setupEventListeners();
    registerServiceWorker();
});

// ============================================
// IndexedDB Setup
// ============================================

function initDB() {
    const request = indexedDB.open('OptionChainDB', 1);
    
    request.onerror = () => {
        console.error('Database failed to open');
    };
    
    request.onsuccess = () => {
        db = request.result;
        console.log('✅ Database ready');
    };
    
    request.onupgradeneeded = (e) => {
        db = e.target.result;
        
        // Create object store for OI data
        if (!db.objectStoreNames.contains('oiData')) {
            const objectStore = db.objectStore('oiData', { 
                keyPath: 'id', 
                autoIncrement: true 
            });
            objectStore.createIndex('timestamp', 'timestamp', { unique: false });
            objectStore.createIndex('symbol', 'symbol', { unique: false });
            objectStore.createIndex('strike', 'strike', { unique: false });
        }
        
        // Create object store for credentials
        if (!db.objectStoreNames.contains('credentials')) {
            db.createObjectStore('credentials', { keyPath: 'key' });
        }
    };
}

// ============================================
// Service Worker Registration
// ============================================

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('✅ Service Worker registered'))
            .catch(err => console.error('❌ SW registration failed:', err));
    }
}

// ============================================
// Event Listeners
// ============================================

function setupEventListeners() {
    // Login button
    document.getElementById('loginBtn').addEventListener('click', handleLogin);
    
    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    
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
        updateTimeframeDisplay();
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
// Login/Logout Functions
// ============================================

async function handleLogin() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const clientCode = document.getElementById('clientCode').value.trim();
    const password = document.getElementById('password').value.trim();
    const totp = document.getElementById('totp').value.trim();
    
    if (!apiKey || !clientCode || !password) {
        showStatus('Please fill all required fields', 'error');
        return;
    }
    
    showLoader(true);
    showStatus('Logging in...', 'success');
    
    try {
        const response = await fetch(`${CONFIG.API_BASE}/rest/auth/angelbroking/user/v1/loginByPassword`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-UserType': 'USER',
                'X-SourceID': 'WEB',
                'X-ClientLocalIP': 'CLIENT_LOCAL_IP',
                'X-ClientPublicIP': 'CLIENT_PUBLIC_IP',
                'X-MACAddress': 'MAC_ADDRESS',
                'X-PrivateKey': apiKey
            },
            body: JSON.stringify({
                clientcode: clientCode,
                password: password,
                totp: totp || undefined
            })
        });
        
        const data = await response.json();
        
        if (data.status && data.data) {
            STATE.authToken = data.data.jwtToken;
            STATE.apiKey = apiKey;
            
            // Save credentials
            await saveCredentials({
                apiKey: apiKey,
                clientCode: clientCode,
                token: data.data.jwtToken,
                feedToken: data.data.feedToken
            });
            
            showStatus('Login successful!', 'success');
            
            setTimeout(() => {
                switchScreen('appScreen');
                loadOptionChain();
                startAutoRefresh();
            }, 1000);
            
        } else {
            throw new Error(data.message || 'Login failed');
        }
        
    } catch (error) {
        console.error('Login error:', error);
        showStatus(`Login failed: ${error.message}`, 'error');
    } finally {
        showLoader(false);
    }
}

function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        stopAutoRefresh();
        clearCredentials();
        STATE.authToken = null;
        STATE.apiKey = null;
        switchScreen('loginScreen');
    }
}

// ============================================
// Option Chain Functions
// ============================================

async function loadOptionChain() {
    if (!STATE.authToken) {
        showAppStatus('Please login first', 'error');
        return;
    }
    
    showLoader(true);
    showAppStatus('Loading data...', 'info');
    
    try {
        // Get spot price
        const spotData = await getSpotPrice(STATE.currentSymbol);
        STATE.spotPrice = spotData.ltp;
        
        // Calculate ATM strike
        const strikeGap = CONFIG.SYMBOLS[STATE.currentSymbol].strikeGap;
        STATE.atmStrike = Math.round(STATE.spotPrice / strikeGap) * strikeGap;
        
        // Update UI
        document.getElementById('spotPrice').textContent = STATE.spotPrice.toFixed(2);
        document.getElementById('symbolName').textContent = STATE.currentSymbol;
        
        // Generate strikes (ATM ± 5)
        const strikes = [];
        for (let i = -5; i <= 5; i++) {
            strikes.push(STATE.atmStrike + (i * strikeGap));
        }
        
        // Fetch option data for all strikes
        const optionData = await fetchOptionData(strikes);
        
        // Display data
        displayOptionChain(optionData);
        
        showAppStatus(`Updated: ${new Date().toLocaleTimeString()}`, 'success');
        
    } catch (error) {
        console.error('Load option chain error:', error);
        showAppStatus(`Error: ${error.message}`, 'error');
    } finally {
        showLoader(false);
    }
}

async function getSpotPrice(symbol) {
    const token = CONFIG.SYMBOLS[symbol].token;
    
    const response = await fetch(`${CONFIG.API_BASE}/rest/secure/angelbroking/market/v1/quote/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${STATE.authToken}`,
            'X-PrivateKey': STATE.apiKey,
            'X-UserType': 'USER',
            'X-SourceID': 'WEB'
        },
        body: JSON.stringify({
            mode: 'LTP',
            exchangeTokens: {
                'NSE': [token]
            }
        })
    });
    
    const data = await response.json();
    
    if (data.status && data.data && data.data.fetched) {
        return data.data.fetched[0];
    } else {
        throw new Error('Failed to get spot price');
    }
}

async function fetchOptionData(strikes) {
    const timestamp = Date.now();
    const optionData = [];
    
    for (const strike of strikes) {
        const ceOI = await getOIData(strike, 'CE');
        const peOI = await getOIData(strike, 'PE');
        
        // Store in IndexedDB
        await storeOIData(timestamp, STATE.currentSymbol, strike, 'CE', ceOI);
        await storeOIData(timestamp, STATE.currentSymbol, strike, 'PE', peOI);
        
        // Calculate changes
        const ceChange = await calculateOIChange(strike, 'CE', ceOI);
        const peChange = await calculateOIChange(strike, 'PE', peOI);
        
        optionData.push({
            strike: strike,
            isATM: strike === STATE.atmStrike,
            ce: {
                totalOI: ceOI,
                changeOI: ceChange.total,
                timeframeChange: ceChange.timeframe
            },
            pe: {
                totalOI: peOI,
                changeOI: peChange.total,
                timeframeChange: peChange.timeframe
            }
        });
    }
    
    return optionData;
}

async function getOIData(strike, optionType) {
    // Note: You'll need to implement proper symbol token mapping
    // This is a simplified version
    
    try {
        // For demo purposes, returning random data
        // In production, you need actual Angel One API call with proper tokens
        
        const baseOI = 10000 + Math.floor(Math.random() * 50000);
        return baseOI;
        
        /* Actual implementation would be:
        const symbolToken = getSymbolToken(STATE.currentSymbol, strike, optionType);
        
        const response = await fetch(`${CONFIG.API_BASE}/rest/secure/angelbroking/market/v1/quote/`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${STATE.authToken}`,
                'X-PrivateKey': STATE.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                mode: 'FULL',
                exchangeTokens: {
                    'NFO': [symbolToken]
                }
            })
        });
        
        const data = await response.json();
        return data.data.fetched[0].oi || 0;
        */
        
    } catch (error) {
        console.error(`Error getting OI for ${strike}${optionType}:`, error);
        return 0;
    }
}

async function calculateOIChange(strike, optionType, currentOI) {
    // Get historical data from IndexedDB
    const historicalData = await getHistoricalOI(
        STATE.currentSymbol, 
        strike, 
        optionType, 
        STATE.currentTimeframe
    );
    
    let totalChange = 0;
    let timeframeChange = 0;
    
    if (historicalData.length > 0) {
        const firstOI = historicalData[0].oi;
        totalChange = currentOI - firstOI;
        
        // Get timeframe-specific change
        const timeframeSeconds = getTimeframeSeconds(STATE.currentTimeframe);
        const timeframeData = historicalData.filter(d => 
            (Date.now() - d.timestamp) <= (timeframeSeconds * 1000)
        );
        
        if (timeframeData.length > 0) {
            timeframeChange = currentOI - timeframeData[0].oi;
        }
    }
    
    return {
        total: totalChange,
        timeframe: timeframeChange
    };
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
                    Total: ${formatChange(row.ce.changeOI)}
                </div>
                <div class="oi-timeframe">
                    ${STATE.currentTimeframe}: ${formatChange(row.ce.timeframeChange)}
                </div>
            </div>
            
            <div class="strike-value">
                ${row.strike}
            </div>
            
            <div class="pe-data">
                <div class="oi-total">OI: ${formatNumber(row.pe.totalOI)}</div>
                <div class="oi-change ${getChangeClass(row.pe.changeOI)}">
                    Total: ${formatChange(row.pe.changeOI)}
                </div>
                <div class="oi-timeframe">
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
    return sign + formatNumber(num);
}

function getChangeClass(num) {
    return num >= 0 ? 'positive' : 'negative';
}

// ============================================
// Auto Refresh
// ============================================

function startAutoRefresh() {
    if (STATE.refreshTimer) {
        clearInterval(STATE.refreshTimer);
    }
    
    STATE.refreshTimer = setInterval(() => {
        if (STATE.autoRefresh && STATE.authToken) {
            loadOptionChain();
        }
    }, CONFIG.REFRESH_INTERVAL);
}

function stopAutoRefresh() {
    if (STATE.refreshTimer) {
        clearInterval(STATE.refreshTimer);
        STATE.refreshTimer = null;
    }
}

function updateTimeframeDisplay() {
    // Reload data with new timeframe
    if (STATE.authToken) {
        loadOptionChain();
    }
}

// ============================================
// IndexedDB Helper Functions
// ============================================

async function storeOIData(timestamp, symbol, strike, optionType, oi) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['oiData'], 'readwrite');
        const objectStore = transaction.objectStore('oiData');
        
        const data = {
            timestamp: timestamp,
            symbol: symbol,
            strike: strike,
            optionType: optionType,
            oi: oi
        };
        
        const request = objectStore.add(data);
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function getHistoricalOI(symbol, strike, optionType, timeframe) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['oiData'], 'readonly');
        const objectStore = transaction.objectStore('oiData');
        
        const timeframeSeconds = getTimeframeSeconds(timeframe);
        const cutoffTime = Date.now() - (86400 * 1000); // 24 hours
        
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

async function cleanOldData() {
    const cutoffTime = Date.now() - (86400 * 1000); // 24 hours
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['oiData'], 'readwrite');
        const objectStore = transaction.objectStore('oiData');
        const index = objectStore.index('timestamp');
        const range = IDBKeyRange.upperBound(cutoffTime);
        
        const request = index.openCursor(range);
        
        request.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            } else {
                resolve();
            }
        };
        
        request.onerror = () => reject(request.error);
    });
}

// Clean old data every hour
setInterval(cleanOldData, 3600000);

// ============================================
// Credentials Management
// ============================================

async function saveCredentials(credentials) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['credentials'], 'readwrite');
        const objectStore = transaction.objectStore('credentials');
        
        const request = objectStore.put({
            key: 'userCredentials',
            data: credentials
        });
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function getCredentials() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['credentials'], 'readonly');
        const objectStore = transaction.objectStore('credentials');
        
        const request = objectStore.get('userCredentials');
        
        request.onsuccess = () => resolve(request.result?.data);
        request.onerror = () => reject(request.error);
    });
}

async function clearCredentials() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['credentials'], 'readwrite');
        const objectStore = transaction.objectStore('credentials');
        
        const request = objectStore.delete('userCredentials');
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function checkLoginStatus() {
    const credentials = await getCredentials();
    
    if (credentials && credentials.token) {
        STATE.authToken = credentials.token;
        STATE.apiKey = credentials.apiKey;
        switchScreen('appScreen');
        loadOptionChain();
        startAutoRefresh();
    }
}

// ============================================
// UI Helper Functions
// ============================================

function switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

function showLoader(show) {
    const loader = document.getElementById('loader');
    if (show) {
        loader.classList.remove('hidden');
    } else {
        loader.classList.add('