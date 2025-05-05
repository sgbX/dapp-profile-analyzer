# Wallet Profile Analyzer

A decentralized web application that analyzes blockchain wallet profiles and recommends tokens based on existing holdings.

## Features

- Analyze wallet addresses across multiple blockchain networks (Ethereum, Solana, Polygon, etc.)
- View detailed portfolio information with network distribution visualization
- Smart token recommendation system based on your existing holdings
- Categorization and matching of tokens with similar characteristics
- Support for large wallets with billions in holdings
- Clean and modern UI built with Next.js and Shadcn UI
- Server-side API proxies for secure API key handling

## Technologies Used

- **Next.js 15** - React framework with App Router and TurboVite
- **React 19** - Latest React features
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS** - Utility-first CSS framework
- **Shadcn UI** - High-quality UI components
- **React Query** - Data fetching and state management
- **Axios** - HTTP client

## Smart Recommendation System

The application analyzes the tokens in your wallet to determine:

- Common token types and categories
- Network preferences and distribution
- DeFi vs. meme token patterns
- Investment style based on existing holdings

Based on this analysis, it provides personalized token recommendations that match your investment profile, with clear explanations of why each token is recommended.

## APIs Used

- **Zapper API** - For wallet portfolio analysis
- **CoinGecko API** - For token data and recommendations

## Getting Started

### Prerequisites

- Node.js 18.17 or later
- npm or yarn
- Zapper API key
- CoinGecko API key

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/dapp-profile-analyzer.git
   cd dapp-profile-analyzer
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```

3. Create a `.env.local` file in the project root and add your API keys:
   ```
   # Required: API keys for core functionality
   ZAPPER_API_KEY=your_zapper_api_key_here
   COINGECKO_API_KEY=your_coingecko_api_key_here

   # Optional: Upstash Redis for rate limiting
   # The app works without these, but rate limiting will be disabled
   UPSTASH_REDIS_REST_URL=your_upstash_redis_url
   UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token
   ```

4. Start the development server:
   ```bash
   npm run dev
   # or
   yarn dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Enter a wallet address in the input field (Ethereum-compatible or Solana)
2. Click "Analyze" to fetch the wallet's holdings
3. View your portfolio breakdown by networks and assets
4. Explore token recommendations based on your investment profile
5. See detailed explanations of why each token is recommended

## Supported Networks

The application supports a wide range of networks through the Zapper API:

- Ethereum Mainnet
- Polygon
- Optimism
- Arbitrum
- Binance Smart Chain (BSC)
- Avalanche
- Fantom Opera
- Solana (limited support)
- Base
- Blast
- zkSync
- Linea
- And more...

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Zapper API for comprehensive portfolio data
- CoinGecko API for token information and categories
- Shadcn UI for beautiful components
- Next.js team for an amazing framework
