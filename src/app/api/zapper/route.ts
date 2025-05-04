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

export async function POST(request: Request) {
  try {
    // Apply rate limiting if configured
    if (ratelimit) {
      const identifier = 'api-rate-limit';
      const { success, limit, reset, remaining } = await ratelimit.limit(identifier);
      
      if (!success) {
        return NextResponse.json(
          { error: 'Rate limit exceeded' },
          { 
            status: 429,
            headers: {
              'X-RateLimit-Limit': limit.toString(),
              'X-RateLimit-Remaining': remaining.toString(),
              'X-RateLimit-Reset': reset.toString()
            }
          }
        );
      }
    }
    
    // Check for API key
    const apiKey = process.env.ZAPPER_API_KEY || '';
    if (!apiKey) {
      console.error('Missing ZAPPER_API_KEY environment variable');
      return NextResponse.json(
        { error: 'Server configuration error: Missing API key' },
        { status: 500 }
      );
    }
    
    // Parse request body
    const requestBody = await request.json();
    console.log('Request body:', requestBody);
    
    // Extract GraphQL query and variables
    const { query, variables } = requestBody;
    
    if (!query) {
      return NextResponse.json(
        { error: 'Missing GraphQL query' },
        { status: 400 }
      );
    }
    
    // Extract wallet addresses for logging
    const addresses = variables?.addresses || [];
    console.log('Wallet addresses:', addresses);
    
    // Try to detect wallet type for better error handling
    if (addresses[0]) {
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addresses[0]) && !addresses[0].startsWith('0x')) {
        console.log('Detected Solana wallet address');
      } else if (/^0x[a-fA-F0-9]{40}$/.test(addresses[0])) {
        console.log('Detected Ethereum-compatible wallet address');
      }
    }
    
    // Log API key (partially masked)
    console.log(`Making request to Zapper with API key: ${apiKey.slice(0, 3)}...`);
    
    // If networks are specified, log them
    if (variables?.networks) {
      console.log(`Making request to Zapper with ${variables.networks.length} networks for address: ${addresses[0]}`);
    }
    
    // Make request to Zapper GraphQL API
    const response = await fetch('https://public.zapper.xyz/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zapper-api-key': apiKey,
      },
      body: JSON.stringify({
        query,
        variables
      })
    });

    if (!response.ok) {
      throw new Error(`Zapper API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Check for GraphQL errors
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      
      // Handle invalid network errors
      const invalidNetworkErrors = data.errors.filter((error: any) => 
        error.message.includes('does not exist in "Network" enum')
      );
      
      if (invalidNetworkErrors.length > 0) {
        // Extract suggested networks from error messages
        const suggestionPattern = /Did you mean the enum value "([^"]+)"/;
        const suggestedNetworks = new Set<string>();
        
        invalidNetworkErrors.forEach((error: any) => {
          const match = error.message.match(suggestionPattern);
          if (match && match[1]) {
            suggestedNetworks.add(match[1]);
          }
        });
        
        console.log('Suggested networks:', Array.from(suggestedNetworks));
        
        // If variables contains networks, try to filter out invalid ones
        if (variables?.networks && variables.networks.length > 0 && invalidNetworkErrors.length < variables.networks.length) {
          // Extract invalid networks from error messages
          const invalidNetworks = invalidNetworkErrors.map((error: any) => {
            const match = error.message.match(/got invalid value "([^"]+)"/);
            return match && match[1];
          }).filter(Boolean);
          
          // Filter out invalid networks
          const validNetworks = variables.networks.filter((network: string) => 
            !invalidNetworks.includes(network)
          );
          
          // Add suggested networks
          Array.from(suggestedNetworks).forEach((network: string) => {
            if (!validNetworks.includes(network)) {
              validNetworks.push(network);
            }
          });
          
          // Retry with valid networks
          console.log('Retrying with valid networks:', validNetworks);
          
          const retryResponse = await fetch('https://public.zapper.xyz/graphql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-zapper-api-key': apiKey,
            },
            body: JSON.stringify({
              query,
              variables: {
                ...variables,
                networks: validNetworks
              }
            })
          });
          
          if (!retryResponse.ok) {
            throw new Error(`Zapper API retry error: ${retryResponse.status} ${retryResponse.statusText}`);
          }
          
          const retryData = await retryResponse.json();
          
          if (retryData.errors) {
            console.error('Retry GraphQL errors:', retryData.errors);
            return NextResponse.json(
              { error: 'GraphQL Error', details: retryData.errors[0].message, errors: retryData.errors },
              { status: 400 }
            );
          }
          
          return NextResponse.json(retryData);
        }
        
        return NextResponse.json(
          { 
            error: 'Invalid networks specified', 
            details: 'Some networks are not supported by Zapper API',
            suggestedNetworks: Array.from(suggestedNetworks),
            errors: data.errors 
          },
          { status: 400 }
        );
      }
      
      return NextResponse.json(
        { error: 'GraphQL Error', details: data.errors[0].message, errors: data.errors },
        { status: 400 }
      );
    }
    
    // Process the token data for logging
    const edges = data.data?.portfolioV2?.tokenBalances?.byToken?.edges || [];
    
    if (edges.length > 0) {
      console.log(`Found ${edges.length} tokens`);
      
      // Log details of each token
      let totalValue = 0;
      const networksFound = new Set<string>();
      
      edges.forEach((edge: any) => {
        const token = edge.node;
        const balanceUSD = parseFloat(token.balanceUSD || 0);
        
        console.log(`Token: ${token.symbol} on ${token.network.name} - Balance: ${token.balance} (${balanceUSD} USD)`);
        totalValue += balanceUSD;
        networksFound.add(token.network.name);
      });
      
      console.log(`Total portfolio value: $${totalValue.toFixed(2)}`);
      console.log(`Networks found: ${Array.from(networksFound).join(', ')}`);
    } else {
      console.log('No tokens found for this wallet');
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching portfolio data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio data', details: error instanceof Error ? error.message : String(error) },
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