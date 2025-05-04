import { NextResponse } from 'next/server';

export async function GET() {
  // Don't return full API keys in production - this is just for debugging
  return NextResponse.json({
    envVars: {
      ZAPPER_API_KEY: process.env.ZAPPER_API_KEY ? 'Set (starts with: ' + process.env.ZAPPER_API_KEY.substring(0, 3) + '...)' : 'Not set',
      COINGECKO_API_KEY: process.env.COINGECKO_API_KEY ? 'Set (starts with: ' + process.env.COINGECKO_API_KEY.substring(0, 3) + '...)' : 'Not set',
      NODE_ENV: process.env.NODE_ENV,
    }
  });
} 