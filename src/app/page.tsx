'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardContent,
  CardFooter,
  CardDescription
} from '@/components/ui/card';
import { 
  Tabs, 
  TabsList, 
  TabsTrigger, 
  TabsContent 
} from '@/components/ui/tabs';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet';
import { 
  Wallet2Icon, 
  BarChart3Icon, 
  CoinsIcon, 
  TrendingUpIcon,
  MenuIcon,
  HomeIcon,
  LineChartIcon,
  ArrowUpIcon
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';

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

  // Helper function to format large numbers with commas and abbreviations for readability
  const formatCurrency = (value: number): string => {
    // For very large numbers, use abbreviations
    if (value >= 1_000_000_000) {
      return `$${(value / 1_000_000_000).toFixed(2)}B`; // Billions
    } else if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(2)}M`; // Millions
    } else if (value >= 10_000) {
      // For values over 10k, use commas and fixed 2 decimals
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    } else {
      // For smaller values, show more decimals
      return `$${value.toFixed(2)}`;
    }
  };

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
      if (!portfolioData || portfolioData.length === 0) return null;
      
      try {
        // Get token data from CoinGecko through our proxy
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
        
        const tokenData = response.data;
        console.log(`Received ${tokenData.length} tokens from CoinGecko with categories`);
        
        // Extract portfolio token symbols and their networks for matching
        const portfolioTokenSymbols = portfolioData.map((edge: any) => 
          edge.node.symbol.toLowerCase()
        );
        
        // Extract all the networks where tokens were found
        const networksFound = new Set<string>();
        portfolioData.forEach((edge: any) => {
          if (edge.node.network && edge.node.network.name) {
            networksFound.add(edge.node.network.name.toLowerCase());
          }
        });
        
        console.log("Networks found in portfolio:", Array.from(networksFound));
        
        // Extract token types for improved category matching
        const portfolioTokenTypes = new Set<string>();
        const possibleScamTokens = new Set<string>();
        
        // Helper function to clean token symbols for better matching
        const cleanSymbol = (symbol: string): string => {
          return symbol.toLowerCase()
            .replace(/[^\w\s-]/g, '') // Remove special chars except hyphen
            .trim();
        };
        
        // Process each token to extract meaningful types
        portfolioData.forEach((edge: any) => {
          const token = edge.node;
          const symbol = cleanSymbol(token.symbol);
          const name = token.name?.toLowerCase() || '';
          
          // Add the symbol as a potential type
          if (symbol && symbol.length > 1 && !/^\d+$/.test(symbol)) {
            portfolioTokenTypes.add(symbol);
          }
          
          // Add network name if available
          if (token.network?.name) {
            const networkName = token.network.name.toLowerCase();
            portfolioTokenTypes.add(networkName);
            
            // Add simplified network name (e.g., "ethereum" from "ethereum_mainnet")
            const simplifiedNetwork = networkName.split('_')[0];
            if (simplifiedNetwork && simplifiedNetwork !== networkName) {
              portfolioTokenTypes.add(simplifiedNetwork);
            }
          }
          
          // Check for common token categories in the name
          const categoryKeywords = [
            'defi', 'finance', 'swap', 'exchange', 'yield', 'farm', 'stake',
            'lend', 'borrow', 'loan', 'credit', 'save', 'dao', 'governance',
            'game', 'gaming', 'metaverse', 'play', 'nft', 'art', 'collect',
            'meme', 'doge', 'shib', 'pepe', 'inu', 'floki', 'moon', 'safe',
            'token', 'coin', 'chain', 'net', 'protocol', 'bridge', 'oracle',
            'data', 'ai', 'index', 'synth', 'wrapped', 'stable', 'gold',
            'privacy', 'identity', 'payment', 'layer'
          ];
          
          // Add identified categories from token name
          categoryKeywords.forEach(keyword => {
            if (name.includes(keyword) || symbol.includes(keyword)) {
              portfolioTokenTypes.add(keyword);
            }
          });
          
          // Check for common meme token patterns
          if (name.includes('inu') || name.includes('shib') || name.includes('doge') || 
              name.includes('pepe') || name.includes('moon') || name.includes('elon') ||
              name.includes('safe') || name.includes('cum') || name.includes('baby') ||
              symbol.includes('inu') || symbol.includes('shib') || symbol.includes('doge') ||
              symbol.includes('pepe')) {
            portfolioTokenTypes.add('meme');
            portfolioTokenTypes.add('meme-token');
          }
          
          // Identify common yield/lending tokens
          if (symbol.startsWith('a') && symbol.length <= 5 || 
              symbol.startsWith('c') && symbol.length <= 5 || 
              symbol.startsWith('y') && symbol.length <= 5) {
            portfolioTokenTypes.add('yield');
            portfolioTokenTypes.add('lend');
          }
          
          // Identify potential scam tokens (with URL or claim in name)
          if (name.includes('airdrop') || name.includes('claim') || 
              name.includes('.com') || name.includes('.io') || name.includes('.org') ||
              name.includes('https://') || name.includes('http://') || 
              name.includes('visit') || name.includes('free') || name.includes('website')) {
            possibleScamTokens.add(name);
            // Don't add these to portfolioTokenTypes
          } else {
            // For non-scam tokens, extract words from name (if not too long)
            const nameWords = name.split(/[\s_-]+/);
            if (nameWords.length <= 3) {  // Only for short names to avoid noise
              nameWords.forEach((word: string) => {
                if (word.length >= 3 && !/^\d+$/.test(word)) {
                  portfolioTokenTypes.add(word);
                }
              });
            }
          }
        });
        
        // Log potential scam tokens for awareness
        if (possibleScamTokens.size > 0) {
          console.log("Possible scam tokens detected:", Array.from(possibleScamTokens));
        }
        
        console.log('Portfolio token types:', Array.from(portfolioTokenTypes));
        
        // Scoring function for tokens based on category matches
        const scoreToken = (token: any) => {
          // Skip tokens already in portfolio
          if (portfolioTokenSymbols.includes(token.symbol.toLowerCase())) {
            return -1; // Negative score to exclude these
          }
          
          // Check if token categories match portfolio token types
          const tokenCategories = token.categories || [];
          
          // Convert categories to lowercase for case-insensitive matching
          const lowerCategories = tokenCategories.map((cat: string) => 
            cat.toLowerCase()
          );
          
          // Base score is 0
          let score = 0;
          
          // Helper function to check if two strings have meaningful overlap
          const hasOverlap = (str1: string, str2: string): boolean => {
            // Direct inclusion check
            if (str1.includes(str2) || str2.includes(str1)) {
              return true;
            }
            
            // Check for common roots/stems (at least 3 characters)
            const minStemLength = 3;
            for (let i = 0; i <= str1.length - minStemLength; i++) {
              const stem = str1.substring(i, i + minStemLength);
              if (str2.includes(stem)) {
                return true;
              }
            }
            
            return false;
          };
          
          // Check matches against portfolio types with enhanced matching
          Array.from(portfolioTokenTypes).forEach(type => {
            const typeStr = type.toString().toLowerCase();
            
            // Skip problematic token types that look like URLs or have special characters
            if (typeStr.includes('visit:') || typeStr.includes('claim') || typeStr.includes('․com')) {
              return;
            }
            
            // Direct category matches (exact or partial)
            let categoryMatched = false;
            for (const category of lowerCategories) {
              if (hasOverlap(category, typeStr)) {
                score += 10;
                categoryMatched = true;
                break;
              }
            }
            
            // Token name/symbol matching for increased relevance
            if (hasOverlap(token.name.toLowerCase(), typeStr) || hasOverlap(token.symbol.toLowerCase(), typeStr)) {
              score += 8;
            }
            
            // Check for specific token categories based on type
            const specialTypes: Record<string, string[]> = {
              "meme": ["meme-token", "meme-coin", "dog-themed"],
              "lend": ["lending", "defi", "yield", "staking"],
              "gold": ["store-of-value", "commodity", "precious-metal"],
              "layer": ["layer-1", "layer-2", "blockchain", "scaling"],
              "pepe": ["meme-token", "frog", "meme-coin"],
              "bnb": ["binance", "bnb-chain", "bsc", "bep20"],
              "ban": ["meme-coin", "community"],
              "bobby": ["meme-token", "community", "nft-related"],
              "top": ["exchange-token", "utility"],
              "synx": ["privacy", "utility"],
              "dct": ["utility", "governance"]
            };
            
            // Check for special type matches
            Object.entries(specialTypes).forEach(([key, categories]) => {
              if (hasOverlap(typeStr, key)) {
                categories.forEach((category: string) => {
                  if (lowerCategories.some((cat: string) => hasOverlap(cat, category))) {
                    score += 5;
                  }
                });
              }
            });
            
            // Give extra points for network matches
            if (networksFound.has(typeStr) && lowerCategories.some((cat: string) => hasOverlap(cat, typeStr))) {
              score += 7;
            }
            
            // More points for matching specific token characteristics with enhanced matching
            if ((typeStr.includes('defi') || typeStr.includes('lend') || typeStr.includes('yield')) && 
                lowerCategories.some((cat: string) => 
                  cat.includes('defi') || cat.includes('lend') || cat.includes('yield') || cat.includes('staking'))) {
              score += 6;  
            }
            
            if ((typeStr.includes('meme') || typeStr.includes('pepe') || typeStr.includes('doge')) && 
                lowerCategories.some((cat: string) => 
                  cat.includes('meme') || cat.includes('pepe') || cat.includes('doge'))) {
              score += 6;
            }
            
            if ((typeStr.includes('layer') || typeStr.includes('chain') || typeStr.includes('network')) && 
                lowerCategories.some((cat: string) => 
                  cat.includes('layer') || cat.includes('chain') || cat.includes('network'))) {
              score += 4;
            }
          });
          
          // Bonus points for trending tokens (if price change data is available)
          if (token.price_change_24h && token.price_change_24h > 5) {
            score += 3; // Small bonus for trending tokens
          }
          
          return score;
        };
        
        // Score and rank all tokens
        const scoredTokens = tokenData
          .map((token: any) => {
            // Calculate the score for this token
            const score = scoreToken(token);
            
            // Find matching categories between token and portfolio
            const matchingCategories: string[] = [];
            const lowerCategories = (token.categories || []).map((cat: string) => cat.toLowerCase());
            
            // For each token type in portfolio, check if it matches token categories
            Array.from(portfolioTokenTypes).forEach((type: any) => {
              const typeStr = type.toString().toLowerCase();
              
              // Skip problematic token types
              if (typeStr.includes('visit:') || typeStr.includes('claim') || typeStr.includes('․com')) {
                return;
              }
              
              // Add to matching categories if there's overlap
              for (const category of lowerCategories) {
                if (category.includes(typeStr) || typeStr.includes(category)) {
                  if (!matchingCategories.includes(typeStr)) {
                    matchingCategories.push(typeStr);
                  }
                  break;
                }
              }
            });
            
            return {
              ...token,
              score,
              matchingCategories
            };
          })
          .filter((token: any) => token.score > 0)
          .sort((a: any, b: any) => b.score - a.score);
        
        // If we found matching recommendations, return top 5
        if (scoredTokens.length > 0) {
          console.log(`Found ${scoredTokens.length} matching tokens for recommendation`);
          const bestRecommendations = scoredTokens.slice(0, 5);
          
          // Ensure we have diverse recommendations
          const diverseRecommendations = [];
          const categoriesIncluded = new Set();
          
          // First pass - include highest scoring tokens from each major category
          for (const token of scoredTokens) {
            const mainCategory = token.categories[0]?.toLowerCase() || '';
            if (!categoriesIncluded.has(mainCategory) && diverseRecommendations.length < 5) {
              diverseRecommendations.push(token);
              categoriesIncluded.add(mainCategory);
            }
            
            if (diverseRecommendations.length >= 5) break;
          }
          
          // Fill in with best scoring if we don't have 5 diverse recommendations
          if (diverseRecommendations.length < 5) {
            for (const token of bestRecommendations) {
              if (!diverseRecommendations.some((t: any) => t.id === token.id) && 
                  diverseRecommendations.length < 5) {
                diverseRecommendations.push(token);
              }
              if (diverseRecommendations.length >= 5) break;
            }
          }
          
          return diverseRecommendations.length > 0 ? diverseRecommendations : bestRecommendations;
        }
        
        // If no recommendations found based on categories, return top 5 tokens
        console.log('No category matches found, using top tokens');
        const topTokens = tokenData
          .filter((token: any) => 
            !portfolioTokenSymbols.includes(token.symbol.toLowerCase()) &&
            token.symbol.toLowerCase() !== 'usdt' && 
            token.symbol.toLowerCase() !== 'usdc'
          )
          .slice(0, 5);
        
        return topTokens;
      } catch (err: any) {
        console.error('Error fetching recommendations:', err);
        setError(`Recommendations API error: ${err.message}`);
        throw err;
      }
    },
    enabled: !!portfolioData && portfolioData.length > 0,
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
      let maxRetries = 2;
      
      const attemptFetch = async () => {
        try {
          // Call the API to fetch portfolio data
          await fetchPortfolio();
          
          // Increment retry counter
          retryCount++;
          
          // Wait for data to be available in the state
          setTimeout(() => {
            // Get the latest portfolio data directly from the query client
            const latestPortfolioData = portfolioData;
            
            if (latestPortfolioData && latestPortfolioData.length > 0) {
              // We have data, stop retrying and clear loading state
              console.log(`Found ${latestPortfolioData.length} tokens across ${networksCount} networks`);
              setError(null);
              setIsAnalyzing(false);
            } else if (retryCount < maxRetries) {
              // Still no data, try again
              console.log(`Retry ${retryCount} - Fetching more network data...`);
              attemptFetch();
            } else {
              // Give up after max retries
              console.log('No data found after retries');
              setError('No tokens found for this wallet address across all supported networks.');
              setIsAnalyzing(false);
            }
          }, 1500);
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

  // Group portfolio data by network
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

  // Count of tokens
  const tokenCount = useMemo(() => {
    return portfolioData?.length || 0;
  }, [portfolioData]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top navigation bar */}
      <header className="border-b">
        <div className="flex h-16 items-center px-4 gap-4">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="md:hidden">
                <MenuIcon className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left">
              <SheetHeader>
                <SheetTitle>Wallet Analyzer</SheetTitle>
                <SheetDescription>
                  Analyze blockchain wallets across multiple networks
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 flex flex-col gap-2">
                <Button variant="ghost" className="justify-start">
                  <HomeIcon className="mr-2 h-4 w-4" />
                  Home
                </Button>
                <Button variant="ghost" className="justify-start">
                  <Wallet2Icon className="mr-2 h-4 w-4" />
                  Wallets
                </Button>
                <Button variant="ghost" className="justify-start">
                  <BarChart3Icon className="mr-2 h-4 w-4" />
                  Analytics
                </Button>
              </div>
            </SheetContent>
          </Sheet>
          
          <div className="flex items-center">
            <Wallet2Icon className="h-6 w-6 mr-2" />
            <h1 className="text-xl font-bold">Wallet Profile Analyzer</h1>
          </div>
          
          <div className="flex flex-1 items-center justify-center md:justify-end gap-2">
            <div className="w-full md:w-auto flex gap-2 max-w-md">
              <Input
                type="text"
                placeholder="Enter wallet address (ETH, SOL, BSC, etc.)"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                className="md:min-w-[300px]"
              />
              <Button 
                onClick={handleAnalyze}
                disabled={isAnalyzing || !walletAddress}
                className="bg-primary text-primary-foreground"
              >
                {isAnalyzing ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Analyzing...
                  </span>
                ) : 'Analyze'}
              </Button>
            </div>
          </div>
        </div>
      </header>
      
      <main className="container p-4 md:p-6 mx-auto">
        {/* Error message */}
        {error && (!portfolioData || portfolioData.length === 0) && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-md text-destructive">
            {error}
          </div>
        )}

        {/* Loading state */}
        {isAnalyzing && (!portfolioData || portfolioData.length === 0) && (
          <div className="h-[50vh] flex flex-col items-center justify-center">
            <div className="mb-4 text-center">
              <svg className="animate-spin h-10 w-10 mb-4 mx-auto text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-xl font-medium">Analyzing wallet across {supportedNetworks.length} networks...</span>
              <p className="text-sm text-muted-foreground mt-2">This might take a few seconds</p>
            </div>
          </div>
        )}

        {/* Dashboard content - only show when we have data */}
        {portfolioData && portfolioData.length > 0 && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Value
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold overflow-hidden text-ellipsis">
                    {formatCurrency(totalPortfolioValue)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Across {networksCount} networks
                  </p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Token Count
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{tokenCount}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Unique tokens
                  </p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Networks
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{networksCount}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Active blockchains
                  </p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Wallet
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-sm font-medium truncate">{walletAddress.slice(0, 8)}...{walletAddress.slice(-6)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {walletAddress.startsWith('0x') ? 'Ethereum-compatible' : 'Solana'}
                  </p>
                </CardContent>
              </Card>
            </div>
            
            {/* Main content tabs */}
            <Tabs defaultValue="overview" className="space-y-4">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="assets">Assets</TabsTrigger>
                <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
              </TabsList>
              
              {/* Overview tab - Shows summary, top assets and all holdings */}
              <TabsContent value="overview" className="space-y-4">
                {/* Portfolio distribution and Top Assets side by side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Portfolio distribution card */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center">
                        <BarChart3Icon className="h-5 w-5 mr-2" />
                        Portfolio Distribution
                      </CardTitle>
                      <CardDescription>
                        How your assets are distributed across networks
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {Object.entries(portfolioByNetwork).map(([networkName, tokens]: [string, any]) => {
                          // Calculate total value for this network
                          const networkValue = tokens.reduce((total: number, edge: any) => {
                            return total + parseFloat(edge.node.balanceUSD || 0);
                          }, 0);
                          
                          // Calculate percentage of total portfolio
                          const networkPercentage = (networkValue / totalPortfolioValue) * 100;
                          
                          return (
                            <div key={`network-dist-${networkName}`} className="space-y-1">
                              <div className="flex justify-between items-center">
                                <span className="text-sm font-medium">{networkName}</span>
                                <span className="text-sm text-muted-foreground">{networkPercentage.toFixed(2)}%</span>
                              </div>
                              <Progress value={networkPercentage} className="h-2" />
                              <p className="text-xs text-muted-foreground">{formatCurrency(networkValue)} • {tokens.length} tokens</p>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                  
                  {/* Top Assets card */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center">
                        <TrendingUpIcon className="h-5 w-5 mr-2" />
                        Top Assets
                      </CardTitle>
                      <CardDescription>
                        Your highest value holdings
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="grid grid-cols-1 gap-px bg-border">
                        {portfolioData
                          .sort((a: any, b: any) => parseFloat(b.node.balanceUSD) - parseFloat(a.node.balanceUSD))
                          .slice(0, 6)
                          .map((edge: any, index: number) => {
                            const token = edge.node;
                            const tokenPercentage = (parseFloat(token.balanceUSD) / totalPortfolioValue) * 100;
                            
                            return (
                              <div key={`top-${token.symbol}-${index}`} className="p-4 bg-card">
                                <div className="flex items-center gap-3 mb-2">
                                  {token.imgUrlV2 ? (
                                    <img src={token.imgUrlV2} alt={token.symbol} className="w-8 h-8" />
                                  ) : (
                                    <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                                      <span className="text-xs font-medium">{token.symbol.charAt(0)}</span>
                                    </div>
                                  )}
                                  <div>
                                    <h3 className="font-medium text-foreground">{token.symbol}</h3>
                                    <p className="text-sm text-muted-foreground">{token.name}</p>
                                  </div>
                                  <div className="ml-auto text-right">
                                    <p className="font-medium">{formatCurrency(parseFloat(token.balanceUSD))}</p>
                                    <p className="text-xs text-muted-foreground">{tokenPercentage.toFixed(2)}% of total</p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* All Holdings section - grouped by network as collapsible accordions */}
                <h2 className="text-xl font-semibold mt-8 mb-4">All Holdings</h2>
                <div className="space-y-3">
                  {Object.entries(portfolioByNetwork)
                    .sort(([, tokensA]: [string, any], [, tokensB]: [string, any]) => {
                      // Calculate total value for each network
                      const valueA = tokensA.reduce((sum: number, edge: any) => sum + parseFloat(edge.node.balanceUSD || 0), 0);
                      const valueB = tokensB.reduce((sum: number, edge: any) => sum + parseFloat(edge.node.balanceUSD || 0), 0);
                      // Sort by value descending
                      return valueB - valueA;
                    })
                    .map(([networkName, tokens]: [string, any]) => {
                      // Calculate network total value
                      const networkValue = tokens.reduce((total: number, edge: any) => {
                        return total + parseFloat(edge.node.balanceUSD || 0);
                      }, 0);
                      
                      // Calculate percentage of total portfolio
                      const networkPercentage = (networkValue / totalPortfolioValue) * 100;

                      // Pick a gradient based on network name
                      const getNetworkGradient = (name: string) => {
                        const network = name.toLowerCase();
                        if (network.includes('ethereum')) return 'from-blue-500/20 to-indigo-500/20';
                        if (network.includes('solana')) return 'from-purple-500/20 to-fuchsia-500/20';
                        if (network.includes('avalanche')) return 'from-red-500/20 to-orange-500/20';
                        if (network.includes('arbitrum')) return 'from-blue-400/20 to-blue-600/20';
                        if (network.includes('base')) return 'from-blue-500/20 to-sky-400/20';
                        if (network.includes('bnb') || network.includes('binance')) return 'from-yellow-400/20 to-amber-500/20';
                        if (network.includes('polygon')) return 'from-purple-400/20 to-violet-500/20';
                        if (network.includes('optimism')) return 'from-red-400/20 to-rose-500/20';
                        if (network.includes('zero')) return 'from-slate-500/20 to-slate-700/20';
                        if (network.includes('ink')) return 'from-indigo-400/20 to-indigo-600/20';
                        if (network.includes('abstract')) return 'from-teal-400/20 to-emerald-500/20';
                        if (network.includes('unichain')) return 'from-pink-400/20 to-rose-500/20';
                        if (network.includes('sonic')) return 'from-blue-400/20 to-cyan-500/20';
                        if (network.includes('scroll')) return 'from-pink-400/20 to-fuchsia-500/20';
                        if (network.includes('mantle')) return 'from-emerald-400/20 to-green-500/20';
                        if (network.includes('celo')) return 'from-green-400/20 to-lime-500/20';
                        return 'from-gray-400/20 to-gray-600/20'; // Default gradient
                      };
                        
                      return (
                        <div key={networkName} className="rounded-lg overflow-hidden border">
                          <div 
                            className={`bg-gradient-to-r ${getNetworkGradient(networkName)} flex items-center justify-between p-4 cursor-pointer hover:brightness-105 transition-all`}
                            onClick={(e) => {
                              // Toggle the expanded state
                              const target = e.currentTarget.parentElement;
                              if (target) {
                                const content = target.querySelector('.network-content');
                                const arrow = target.querySelector('.arrow-icon');
                                if (content) {
                                  const isExpanded = content.classList.contains('hidden');
                                  if (isExpanded) {
                                    content.classList.remove('hidden');
                                    arrow?.classList.add('rotate-180');
                                  } else {
                                    content.classList.add('hidden');
                                    arrow?.classList.remove('rotate-180');
                                  }
                                }
                              }
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-background flex items-center justify-center shadow-sm">
                                <CoinsIcon className="h-5 w-5 text-primary" />
                              </div>
                              <div>
                                <h3 className="font-semibold text-foreground">{networkName}</h3>
                                <div className="flex items-center text-sm text-muted-foreground gap-2">
                                  <span>{tokens.length} tokens</span>
                                  <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
                                  <span>{networkPercentage.toFixed(1)}% of portfolio</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <span className="text-lg font-semibold">{formatCurrency(networkValue)}</span>
                                <div className="h-1.5 w-24 bg-primary/10 rounded-full mt-1 overflow-hidden">
                                  <div 
                                    className="h-full bg-primary rounded-full" 
                                    style={{ width: `${Math.min(networkPercentage, 100)}%` }}
                                  />
                                </div>
                              </div>
                              <svg 
                                className="h-5 w-5 transition-transform arrow-icon" 
                                xmlns="http://www.w3.org/2000/svg" 
                                fill="none" 
                                viewBox="0 0 24 24" 
                                stroke="currentColor"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </div>
                          
                          <div className="network-content hidden">
                            <div className="divide-y divide-border">
                              {tokens
                                .sort((a: any, b: any) => parseFloat(b.node.balanceUSD) - parseFloat(a.node.balanceUSD))
                                .map((edge: any, index: number) => {
                                  const token = edge.node;
                                  const tokenPercentage = (parseFloat(token.balanceUSD) / networkValue) * 100;
                                  
                                  return (
                                    <div key={`${token.symbol}-${networkName}-${index}`} className="p-4 hover:bg-muted/30 transition-colors">
                                      <div className="flex items-center">
                                        <div className="flex items-center gap-3 flex-1">
                                          {token.imgUrlV2 ? (
                                            <img src={token.imgUrlV2} alt={token.symbol} className="w-10 h-10 rounded-full shadow-sm" />
                                          ) : (
                                            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center shadow-sm">
                                              <span className="text-sm font-medium">{token.symbol.charAt(0)}</span>
                                            </div>
                                          )}
                                          <div className="min-w-0">
                                            <div className="flex items-center">
                                              <h3 className="font-semibold text-foreground">{token.symbol}</h3>
                                              <div className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-primary/10 text-primary">
                                                {tokenPercentage.toFixed(1)}%
                                              </div>
                                            </div>
                                            <p className="text-sm text-muted-foreground truncate">{token.name}</p>
                                          </div>
                                        </div>
                                        
                                        <div className="flex flex-col items-end ml-auto">
                                          <p className="font-semibold text-foreground">{formatCurrency(parseFloat(token.balanceUSD))}</p>
                                          <div className="flex items-center text-xs text-muted-foreground gap-1.5">
                                            <span className="whitespace-nowrap">{parseFloat(token.balance).toFixed(token.balance > 100 ? 2 : 6)}</span>
                                            <span className="w-1 h-1 rounded-full bg-current opacity-50" />
                                            <span className="whitespace-nowrap">${parseFloat(token.price).toFixed(token.price < 0.01 ? 6 : 2)}/token</span>
                                          </div>
                                        </div>
                                      </div>
                                      
                                      {/* Progress bar for token value within network */}
                                      <div className="h-1 w-full bg-muted rounded-full mt-2 overflow-hidden">
                                        <div 
                                          className="h-full bg-primary/40 rounded-full" 
                                          style={{ width: `${Math.min(tokenPercentage, 100)}%` }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </TabsContent>
              
              {/* Assets tab - A high-level view of assets grouped by value tier */}
              <TabsContent value="assets" className="space-y-4">
                {/* High-value tokens section */}
                <Card>
                  <CardHeader className="bg-muted/50">
                    <CardTitle className="flex items-center">
                      <ArrowUpIcon className="h-5 w-5 mr-2" />
                      High-Value Assets
                    </CardTitle>
                    <CardDescription>
                      Your most valuable tokens (over $100)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border">
                      {portfolioData
                        .filter((edge: any) => parseFloat(edge.node.balanceUSD) >= 100)
                        .sort((a: any, b: any) => parseFloat(b.node.balanceUSD) - parseFloat(a.node.balanceUSD))
                        .map((edge: any, index: number) => {
                          const token = edge.node;
                          const tokenPercentage = (parseFloat(token.balanceUSD) / totalPortfolioValue) * 100;
                          
                          return (
                            <div key={`high-value-${token.symbol}-${index}`} className="p-4 bg-card">
                              <div className="flex items-center gap-3 mb-2">
                                {token.imgUrlV2 ? (
                                  <img src={token.imgUrlV2} alt={token.symbol} className="w-8 h-8" />
                                ) : (
                                  <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                                    <span className="text-xs font-medium">{token.symbol.charAt(0)}</span>
                                  </div>
                                )}
                                <div>
                                  <h3 className="font-medium text-foreground">{token.symbol}</h3>
                                  <div className="flex items-center text-sm text-muted-foreground">
                                    <span>{token.network.name}</span>
                                    <span className="mx-1">•</span>
                                    <span>{tokenPercentage.toFixed(2)}% of portfolio</span>
                                  </div>
                                </div>
                              </div>
                              
                              <div className="mt-2">
                                <div className="flex justify-between text-sm mb-1">
                                  <span className="text-muted-foreground">Value:</span>
                                  <span className="font-medium">{formatCurrency(parseFloat(token.balanceUSD))}</span>
                                </div>
                                <Progress value={tokenPercentage} className="h-1.5" />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </CardContent>
                </Card>

                {/* Mid-value tokens section */}
                <Card>
                  <CardHeader className="bg-muted/50">
                    <CardTitle className="flex items-center">
                      <LineChartIcon className="h-5 w-5 mr-2" />
                      Mid-Value Assets
                    </CardTitle>
                    <CardDescription>
                      Your mid-tier tokens ($5 to $100)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-px bg-border">
                      {portfolioData
                        .filter((edge: any) => {
                          const value = parseFloat(edge.node.balanceUSD);
                          return value >= 5 && value < 100;
                        })
                        .sort((a: any, b: any) => parseFloat(b.node.balanceUSD) - parseFloat(a.node.balanceUSD))
                        .map((edge: any, index: number) => {
                          const token = edge.node;
                          return (
                            <div key={`mid-value-${token.symbol}-${index}`} className="p-3 bg-card">
                              <div className="flex items-center gap-2">
                                {token.imgUrlV2 ? (
                                  <img src={token.imgUrlV2} alt={token.symbol} className="w-6 h-6" />
                                ) : (
                                  <div className="w-6 h-6 bg-muted rounded-full flex items-center justify-center">
                                    <span className="text-xs font-medium">{token.symbol.charAt(0)}</span>
                                  </div>
                                )}
                                <div>
                                  <h3 className="text-sm font-medium">{token.symbol}</h3>
                                  <div className="flex items-center text-[10px] text-muted-foreground">
                                    <span>{token.network.name}</span>
                                    <span className="mx-1">•</span>
                                    <span>${parseFloat(token.balanceUSD).toFixed(2)}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </CardContent>
                </Card>

                {/* Low-value tokens section */}
                <Card>
                  <CardHeader className="bg-muted/50">
                    <CardTitle className="flex items-center">
                      <CoinsIcon className="h-5 w-5 mr-2" />
                      Other Assets
                    </CardTitle>
                    <CardDescription>
                      Your low-value or dust tokens (under $5)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-px bg-border">
                      {portfolioData
                        .filter((edge: any) => parseFloat(edge.node.balanceUSD) < 5)
                        .sort((a: any, b: any) => parseFloat(b.node.balanceUSD) - parseFloat(a.node.balanceUSD))
                        .map((edge: any, index: number) => {
                          const token = edge.node;
                          return (
                            <div key={`low-value-${token.symbol}-${index}`} className="p-2 bg-card">
                              <div className="flex items-center gap-2">
                                <div className="w-5 h-5 bg-muted rounded-full flex items-center justify-center">
                                  <span className="text-xs font-medium">{token.symbol.charAt(0)}</span>
                                </div>
                                <div>
                                  <h3 className="text-xs font-medium">{token.symbol}</h3>
                                  <div className="flex items-center text-[10px] text-muted-foreground">
                                    <span>{token.network.name}</span>
                                    <span className="mx-1">•</span>
                                    <span>${parseFloat(token.balanceUSD).toFixed(2)}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              {/* Recommendations tab */}
              <TabsContent value="recommendations" className="space-y-4">
                {/* Recommendations - Enhanced version */}
                {recommendations && recommendations.length > 0 ? (
                  <div className="p-4 bg-card rounded-lg border border-border">
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingUpIcon className="w-5 h-5 text-green-500" />
                      <h3 className="text-lg font-semibold">Token Recommendations</h3>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      Based on your portfolio profile, you might be interested in these tokens:
                    </p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {recommendations.map((token: any, index: number) => (
                        <div key={index} className="flex flex-col p-4 bg-card/50 rounded-lg border border-border hover:border-primary/50 transition-all">
                          <div className="flex items-center gap-3 mb-2">
                            {token.image && (
                              <img 
                                src={token.image} 
                                alt={token.name} 
                                className="w-8 h-8 rounded-full"
                                onError={(e) => {
                                  // Replace broken images with a generic icon
                                  (e.target as HTMLImageElement).src = 'https://placehold.co/32/6dedd5/white?text=' + token.symbol?.substring(0,2)?.toUpperCase();
                                }}
                              />
                            )}
                            <div>
                              <h4 className="font-medium">{token.name}</h4>
                              <p className="text-xs text-muted-foreground uppercase">{token.symbol}</p>
                            </div>
                            {token.price_change_24h > 0 && (
                              <span className="ml-auto text-xs font-medium text-green-500 flex items-center gap-1">
                                <ArrowUpIcon className="w-3 h-3" />
                                {token.price_change_24h.toFixed(2)}%
                              </span>
                            )}
                          </div>
                          
                          {/* Show matching categories if available */}
                          {token.matchingCategories && token.matchingCategories.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs text-muted-foreground mb-1">Matching your profile:</p>
                              <div className="flex flex-wrap gap-1 mb-2">
                                {token.matchingCategories.slice(0, 3).map((category: string, i: number) => (
                                  <span 
                                    key={i}
                                    className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full"
                                  >
                                    {category}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {/* Token categories */}
                          <div className="mt-2">
                            <p className="text-xs text-muted-foreground mb-1">Categories:</p>
                            <div className="flex flex-wrap gap-1">
                              {(token.categories || []).slice(0, 4).map((category: string, i: number) => (
                                <span 
                                  key={i}
                                  className={`px-2 py-0.5 text-xs rounded-full ${
                                    category.toLowerCase().includes('layer') ? 'bg-blue-500/10 text-blue-500' :
                                    category.toLowerCase().includes('bitcoin') ? 'bg-orange-500/10 text-orange-500' :
                                    category.toLowerCase().includes('ethereum') ? 'bg-blue-500/10 text-blue-500' :
                                    category.toLowerCase().includes('solana') ? 'bg-purple-500/10 text-purple-500' :
                                    category.toLowerCase().includes('meme') ? 'bg-rose-500/10 text-rose-500' :
                                    category.toLowerCase().includes('defi') ? 'bg-amber-500/10 text-amber-500' :
                                    category.toLowerCase().includes('dex') ? 'bg-pink-500/10 text-pink-500' :
                                    category.toLowerCase().includes('oracle') ? 'bg-cyan-500/10 text-cyan-500' :
                                    category.toLowerCase().includes('store') ? 'bg-yellow-500/10 text-yellow-500' :
                                    category.toLowerCase().includes('smart') ? 'bg-indigo-500/10 text-indigo-500' :
                                    category.toLowerCase().includes('scale') || category.toLowerCase().includes('parachain') ? 'bg-green-500/10 text-green-500' :
                                    'bg-muted text-muted-foreground'
                                  }`}
                                >
                                  {category}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : recommendations && recommendations.length === 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Recommended Tokens</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground">No specific recommendations found for your portfolio tokens.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="flex items-center justify-center h-40">
                      <p className="text-muted-foreground">Analyze a wallet to get recommendations</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
        
        {!portfolioData && !isAnalyzing && (
          <div className="h-[60vh] flex flex-col items-center justify-center">
            <Wallet2Icon className="h-16 w-16 text-muted-foreground/30 mb-6" />
            <h2 className="text-2xl font-semibold mb-2">Enter a wallet address</h2>
            <p className="text-muted-foreground mb-6">
              Analyze crypto wallets across {supportedNetworks.length} networks
            </p>
            <div className="text-xs text-muted-foreground mt-2 max-w-md text-center">
              Supports Ethereum, Solana, Polygon, BSC, Arbitrum, Optimism, Avalanche, and more
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
