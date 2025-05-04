'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

const NETWORKS = [
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

const PORTFOLIO_QUERY = `
  query PortfolioV2($addresses: [Address!]!, $networks: [Network!]) {
    portfolioV2(addresses: $addresses, networks: $networks) {
      tokenBalances {
        byToken {
          edges {
            node {
              balance
              balanceRaw
              balanceUSD
              symbol
              name
              price
              imgUrlV2
              network {
                name
                chainId
              }
            }
          }
        }
      }
    }
  }
`;

// Default networks to use as fallback
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

export default function Home() {
  const [walletAddress, setWalletAddress] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supportedNetworks, setSupportedNetworks] = useState<string[]>(DEFAULT_NETWORKS);

  // Fetch supported networks from our API
  useQuery({
    queryKey: ['networks'],
    queryFn: async () => {
      try {
        const response = await axios.get('/api/networks');
        if (response.data && response.data.networkIds && response.data.networkIds.length > 0) {
          setSupportedNetworks(response.data.networkIds);
          console.log(`Loaded ${response.data.networkIds.length} networks from API`);
        }
        return response.data;
      } catch (err) {
        console.error('Failed to fetch networks:', err);
        // Keep using the default networks
        return null;
      }
    },
    staleTime: 24 * 60 * 60 * 1000, // 24 hours
  });

  const { data: portfolioData, refetch: fetchPortfolio, isError: isPortfolioError } = useQuery({
    queryKey: ['portfolio', walletAddress],
    queryFn: async () => {
      if (!walletAddress) return null;
      try {
        setError(null);
        const response = await axios.post(
          '/api/zapper',
          {
            query: PORTFOLIO_QUERY,
            variables: {
              addresses: [walletAddress],
              networks: supportedNetworks
            }
          }
        );
        if (response.data.errors) {
          const errorMsg = response.data.errors[0]?.message || 'Error fetching portfolio data';
          console.error('GraphQL error:', errorMsg);
          throw new Error(errorMsg);
        }
        
        const edges = response.data.data?.portfolioV2?.tokenBalances?.byToken?.edges || [];
        
        if (edges.length === 0) {
          console.log('No tokens found for this wallet');
        }
        
        return edges;
      } catch (err: any) {
        const errorMessage = err.response?.data?.error || err.message || 'Unknown error';
        setError(`Portfolio API error: ${errorMessage}`);
        throw err;
      }
    },
    enabled: false,
    retry: 1,
  });

  const { data: recommendations, error: recommendationsError } = useQuery({
    queryKey: ['recommendations', portfolioData],
    queryFn: async () => {
      if (!portfolioData) return null;
      
      try {
        // Get token tags from CoinGecko through our proxy
        const response = await axios.get(
          '/api/coingecko',
          {
            params: {
              include_platform: false
            }
          }
        );
        
        if (response.data.error) {
          throw new Error(response.data.error);
        }
        
        // Analyze portfolio and get recommendations
        const portfolioTokens = portfolioData.map((edge: any) => edge.node.symbol.toLowerCase());
        let recommendedTokens = response.data
          .filter((token: any) => {
            const tokenTags = token.categories || [];
            return tokenTags.some((tag: string) => 
              portfolioTokens.some((portfolioToken: string) => 
                tag.toLowerCase().includes(portfolioToken)
              )
            );
          })
          .slice(0, 5);
          
        // If no recommendations found, return top tokens from similar categories
        if (recommendedTokens.length === 0) {
          const topTokens = response.data
            .filter((token: any) => token.symbol.toLowerCase() !== 'usdt' && token.symbol.toLowerCase() !== 'usdc')
            .slice(0, 5);
          recommendedTokens = topTokens;
        }

        return recommendedTokens;
      } catch (err: any) {
        setError(`Recommendations API error: ${err.message}`);
        throw err;
      }
    },
    enabled: !!portfolioData,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  const handleAnalyze = async () => {
    // Clear previous data and set analyzing state
    setIsAnalyzing(true);
    setError(null);
    
    // Detect wallet type and format address
    let formattedAddress = walletAddress.trim();
    let detectedNetwork = '';
    
    // Check if it's likely a Solana address (base58 encoded, 32-44 chars)
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(formattedAddress) && !/^0x/.test(formattedAddress)) {
      detectedNetwork = 'Solana';
      console.log('Detected Solana address');
    }
    // Check if it's likely an Ethereum address (0x followed by 40 hex chars)
    else if (/^0x[a-fA-F0-9]{40}$/.test(formattedAddress)) {
      detectedNetwork = 'Ethereum';
      console.log('Detected Ethereum address');
    }
    
    console.log(`Analyzing ${detectedNetwork || 'unknown'} wallet: ${formattedAddress}`);
    
    try {
      // Retry strategy with timeout to ensure we've loaded data from all networks
      let retryCount = 0;
      
      const attemptFetch = async () => {
        try {
          await fetchPortfolio();
          retryCount++;
          
          // Check if we have any data after a short delay (to allow state update)
          setTimeout(() => {
            if (portfolioData && portfolioData.length > 0) {
              setError(null); // Clear any error message if we have data
              setIsAnalyzing(false);
            } else if (retryCount < 3) {
              console.log(`Retry ${retryCount} - Fetching more network data...`);
              attemptFetch();
            } else {
              // Give up after 3 retries
              console.log('No data found after retries');
              setError('No tokens found for this wallet address across all supported networks.');
              setIsAnalyzing(false);
            }
          }, 2000);
        } catch (err: any) {
          setIsAnalyzing(false);
          console.error('Error fetching portfolio:', err);
          
          // Handle Solana-specific errors
          if (detectedNetwork === 'Solana' && (!portfolioData || portfolioData.length === 0)) {
            setError('No tokens found for this Solana wallet. Note that the Zapper API may have limited support for Solana wallets.');
          } else {
            setError(`Error analyzing wallet: ${err.message || 'Unknown error'}`);
          }
        }
      };
      
      // Start the first attempt
      await attemptFetch();
      
    } catch (err: any) {
      setIsAnalyzing(false);
      console.error('Error analyzing wallet:', err);
      setError(`Failed to analyze wallet: ${err.message || 'Unknown error'}`);
    }
  };

  // Group portfolio data by network - do this outside the JSX for better performance
  const portfolioByNetwork = useMemo(() => {
    if (!portfolioData || portfolioData.length === 0) {
      return {};
    }
    
    return portfolioData.reduce((acc: any, edge: any) => {
      const network = edge.node.network.name;
      if (!acc[network]) {
        acc[network] = [];
      }
      acc[network].push(edge);
      return acc;
    }, {});
  }, [portfolioData]);

  // Calculate total portfolio value
  const totalPortfolioValue = useMemo(() => {
    if (!portfolioData || portfolioData.length === 0) {
      return 0;
    }
    
    return portfolioData.reduce((total: number, edge: any) => {
      return total + parseFloat(edge.node.balanceUSD || 0);
    }, 0);
  }, [portfolioData]);

  // Number of networks with tokens
  const networksCount = useMemo(() => {
    return Object.keys(portfolioByNetwork).length;
  }, [portfolioByNetwork]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold mb-8 text-center">Wallet Profile Analyzer</h1>
        
        <div className="flex flex-col items-center gap-4">
          <Input
            type="text"
            placeholder="Enter wallet address (supports ETH, Solana, BSC, Polygon, etc.)"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            className="w-full max-w-md"
          />
          
          <Button 
            onClick={handleAnalyze}
            disabled={isAnalyzing || !walletAddress}
          >
            {isAnalyzing ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Analyzing...
              </span>
            ) : 'Analyze Portfolio'}
          </Button>
          
          <div className="text-xs text-gray-500 mt-2">
            Supports {supportedNetworks.length} networks including Ethereum, Solana, Polygon, BSC, and more
          </div>
        </div>

        {/* Error message - Only show if we have an error and no portfolio data */}
        {error && (!portfolioData || portfolioData.length === 0) && (
          <div className="mt-4 p-4 bg-red-100 border border-red-300 rounded-md text-red-700">
            {error}
          </div>
        )}

        {/* Loading state - Only show when actively analyzing and no data loaded yet */}
        {isAnalyzing && (!portfolioData || portfolioData.length === 0) && (
          <div className="mt-8 flex flex-col items-center justify-center">
            <div className="mb-4 text-center">
              <span className="font-medium">Analyzing wallet across {supportedNetworks.length} networks...</span>
              <p className="text-sm text-gray-500">This might take a few seconds</p>
            </div>
          </div>
        )}

        {/* Portfolio data */}
        {portfolioData && portfolioData.length > 0 ? (
          <div className="mt-8">
            <h2 className="text-2xl font-semibold mb-4">Portfolio Analysis</h2>
            
            {Object.entries(portfolioByNetwork).map(([networkName, tokens]: [string, any]) => (
              <div key={networkName} className="mb-8">
                <h3 className="text-xl font-medium mb-2">{networkName}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {tokens.map((edge: any, index: number) => {
                    const token = edge.node;
                    return (
                      <div key={`${token.symbol}-${networkName}-${index}`} className="p-4 border rounded-lg">
                        <div className="flex items-center gap-2">
                          {token.imgUrlV2 && (
                            <img src={token.imgUrlV2} alt={token.symbol} className="w-8 h-8" />
                          )}
                          <h3 className="font-medium">{token.symbol}</h3>
                        </div>
                        <p>Name: {token.name}</p>
                        <p>Balance: {parseFloat(token.balance).toFixed(6)}</p>
                        <p>Value: ${parseFloat(token.balanceUSD).toFixed(2)}</p>
                        <p>Price: ${parseFloat(token.price).toFixed(6)}</p>
                        <div className="flex items-center gap-1 mt-1">
                          <span>Network: </span>
                          <span>{token.network.name}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          !isAnalyzing && walletAddress && !error && (
            <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="text-yellow-700">No tokens found for this wallet address. Please check the address and try again.</p>
            </div>
          )
        )}

        {/* Show total portfolio value */}
        {portfolioData && portfolioData.length > 0 && (
          <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-md">
            <h3 className="text-lg font-medium text-blue-800">Portfolio Summary</h3>
            <p className="text-blue-600">
              Total Value: ${totalPortfolioValue.toFixed(2)}
            </p>
            <p className="text-sm text-blue-500 mt-1">
              Across {networksCount} networks
            </p>
          </div>
        )}

        {/* Recommendations section */}
        {recommendations && recommendations.length > 0 ? (
          <div className="mt-8">
            <h2 className="text-2xl font-semibold mb-4">Recommended Tokens</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {recommendations.map((token: any, index: number) => (
                <div key={`${token.id}-${index}`} className="p-4 border rounded-lg">
                  <h3 className="font-medium">{token.name}</h3>
                  <p>Symbol: {token.symbol.toUpperCase()}</p>
                </div>
              ))}
            </div>
          </div>
        ) : recommendations && recommendations.length === 0 ? (
          <div className="mt-8">
            <h2 className="text-2xl font-semibold mb-4">Recommended Tokens</h2>
            <p className="text-gray-500">No specific recommendations found for your portfolio tokens.</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
