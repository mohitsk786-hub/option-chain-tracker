// NSE Proxy - Serverless Function for Vercel
// Bypasses CORS and fetches real NSE data

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    try {
        const { symbol = 'NIFTY' } = req.query;
        
        console.log(`📡 Fetching NSE data for: ${symbol}`);
        
        // Step 1: Visit NSE homepage to set cookies
        const baseHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive'
        };
        
        // Get cookies from homepage
        const homeResponse = await fetch('https://www.nseindia.com', {
            headers: baseHeaders
        });
        
        const setCookieHeaders = homeResponse.headers.raw()['set-cookie'];
        const cookies = setCookieHeaders ? setCookieHeaders.join('; ') : '';
        
        console.log('🍪 Cookies obtained');
        
        // Step 2: Fetch option chain data with cookies
        const apiUrl = `https://www.nseindia.com/api/option-chain-indices?symbol=${symbol}`;
        
        const dataResponse = await fetch(apiUrl, {
            headers: {
                ...baseHeaders,
                'Accept': 'application/json',
                'Referer': 'https://www.nseindia.com/option-chain',
                'X-Requested-With': 'XMLHttpRequest',
                'Cookie': cookies
            }
        });
        
        if (!dataResponse.ok) {
            throw new Error(`NSE API returned status: ${dataResponse.status}`);
        }
        
        const data = await dataResponse.json();
        
        console.log('✅ Data fetched successfully');
        
        // Return success response
        return res.status(200).json({
            success: true,
            data: data,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        
        return res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}