import { NextResponse } from 'next/server';

// Use the __type introspection query to get all enum values
const NETWORKS_QUERY = `
  query GetNetworkEnumValues {
    __type(name: "Network") {
      enumValues {
        name
      }
    }
  }
`;

// Cache the networks for 24 hours to avoid too many introspection queries
let cachedNetworks: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export async function GET() {
  try {
    // Check if we have a valid cache
    const now = Date.now();
    if (cachedNetworks && (now - cacheTimestamp) < CACHE_DURATION) {
      console.log('Using cached networks list:', cachedNetworks.length);
      return NextResponse.json({
        supportedNetworks: cachedNetworks.map(name => ({ name })),
        networkIds: cachedNetworks,
        count: cachedNetworks.length,
        fromCache: true
      }, {
        headers: {
          'Cache-Control': 'public, max-age=86400',
        }
      });
    }
    
    console.log('Fetching networks from Zapper API...');
    
    // Check for API key
    const apiKey = process.env.ZAPPER_API_KEY || '';
    if (!apiKey) {
      console.error('Missing ZAPPER_API_KEY environment variable');
      return NextResponse.json(
        { error: 'Server configuration error: Missing API key' },
        { status: 500 }
      );
    }
    
    // Make request to Zapper GraphQL API
    const response = await fetch('https://public.zapper.xyz/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zapper-api-key': apiKey,
      },
      body: JSON.stringify({
        query: NETWORKS_QUERY
      }),
      next: { revalidate: 86400 } // Revalidate once per day
    });

    if (!response.ok) {
      throw new Error(`Zapper API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Check for GraphQL errors
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      
      // Check if we have cached networks as a fallback
      if (cachedNetworks) {
        console.log('Using cached networks as fallback due to GraphQL error');
        return NextResponse.json({
          supportedNetworks: cachedNetworks.map(name => ({ name })),
          networkIds: cachedNetworks,
          count: cachedNetworks.length,
          fromCache: true,
          warning: 'Using cached networks due to GraphQL error'
        });
      }
      
      return NextResponse.json(
        { error: 'GraphQL Error', details: data.errors[0].message },
        { status: 400 }
      );
    }
    
    // Extract the network enum values
    const enumValues = data.data?.__type?.enumValues || [];
    console.log(`Found ${enumValues.length} network enum values`);
    
    // Create array of network IDs
    const networkIds = enumValues.map((value: any) => value.name);
    
    // Update cache
    cachedNetworks = networkIds;
    cacheTimestamp = now;
    
    console.log('Network IDs:', networkIds.join(', '));
    
    // Default networks to use if something goes wrong
    const DEFAULT_NETWORKS = [
      'ETHEREUM_MAINNET',
      'POLYGON_MAINNET',
      'OPTIMISM_MAINNET', 
      'ARBITRUM_MAINNET',
      'BINANCE_SMART_CHAIN_MAINNET',
      'AVALANCHE_MAINNET',
      'FANTOM_OPERA_MAINNET',
      'SOLANA_MAINNET',
      'BASE_MAINNET',
      'BLAST_MAINNET',
      'ZKSYNC_MAINNET',
      'LINEA_MAINNET',
    ];
    
    // Ensure some important networks are included
    const includedNetworkIds = [...new Set([...networkIds, ...DEFAULT_NETWORKS])];
    
    return NextResponse.json({
      supportedNetworks: enumValues,
      networkIds: includedNetworkIds,
      count: includedNetworkIds.length
    }, {
      headers: {
        'Cache-Control': 'public, max-age=86400',
      }
    });
  } catch (error) {
    console.error('Error fetching networks:', error);
    
    // Check if we have cached networks as a fallback
    if (cachedNetworks) {
      console.log('Using cached networks as fallback due to error');
      return NextResponse.json({
        supportedNetworks: cachedNetworks.map(name => ({ name })),
        networkIds: cachedNetworks,
        count: cachedNetworks.length,
        fromCache: true,
        warning: 'Using cached networks due to API error'
      });
    }
    
    // If no cache, use hardcoded defaults
    const DEFAULT_NETWORKS = [
      'ETHEREUM_MAINNET',
      'POLYGON_MAINNET',
      'OPTIMISM_MAINNET', 
      'ARBITRUM_MAINNET',
      'BINANCE_SMART_CHAIN_MAINNET',
      'AVALANCHE_MAINNET',
      'FANTOM_OPERA_MAINNET',
      'SOLANA_MAINNET',
      'BASE_MAINNET',
      'BLAST_MAINNET',
      'ZKSYNC_MAINNET',
      'LINEA_MAINNET',
    ];
    
    return NextResponse.json({
      supportedNetworks: DEFAULT_NETWORKS.map(name => ({ name })),
      networkIds: DEFAULT_NETWORKS,
      count: DEFAULT_NETWORKS.length,
      fromCache: false,
      warning: 'Using default networks due to API error',
      error: error instanceof Error ? error.message : String(error)
    });
  }
} 