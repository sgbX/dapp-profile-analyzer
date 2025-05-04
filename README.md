# Wallet Profile Analyzer

A decentralized web application that analyzes blockchain wallet profiles and recommends tokens based on existing holdings.

## Features

- Analyze wallet addresses across multiple networks
- View detailed portfolio information
- Get token recommendations based on your current holdings
- Clean and modern UI built with Next.js and Shadcn UI
- Server-side API proxies for secure API key handling

## Technologies Used

- **Next.js 14** - React framework with App Router
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS** - Utility-first CSS framework
- **Shadcn UI** - High-quality UI components
- **React Query** - Data fetching and state management
- **Axios** - HTTP client

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
   # Zapper API Key (server-side)
   ZAPPER_API_KEY=your_zapper_api_key_here

   # CoinGecko API Key (server-side)
   COINGECKO_API_KEY=your_coingecko_api_key_here
   ```

4. Start the development server:
   ```bash
   npm run dev
   # or
   yarn dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Enter a wallet address in the input field
2. Click "Analyze Portfolio" to fetch the wallet's holdings
3. View your portfolio breakdown and token recommendations
4. Explore new tokens that match your investment profile

## Supported Networks

- Ethereum Mainnet
- Solana
- Polygon
- Binance Smart Chain
- Avalanche
- Arbitrum
- Optimism
- And more...

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Zapper API for portfolio data
- CoinGecko API for token information
- Shadcn UI for beautiful components
- Next.js team for an amazing framework
