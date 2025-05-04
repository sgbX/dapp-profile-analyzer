import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Set up rate limiting
let ratelimit: Ratelimit | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  
  ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1m'),
    analytics: true,
  });
}

// Cache the token data to avoid frequent API calls
let cachedTokens: any[] | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Top tokens to use when API fails or as fallback
const TOP_TOKENS = [
  {
    id: "bitcoin",
    symbol: "btc",
    name: "Bitcoin",
    categories: ["cryptocurrency"]
  },
  {
    id: "ethereum",
    symbol: "eth",
    name: "Ethereum",
    categories: ["smart-contract-platform", "defi"]
  },
  {
    id: "solana",
    symbol: "sol",
    name: "Solana",
    categories: ["smart-contract-platform", "layer-1"]
  },
  {
    id: "arbitrum",
    symbol: "arb",
    name: "Arbitrum",
    categories: ["layer-2", "scaling"]
  },
  {
    id: "dogecoin",
    symbol: "doge",
    name: "Dogecoin",
    categories: ["meme-token"]
  },
  {
    id: "shiba-inu",
    symbol: "shib",
    name: "Shiba Inu",
    categories: ["meme-token"]
  },
  {
    id: "chainlink",
    symbol: "link",
    name: "Chainlink",
    categories: ["oracle"]
  },
  {
    id: "uniswap",
    symbol: "uni",
    name: "Uniswap",
    categories: ["dex", "defi"]
  },
  {
    id: "polkadot",
    symbol: "dot",
    name: "Polkadot",
    categories: ["interoperability"]
  },
  {
    id: "avalanche-2",
    symbol: "avax",
    name: "Avalanche",
    categories: ["smart-contract-platform", "layer-1"]
  }
];

// Expanded category mapping to capture more relationships between tokens
const CATEGORY_MAPPING: Record<string, string[]> = {
  // Networks and chains
  "bnb": ["binance-coin", "bnb-chain", "bsc", "binance-smart-chain"],
  "ethereum": ["eth", "erc20", "ethereum-ecosystem", "eth-ecosystem"],
  "solana": ["sol", "solana-ecosystem", "sol-ecosystem"],
  "polygon": ["matic", "polygon-ecosystem", "polygon-network"],
  "arbitrum": ["arb", "layer-2", "ethereum-layer-2", "scaling"],
  "optimism": ["op", "layer-2", "ethereum-layer-2", "scaling"],
  "avalanche": ["avax", "layer-1"],
  "fantom": ["ftm", "layer-1"],
  "base": ["layer-2", "ethereum-layer-2", "coinbase-ecosystem"],
  "blast": ["ethereum-layer-2", "scaling"],
  "zksync": ["layer-2", "ethereum-layer-2", "zk-rollup", "scaling"],
  "linea": ["layer-2", "ethereum-layer-2", "scaling"],
  
  // Token types
  "meme": ["meme-token", "meme-coin", "pepe", "doge"],
  "pepe": ["meme-token", "meme-coin"],
  "fartcoin": ["meme-token", "meme-coin"],
  "lend": ["lending", "borrowing", "defi", "yield"],
  "defi": ["decentralized-finance", "yield", "liquidity"],
  "dex": ["decentralized-exchange", "swap", "amm"],
  "gold": ["commodities", "precious-metals", "store-of-value"],
  "layer": ["layer-1", "layer-2", "scaling", "blockchain"],
  
  // Special mappings for tokens in the user's wallet
  "broccoli": ["food-related", "meme-token", "new-listings"],
  "morgan": ["finance", "investment", "defi"],
  "mnl": ["gaming", "utility-token"],
  "ban": ["meme-token", "community-token"],
  "bobby": ["nft", "meme-token", "community-token"],
  "bkok": ["adult-content", "entertainment", "meme-token"],
  "poseidon": ["gaming", "metaverse", "mythology-inspired"],
  "rfc": ["utility-token", "protocol-token"],
  "synx": ["privacy", "utility-token"],
  "tq": ["gaming", "utility-token"],
  "dct": ["utility-token", "infrastructure"],
  "neurox": ["ai", "technology", "utility-token"],
  "ontropy": ["ai", "data", "utility-token"],
  "top": ["utility-token", "exchange-token"],
};

