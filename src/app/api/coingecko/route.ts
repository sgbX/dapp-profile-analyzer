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

export async function GET(request: Request) {
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

    // Get the query parameters from the request
    const { searchParams } = new URL(request.url);
    const includePlatform = searchParams.get('include_platform') || 'false';

    // Make the request to CoinGecko
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/list?include_platform=${includePlatform}`,
      {
        headers: {
          'x-cg-pro-api-key': process.env.COINGECKO_API_KEY || '',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        cache: 'no-store'
      }
    );

    if (!response.ok) {
      // Try to extract error message from response
      let errorMessage = `CoinGecko API error: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.error || errorData.message) {
          errorMessage = `CoinGecko API error: ${errorData.error || errorData.message}`;
        }
      } catch (e) {
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
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        }
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': reset.toString(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
} 