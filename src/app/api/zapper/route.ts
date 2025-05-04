import { NextResponse } from 'next/server';

// Simple in-memory rate limiter
class SimpleRateLimiter {
  private requests: Record<string, { count: number, resetTime: number }> = {};
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async check(key: string): Promise<{ success: boolean, maxRequests: number, reset: number, remaining: number }> {
    const now = Date.now();
    const resetTime = now + this.windowMs;

    // Clean up expired entries
    for (const k in this.requests) {
      if (this.requests[k].resetTime < now) {
        delete this.requests[k];
      }
    }

    // Initialize or get current request data
    if (!this.requests[key] || this.requests[key].resetTime < now) {
      this.requests[key] = { count: 0, resetTime };
    }

    // Increment request count
    this.requests[key].count++;

    // Calculate remaining requests
    const remaining = Math.max(0, this.maxRequests - this.requests[key].count);

    return {
      success: this.requests[key].count <= this.maxRequests,
      maxRequests: this.maxRequests,
      reset: Math.ceil((this.requests[key].resetTime - now) / 1000),
      remaining
    };
  }
}

// Initialize rate limiter (10 requests per 10 seconds)
const rateLimiter = new SimpleRateLimiter(10, 10000);

export async function POST(request: Request) {
  try {
    // Get the IP address from the request
    const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
    
    // Check rate limit
    const { success, maxRequests, reset, remaining } = await rateLimiter.check(ip);
    
    if (!success) {
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': maxRequests.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
          },
        }
      );
    }

    // Parse the request body
    const body = await request.json();
    console.log('Request body:', JSON.stringify(body, null, 2));
    
    // Check for API key
    const apiKey = process.env.ZAPPER_API_KEY || '';
    if (!apiKey) {
      console.error('Missing ZAPPER_API_KEY environment variable');
      return NextResponse.json(
        { error: 'Server configuration error: Missing API key' },
        { status: 500 }
      );
    }
    
    // Debug the wallet address format
    if (body.variables && body.variables.addresses) {
      const addresses = body.variables.addresses;
      console.log('Wallet addresses:', addresses);
      
      // Special handling for Solana addresses
      if (addresses.some((addr: string) => {
        // Check if it's likely a Solana address (base58 encoded, 32-44 chars)
        return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr) && !/^0x/.test(addr);
      })) {
        console.log('Detected Solana wallet address');
        
        // Make sure SOLANA_MAINNET is included in networks
        if (body.variables.networks && 
            !body.variables.networks.includes('SOLANA_MAINNET')) {
          body.variables.networks = ['SOLANA_MAINNET', ...body.variables.networks];
        }
        
        // Log the modified request body
        console.log('Modified request body:', JSON.stringify(body, null, 2));
      }
    }
    
    console.log('Making request to Zapper with API key:', apiKey.substring(0, 3) + '...');
    
    // Make the request to Zapper
    const response = await fetch('https://public.zapper.xyz/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zapper-api-key': apiKey,
      },
      body: JSON.stringify(body),
      cache: 'no-store'
    });

    if (!response.ok) {
      // Try to extract error message from response
      let errorMessage = `Zapper API error: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        console.error('Zapper API error response:', JSON.stringify(errorData, null, 2));
        if (errorData.error || errorData.message || (errorData.errors && errorData.errors.length > 0)) {
          errorMessage = `Zapper API error: ${errorData.error || errorData.message || (errorData.errors && errorData.errors[0].message)}`;
        }
      } catch (e) {
        console.error('Error parsing error response:', e);
        // If we can't parse the error response, just use the status text
      }
      console.error(errorMessage);
      return NextResponse.json(
        { error: errorMessage },
        { 
          status: response.status,
          headers: {
            'X-RateLimit-Limit': maxRequests.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        }
      );
    }

    const data = await response.json();
    console.log('Zapper API response:', JSON.stringify(data, null, 2).substring(0, 200) + '...');

    return NextResponse.json(data, {
      headers: {
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': reset.toString(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Handle OPTIONS requests for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
} 