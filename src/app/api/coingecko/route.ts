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
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=30&page=1',
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
    
    // Map coins to our expected format and add default categories
    const enrichedCoins = topCoins.map((coin: any) => {
      // Create categories based on coin attributes
      const categories = ['cryptocurrency'];
      
      // Add default categories based on coin symbols
      if (['btc', 'wbtc'].includes(coin.symbol.toLowerCase())) {
        categories.push('bitcoin', 'store-of-value');
      } else if (['eth', 'weth'].includes(coin.symbol.toLowerCase())) {
        categories.push('ethereum', 'smart-contract-platform');
      } else if (['sol', 'wsol'].includes(coin.symbol.toLowerCase())) {
        categories.push('solana', 'layer-1');
      } else if (['arb'].includes(coin.symbol.toLowerCase())) {
        categories.push('arbitrum', 'layer-2', 'scaling');
      } else if (['matic'].includes(coin.symbol.toLowerCase())) {
        categories.push('polygon', 'layer-2', 'scaling');
      } else if (['uni', 'cake', 'sushi'].includes(coin.symbol.toLowerCase())) {
        categories.push('dex', 'defi');
      } else if (['link', 'band'].includes(coin.symbol.toLowerCase())) {
        categories.push('oracle');
      } else if (['doge', 'shib', 'pepe'].includes(coin.symbol.toLowerCase())) {
        categories.push('meme-token');
      } else if (['avax'].includes(coin.symbol.toLowerCase())) {
        categories.push('avalanche', 'layer-1');
      }
      
      return {
        id: coin.id,
        symbol: coin.symbol.toLowerCase(),
        name: coin.name,
        categories: categories
      };
    });
    
    // Update cache
    cachedTokens = enrichedCoins;
    cacheTimestamp = Date.now();
    
    console.log(`Retrieved ${enrichedCoins.length} tokens with categories`);
    return enrichedCoins;
  } catch (error) {
    console.error('Error fetching token data:', error);
    
    if (cachedTokens) {
      console.log('Using cached token data due to error');
      return cachedTokens;
    }
    
    // Return hardcoded top tokens as fallback
    console.log('Using hardcoded top tokens fallback');
    return TOP_TOKENS;
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