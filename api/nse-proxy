export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const symbol = req.query.symbol || "NIFTY";
    
    console.log(`Fetching data for ${symbol}`);

    // Headers for NSE
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Referer": "https://www.nseindia.com/",
      "Connection": "keep-alive"
    };

    // Step 1: Get NSE homepage for cookies
    const homeResponse = await fetch("https://www.nseindia.com", {
      method: "GET",
      headers: headers
    });

    // Get cookies
    let cookies = "";
    const setCookie = homeResponse.headers.get("set-cookie");
    if (setCookie) {
      cookies = setCookie.split(",").map(c => c.split(";")[0]).join("; ");
    }

    console.log("Cookies obtained");

    // Step 2: Fetch option chain data
    const apiUrl = `https://www.nseindia.com/api/option-chain-indices?symbol=${encodeURIComponent(symbol)}`;

    const dataResponse = await fetch(apiUrl, {
      method: "GET",
      headers: {
        ...headers,
        "Accept": "application/json",
        "Referer": "https://www.nseindia.com/option-chain",
        "Cookie": cookies
      }
    });

    const contentType = dataResponse.headers.get("content-type");
    
    if (!dataResponse.ok) {
      const errorText = await dataResponse.text();
      console.error(`NSE Error ${dataResponse.status}:`, errorText.substring(0, 200));
      
      return res.status(dataResponse.status).json({
        success: false,
        error: `NSE API returned ${dataResponse.status}`,
        details: errorText.substring(0, 200)
      });
    }

    // Check if response is JSON
    if (!contentType || !contentType.includes("application/json")) {
      const text = await dataResponse.text();
      console.error("Non-JSON response:", text.substring(0, 200));
      
      return res.status(500).json({
        success: false,
        error: "NSE did not return JSON",
        contentType: contentType,
        preview: text.substring(0, 200)
      });
    }

    const data = await dataResponse.json();

    console.log("Data fetched successfully");

    return res.status(200).json({
      success: true,
      symbol: symbol,
      data: data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Function error:", error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined
    });
  }
}
