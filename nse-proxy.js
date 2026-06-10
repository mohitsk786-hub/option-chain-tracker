// NSE Proxy - Vercel Serverless Function
// This bypasses CORS by making server-side request

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    try {
        const { symbol = 'NIFTY' } = req.query;
        
        console.log('📡 Fetching NSE data for:', symbol);
        
        // First request to set cookies
        const cookieResponse = await fetch('https://www.nseindia.com', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
            }
        });
        
        const cookies = cookieResponse.headers.get('set-cookie') || '';
        
        // Now fetch option chain data
        const nseUrl = `https://www.nseindia.com/api/option-chain-indices?symbol=${symbol}`;
        
        const response = await fetch(nseUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://www.nseindia.com/option-chain',
                'Connection': 'keep-alive',
                'Cookie': cookies
            }
        });
        
        if (!response.ok) {
            throw new Error(`NSE returned ${response.status}`);
        }
        
        const data = await response.json();
        
        console.log('✅ Data fetched successfully');
        
        return res.status(200).json({
            success: true,
            data: data
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}