// Helper function to fetch token data from CoinGecko
async function fetchTokensWithCategories() {
  if (cachedTokens && (Date.now() - cacheTimestamp) < CACHE_DURATION) {
    console.log('Using cached token data');
    return cachedTokens;
  }
  
  console.log('Fetching token data from CoinGecko');
  
  try {
    // Use a simpler approach to avoid rate limiting and errors
    // First try to get top tokens with a single request
    const coinsResponse = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1',
      {
        headers: {
          'x-cg-pro-api-key': process.env.COINGECKO_API_KEY || '',
          'Accept': 'application/json',
        },
        next: { revalidate: 3600 } // Revalidate once per hour
      }
    );
    
    if (!coinsResponse.ok) {
      console.warn(`CoinGecko markets API error: ${coinsResponse.status} ${coinsResponse.statusText}`);
      throw new Error('Unable to fetch from CoinGecko API');
    }
    
    const topCoins = await coinsResponse.json();
    
    // Fetch additional category data for better recommendations
    // This makes a separate request to get category information
    let categoryData: Record<string, string[]> = {};
    try {
      const categoriesResponse = await fetch(
        'https://api.coingecko.com/api/v3/coins/categories/list',
        {
          headers: {
            'x-cg-pro-api-key': process.env.COINGECKO_API_KEY || '',
            'Accept': 'application/json',
          },
          next: { revalidate: 86400 } // Revalidate once per day
        }
      );
      
      if (categoriesResponse.ok) {
        const categories = await categoriesResponse.json();
        // Create a mapping of category ID to category name
        categories.forEach((cat: any) => {
          const id = cat.category_id.toLowerCase();
          const name = cat.name.toLowerCase();
          categoryData[id] = [name];
        });
        console.log(`Loaded ${Object.keys(categoryData).length} categories from CoinGecko`);
      }
    } catch (error) {
      console.warn('Failed to fetch category data, using default mappings only');
    }
    
    // Map coins to our expected format and add enriched categories
    const enrichedCoins = topCoins.map((coin: any) => {
      // Start with the base categories
      const categories: string[] = ['cryptocurrency'];
      const symbol = coin.symbol.toLowerCase();
      
      // Add default categories based on coin symbols
      if (['btc', 'wbtc'].includes(symbol)) {
        categories.push(...['bitcoin', 'store-of-value']);
      } else if (['eth', 'weth'].includes(symbol)) {
        categories.push(...['ethereum', 'smart-contract-platform']);
      } else if (['sol', 'wsol'].includes(symbol)) {
        categories.push(...['solana', 'layer-1']);
      } else if (['arb'].includes(symbol)) {
        categories.push(...['arbitrum', 'layer-2', 'scaling']);
      } else if (['matic'].includes(symbol)) {
        categories.push(...['polygon', 'layer-2', 'scaling']);
      } else if (['uni', 'cake', 'sushi'].includes(symbol)) {
        categories.push(...['dex', 'defi']);
      } else if (['link', 'band'].includes(symbol)) {
        categories.push(...['oracle']);
      } else if (['doge', 'shib', 'pepe', 'bonk'].includes(symbol)) {
        categories.push(...['meme-token']);
      } else if (['avax'].includes(symbol)) {
        categories.push(...['avalanche', 'layer-1']);
      }
      
      // Add categories from our extended mapping if they exist
      for (const [key, mappedCategories] of Object.entries(CATEGORY_MAPPING)) {
        if (
          symbol.includes(key.toLowerCase()) || 
          coin.name.toLowerCase().includes(key.toLowerCase())
        ) {
          categories.push(...mappedCategories);
        }
      }
      
      // Make sure we don't have duplicate categories
      const uniqueCategories = [...new Set(categories)];
      
      return {
        id: coin.id,
        symbol: symbol,
        name: coin.name,
        categories: uniqueCategories,
        market_cap: coin.market_cap || 0,
        price_change_24h: coin.price_change_percentage_24h || 0,
        image: coin.image || '',
      };
    });
    
    // Update cache
    cachedTokens = enrichedCoins;
    cacheTimestamp = Date.now();
    
    console.log(`Retrieved ${enrichedCoins.length} tokens with enriched categories`);
    return enrichedCoins;
  } catch (error) {
    console.error('Error fetching token data:', error);
    
    if (cachedTokens) {
      console.log('Using cached token data due to error');
      return cachedTokens;
    }
    
    // Return hardcoded top tokens as fallback with expanded categories
    console.log('Using hardcoded top tokens fallback with expanded categories');
    return TOP_TOKENS.map(token => {
      const expandedCategories = [...token.categories];
      const key = token.symbol.toLowerCase();
      
      if (CATEGORY_MAPPING[key]) {
        expandedCategories.push(...CATEGORY_MAPPING[key]);
      }
      
      return {
        ...token,
        categories: [...new Set(expandedCategories)]
      };
    });
  }
}

export async function GET(request: Request) {
  try {
    // Apply rate limiting if configured
    if (ratelimit) {
      const identifier = 'api-rate-limit-coingecko';
      const { success, limit, reset, remaining } = await ratelimit.limit(identifier);
      
      if (!success) {
        return NextResponse.json(
          { error: 'Rate limit exceeded' },
          {
            status: 429,
            headers: {
              'X-RateLimit-Limit': limit.toString(),
              'X-RateLimit-Remaining': remaining.toString(),
              'X-RateLimit-Reset': reset.toString(),
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
          }
        );
      }
    }

    // Get the query parameters from the request
    const { searchParams } = new URL(request.url);
    const includePlatform = searchParams.get('include_platform') === 'true';
    
    // Fetch token data with categories
    const tokensData = await fetchTokensWithCategories();

    return NextResponse.json(tokensData, {
      headers: {
        'Cache-Control': 'public, max-age=1800', // 30 minutes
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  } catch (error) {
    console.error('CoinGecko API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch token data', details: error instanceof Error ? error.message : String(error) },
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      }
    );
  }
}

// Handle OPTIONS requests for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
} 