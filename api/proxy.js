export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const symbol = req.query.symbol || "NIFTY";

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.nseindia.com/"
    };

    const homeRes = await fetch("https://www.nseindia.com", { headers });
    const cookies = homeRes.headers.get("set-cookie") || "";

    const apiUrl = `https://www.nseindia.com/api/option-chain-indices?symbol=${symbol}`;

    const dataRes = await fetch(apiUrl, {
      headers: {
        ...headers,
        "Cookie": cookies,
        "Referer": "https://www.nseindia.com/option-chain"
      }
    });

    if (!dataRes.ok) {
      return res.status(500).json({
        success: false,
        error: `NSE returned ${dataRes.status}`
      });
    }

    const data = await dataRes.json();

    return res.status(200).json({
      success: true,
      data: data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
