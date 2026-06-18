import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Prevent CDK / Amplify backend packages from being bundled into the browser
  // or SSR runtimes. These are Node.js-only build tools used exclusively by
  // the `amplify/` directory, never by app/ code at runtime.
  serverExternalPackages: [
    '@aws-amplify/backend',
    '@aws-amplify/backend-cli',
    '@aws-amplify/backend-data',
    '@aws-amplify/backend-function',
    '@aws-amplify/graphql-api-construct',
    '@aws-amplify/data-construct',
    'aws-cdk-lib',
    'constructs',
  ],
};

export default nextConfig;
