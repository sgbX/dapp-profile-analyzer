'use client';

import { useState } from 'react';
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

export default function Home() {
  const [walletAddress, setWalletAddress] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
              networks: NETWORKS
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
    setIsAnalyzing(true);
    setError(null);
    
    // Detect wallet type and format address
    let formattedAddress = walletAddress.trim();
    let detectedNetwork = '';
    
    // Check if it's likely a Solana address (base58 encoded, 32-44 chars)
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(formattedAddress)) {
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
      await fetchPortfolio();
    } catch (err: any) {
      // Handle Solana-specific errors
      if (detectedNetwork === 'Solana' && portfolioData?.length === 0) {
        setError('No tokens found for this Solana wallet. Note that the Zapper API may have limited support for Solana wallets.');
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Group portfolio data by network
  const portfolioByNetwork = portfolioData ? portfolioData.reduce((acc: any, edge: any) => {
    const network = edge.node.network.name;
    if (!acc[network]) {
      acc[network] = [];
    }
    acc[network].push(edge);
    return acc;
  }, {}) : {};

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold mb-8 text-center">Wallet Profile Analyzer</h1>
        
        <div className="flex flex-col items-center gap-4">
          <Input
            type="text"
            placeholder="Enter wallet address (supports Ethereum, Solana, Polygon, etc.)"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            className="w-full max-w-md"
          />
          
          <Button 
            onClick={handleAnalyze}
            disabled={isAnalyzing || !walletAddress}
          >
            {isAnalyzing ? 'Analyzing...' : 'Analyze Portfolio'}
          </Button>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-100 border border-red-300 rounded-md text-red-700">
            {error}
          </div>
        )}

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
        ) : portfolioData && portfolioData.length === 0 ? (
          <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
            <p className="text-yellow-700">No tokens found for this wallet address. Please check the address and try again.</p>
          </div>
        ) : null}

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
